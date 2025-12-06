// 核心状态模型：EngineState + 基础操作
// 注意：本文件不依赖 SillyTavern 宿主，只做纯数据逻辑。

import { resolveSymbolicOperation } from "./symbolic-mapper.js";
import { applyCastIntent, applyLocationCastIntent } from "./cast-manager.js";
import { buildNormalizedEntities } from "./entities.js";

/**
 * @typedef {Object} CeVariablesState
 * @property {Object.<string, any>} character   // 角色自身状态，支持嵌套：character[subjectName][parameterName]
 * @property {Object.<string, any>} relationship // 关系状态，支持嵌套：relationship[subjectName][parameterName][targetName]
 * @property {Object.<string, any>} scene        // 场景级变量，支持嵌套
 * @property {Object.<string, any>} global       // 全局变量，支持嵌套
 */


/**
 * @typedef {Object} CeSceneState
 * @property {string|null} locationHint   // 场景地点提示，例如 "放学后的教室门口"（已废弃，使用 locationCast.current）
 * @property {string[]} sceneTags         // 场景标签数组，例如 ["吵架后冷静期","约会"]
 */

/**
 * @typedef {Object} CeCastLayer
 * @property {string[]} focus
 * @property {string[]} presentSupporting
 * @property {string[]} offstageRelated
 */

/**
 * @typedef {Object} CeLocationCast
 * @property {string|null} current        // 当前地点（完整注入baseinfo + advanceinfo）
 * @property {string[]} candidate         // 候选地点列表（仅注入名称）
 */

/**
 * @typedef {Object} CeEntityRuntime
 * @property {string} name
 * @property {string} [id]
 * @property {import("./entities.js").CeEntityType} type
 * @property {string|undefined} [baseinfo]
 * @property {string[]|undefined} [childrenNames]
 * @property {string[]|undefined} [locations]
 * @property {string[]|undefined} [characters]
 */

/**
 * @typedef {Object} EngineState
 * @property {string} chatId                // 当前 chat 的标识（由 integration 层填充）
 * @property {CeVariablesState} variables   // 通用变量桶（包括短期情绪/意图在内的所有参数，统一通过 CeVariableOp 变更）
 * @property {CeSceneState} scene
 * @property {CeCastLayer} cast             // 角色Cast分层
 * @property {CeLocationCast} locationCast  // 地点Cast（current + candidate）
 * @property {Object.<string, CeEntityRuntime>} entitiesRuntime // 运行时实体桶（仅存本条世界线下的临时实体与覆盖）
 * @property {Object|undefined} [worldIntent] // WorldContextIntent 对象（用于RAG检索）
 */

/**
 * 创建一个初始 EngineState。
 * @param {Object} params
 * @param {string} params.chatId
 * @param {Object} [params.initialVariables]
 * @param {Object} [params.initialScene]
 * @param {Object} [params.initialCast]
 * @param {Object} [params.initialLocationCast]  // 初始地点Cast
 * @param {Object.<string, CeEntityRuntime>} [params.initialEntitiesRuntime]  // 初始运行时实体（通常为空，由聊天存档重建）
 * @returns {EngineState}
 */
export function createInitialEngineState(params) {
  const {
    chatId,
    initialVariables = {},
    initialScene = {},
    initialCast = {},
    initialLocationCast = {},
    initialEntitiesRuntime = {}
  } = params || {};

  /** @type {EngineState} */
  const state = {
    chatId: chatId || "",
    variables: {
      character: initialVariables.character || {},
      relationship: initialVariables.relationship || {},
      scene: initialVariables.scene || {},
      global: initialVariables.global || {}
    },
    scene: {
      locationHint: initialScene.locationHint || null,  // 保留用于向后兼容
      sceneTags: Array.isArray(initialScene.sceneTags) ? [...initialScene.sceneTags] : []
    },
    cast: {
      focus: Array.isArray(initialCast.focus) ? [...initialCast.focus] : [],
      presentSupporting: Array.isArray(initialCast.presentSupporting) ? [...initialCast.presentSupporting] : [],
      offstageRelated: Array.isArray(initialCast.offstageRelated) ? [...initialCast.offstageRelated] : []
    },
    locationCast: {
      current: initialLocationCast.current || initialScene.locationHint || null,  // 向后兼容：优先使用 locationCast，否则使用 locationHint
      candidate: Array.isArray(initialLocationCast.candidate) ? [...initialLocationCast.candidate] : []
    },
    entitiesRuntime: initialEntitiesRuntime && typeof initialEntitiesRuntime === "object"
      ? { ...initialEntitiesRuntime }
      : {},
    worldIntent: undefined  // 初始化为 undefined，由 applyChangeSet 填充
  };

  return state;
}

/**
 * 安全深拷贝 EngineState。
 * @param {EngineState} state
 * @returns {EngineState}
 */
export function cloneEngineState(state) {
  if (!state) return createInitialEngineState({ chatId: "" });
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(state);
    } catch {
      // fallthrough
    }
  }
  return JSON.parse(JSON.stringify(state));
}

/**
 * 在嵌套对象中获取值
 * @param {Object} obj - 根对象
 * @param {string[]} pathSegments - 路径片段数组
 * @returns {any}
 */
function getNestedValue(obj, pathSegments) {
  let current = obj;
  for (const segment of pathSegments) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

/**
 * 在嵌套对象中设置值，自动创建中间对象
 * @param {Object} obj - 根对象
 * @param {string[]} pathSegments - 路径片段数组
 * @param {any} value - 要设置的值
 */
function setNestedValue(obj, pathSegments, value) {
  if (!pathSegments.length) return;
  
  let current = obj;
  for (let i = 0; i < pathSegments.length - 1; i++) {
    const segment = pathSegments[i];
    if (!current[segment] || typeof current[segment] !== "object") {
      current[segment] = {};
    }
    current = current[segment];
  }
  
  const lastSegment = pathSegments[pathSegments.length - 1];
  current[lastSegment] = value;
}

/**
 * 应用单个变量操作到嵌套结构
 * @param {Object} bucket - 变量桶（character/relationship/scene/global）
 * @param {string[]} pathSegments - 路径片段数组
 * @param {string} op - 操作类型（set/add/symbolic）
 * @param {any} value - 操作值
 * @param {Object} variableOp - 完整的变量操作对象
 * @param {import("./variables.js").CeParameterDefinition[]} parameterDefs - 参数定义数组
 */
function applyVariableOperation(bucket, pathSegments, op, value, variableOp, parameterDefs) {
  if (!pathSegments.length) return;

  if (op === "symbolic") {
    // 符号化操作：需要参数定义来解析
    const paramName = variableOp.parsedPath?.parameterName || variableOp.meta?.parameterName || variableOp.meta?.name;
    if (!paramName) {
      // eslint-disable-next-line no-console
      console.warn(
        "[CharacterEngine] 符号化操作缺少参数名称，跳过：",
        variableOp
      );
      return;
    }

    // 查找参数定义
    const paramDef = Array.isArray(parameterDefs)
      ? parameterDefs.find(p => p.name === paramName || p.id === paramName)
      : null;

    if (!paramDef) {
      // eslint-disable-next-line no-console
      console.warn(
        `[CharacterEngine] 未找到参数定义 "${paramName}"，符号化操作跳过：`,
        variableOp
      );
      return;
    }

    // 获取当前值
    const currentValue = getNestedValue(bucket, pathSegments);

    // 调用符号化映射器
    try {
      const resolved = resolveSymbolicOperation(
        variableOp, // 传入完整的 variableOp 对象
        currentValue,
        paramDef
      );

      if (resolved && resolved.value !== undefined) {
        setNestedValue(bucket, pathSegments, resolved.value);
        
        // 为数组类型提供更详细的日志
        if (paramDef.type === "array" && resolved.meta) {
          // eslint-disable-next-line no-console
          console.debug(
            `[CharacterEngine] 数组操作成功：路径=[${pathSegments.join('.')}], 操作=${resolved.meta.operationType}, 详情=`,
            resolved.meta
          );
        } else {
          // eslint-disable-next-line no-console
          console.debug(
            `[CharacterEngine] 符号化操作成功：路径=[${pathSegments.join('.')}], ${JSON.stringify(currentValue)} → ${JSON.stringify(resolved.value)} (${variableOp.symbol})`
          );
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[CharacterEngine] 符号化操作解析失败：参数="${paramName}", 操作="${variableOp.symbol || value}"`,
        err
      );
    }
  } else if (op === "add" && typeof value === "number") {
    const currentValue = getNestedValue(bucket, pathSegments);
    const oldVal = typeof currentValue === "number" ? currentValue : 0;
    const newVal = oldVal + value;
    setNestedValue(bucket, pathSegments, newVal);
    // eslint-disable-next-line no-console
    console.debug(
      `[CharacterEngine] add 操作：路径=[${pathSegments.join('.')}], ${oldVal} + ${value} = ${newVal}`
    );
  } else if (op === "set") {
    setNestedValue(bucket, pathSegments, value);
    // eslint-disable-next-line no-console
    console.debug(
      `[CharacterEngine] set 操作：路径=[${pathSegments.join('.')}], 值=${JSON.stringify(value)}`
    );
  }
}

/**
 * 将一个 ChangeSet 应用到 EngineState，返回新状态。
 * 支持符号化操作（up_small/up_medium/up_large等）的数值映射。
 * 支持嵌套路径存储（基于 parsedPath 的 subjectName/parameterName/targetName）。
 *
 * @param {EngineState} prevState
 * @param {Object} changeSet
 * @param {import("./variables.js").CeParameterDefinition[]} [parameterDefs] - 参数定义数组，用于符号化操作解析
 * @param {import("./entities.js").CeEntityDefinition[]} [entityDefs] - 实体定义数组，用于 Cast 验证
 * @returns {EngineState}
 */
export function applyChangeSet(prevState, changeSet, parameterDefs = [], entityDefs = []) {
  const next = cloneEngineState(prevState);
  if (!changeSet || typeof changeSet !== "object") {
    return next;
  }

  const { stateDelta, sceneDelta, entityDelta, worldIntent } = changeSet;

  // 1. 变量（支持 set/add/symbolic 操作 + 嵌套路径）
  if (stateDelta && Array.isArray(stateDelta.variables)) {
    for (const v of stateDelta.variables) {
      if (!v || typeof v !== "object") continue;
      
      // 智能推断 scope，优先级：
      // 1. 变量操作中显式指定的 scope
      // 2. 参数定义中的 scope（优先考虑 isShortTerm 标记）
      // 3. 基于 parsedPath 的智能推断（有 subjectName 则为 character）
      // 4. 最终兜底为 global
      let scope = v.scope;
      
      if (!scope) {
        // 尝试从参数定义中查找 scope
        const parsed = v.parsedPath;
        const paramName = parsed?.parameterName || v.meta?.parameterName || v.meta?.name;
        
        if (paramName && Array.isArray(parameterDefs)) {
          const paramDef = parameterDefs.find(p => p.name === paramName || p.id === paramName);
          if (paramDef) {
            // 如果参数标记为短期参数，强制使用 character scope
            if (paramDef.isShortTerm === true) {
              scope = "character";
            } else if (paramDef.scope) {
              scope = paramDef.scope;
            }
          }
        }
        
        // 如果仍未确定 scope，但有 subjectName（路径式引用），推断为 character
        if (!scope && parsed?.subjectName) {
          scope = "character";
        }
      }
      
      // 最终兜底
      if (!scope) {
        scope = "global";
      }
      
      const op = v.op || "set";
      const value = v.value;

      if (!Object.prototype.hasOwnProperty.call(next.variables, scope)) {
        continue;
      }
      const bucket = next.variables[scope];

      // 使用 parsedPath 构建嵌套路径（完全移除扁平键降级逻辑）
      const parsed = v.parsedPath;
      if (!parsed || !parsed.parameterName) {
        // eslint-disable-next-line no-console
        console.warn(
          "[CharacterEngine] 变量操作缺少 parsedPath 信息，跳过：",
          v
        );
        continue;
      }

      // 构建嵌套路径数组
      const pathSegments = [];
      if (parsed.subjectName) pathSegments.push(parsed.subjectName);
      pathSegments.push(parsed.parameterName);
      if (parsed.targetName) pathSegments.push(parsed.targetName);

      applyVariableOperation(bucket, pathSegments, op, value, v, parameterDefs);
    }
  }

  // 2. 场景元数据
  if (sceneDelta && typeof sceneDelta === "object") {
    if (sceneDelta.locationHint && sceneDelta.locationHint.op === "set") {
      next.scene.locationHint = sceneDelta.locationHint.value || null;
    }

    if (sceneDelta.sceneTags) {
      const tagsOp = sceneDelta.sceneTags;
      // 覆盖语义：如果提供 set，则直接替换整个标签集合（允许清空）
      if (Array.isArray(tagsOp.set)) {
        const normalized = [];
        for (const t of tagsOp.set) {
          if (typeof t === "string") {
            const s = t.trim();
            if (s) normalized.push(s);
          }
        }
        // 去重，保持先后顺序
        next.scene.sceneTags = Array.from(new Set(normalized));
      } else {
        // 兼容旧逻辑：仅当未提供 set 时，才按 add/remove 增量合并
        const current = new Set(next.scene.sceneTags || []);
        if (Array.isArray(tagsOp.add)) {
          for (const t of tagsOp.add) {
            if (typeof t === "string") current.add(t);
          }
        }
        if (Array.isArray(tagsOp.remove)) {
          for (const t of tagsOp.remove) {
            current.delete(t);
          }
        }
        next.scene.sceneTags = Array.from(current);
      }
    }

    // 3. Cast 管理（角色进场/离场）
    if (sceneDelta.castIntent) {
      // 构建可用角色列表用于验证
      const availableCharacters = buildNormalizedEntities(
        entityDefs,
        next.entitiesRuntime,
        null,
        null,
        parameterDefs
      ).filter(e => e.type === "character");
      
      // 从 castConfig 中读取上限配置
      const characterCastLimits = castConfig?.characterCast || {};
      const limits = {
        maxFocus: characterCastLimits.maxFocus ?? 3,
        maxPresentSupporting: characterCastLimits.maxPresentSupporting ?? 5,
        maxOffstageRelated: characterCastLimits.maxOffstageRelated ?? 10
      };
      
      next.cast = applyCastIntent(
        next.cast,
        sceneDelta.castIntent,
        { availableCharacters, limits }
      );
    }

    // 4. 地点Cast管理（地点切换与候选地点）
    if (sceneDelta.locationCastIntent) {
      // 构建可用地点列表（配置层 + 运行时）
      const availableLocations = buildNormalizedEntities(
        entityDefs,
        next.entitiesRuntime,
        null,
        null,
        parameterDefs
      ).filter(e => e.type === "location");
      
      // 从 castConfig 中读取地点上限配置
      const locationCastLimits = castConfig?.locationCast || {};
      const maxCandidate = locationCastLimits.maxCandidate ?? 10;
      
      next.locationCast = applyLocationCastIntent(
        next.locationCast,
        sceneDelta.locationCastIntent,
        { availableLocations, allowUnknownLocations: true, maxCandidate }
      );
      
      // 向后兼容：同步更新 scene.locationHint
      next.scene.locationHint = next.locationCast.current;
    }
  }

  // 4. 实体运行时状态（临时实体与覆盖）
  if (Array.isArray(entityDelta)) {
    if (!next.entitiesRuntime || typeof next.entitiesRuntime !== "object") {
      next.entitiesRuntime = {};
    }
    const runtime = next.entitiesRuntime;

    const mergeList = (prev, incoming) => {
      const result = new Set(Array.isArray(prev) ? prev : []);
      if (Array.isArray(incoming)) {
        for (const v of incoming) {
          if (typeof v === "string") {
            const trimmed = v.trim();
            if (trimmed) result.add(trimmed);
          }
        }
      }
      return Array.from(result);
    };

    for (const op of entityDelta) {
      if (!op || typeof op !== "object") continue;
      const name = typeof op.name === "string" ? op.name.trim() : "";
      if (!name) continue;
      const action = op.op || "add";

      if (action === "remove") {
        delete runtime[name];
        continue;
      }

      let existing = runtime[name];

      if (action === "update" && !existing) {
        // update 仅更新已有实体，不自动创建
        continue;
      }

      if (!existing && action === "add") {
        existing = {
          name,
          type: op.type || "other",
          baseinfo: "",
          childrenNames: [],
          locations: [],
          characters: []
        };
      }

      if (!existing) {
        continue;
      }

      const updated = { ...existing };

      if (op.type) {
        updated.type = op.type;
      }
      if (op.baseinfo !== undefined) {
        updated.baseinfo = op.baseinfo;
      }
      if (op.childrenNames !== undefined) {
        updated.childrenNames = mergeList(existing.childrenNames, op.childrenNames);
      }
      if (op.locations !== undefined) {
        updated.locations = mergeList(existing.locations, op.locations);
      }
      if (op.characters !== undefined) {
        updated.characters = mergeList(existing.characters, op.characters);
      }

      runtime[name] = updated;
    }
  }

  // 5. WorldContextIntent（用于RAG检索）
  if (worldIntent && typeof worldIntent === "object") {
    next.worldIntent = worldIntent;
  }

  return next;
}