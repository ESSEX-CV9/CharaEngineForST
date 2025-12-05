// ChangeSet（git 风格 diff）定义与基础工具。
// 仅负责抽象「本轮意图」的数据结构，不直接依赖 SillyTavern。

/**
 * @typedef {Object} CeVariableOp
 * @property {string|undefined} [path]       // 人类可读路径，如 "艾莉娅.好感度.林原"
 * @property {"character"|"relationship"|"scene"|"global"} scope
 * @property {string} key                    // 变量标识；若未显式提供，可由 path 或解析层推导
 * @property {"set"|"add"|"symbolic"} op
 *   - set: 直接设置为 value
 *   - add: 视为数值增量（value 为 number）
 *   - symbolic: 符号操作（如 up_small / down_large / set_phase_2），由 variables.js 解释
 * @property {any} [value]         // set/add 使用的值
 * @property {string} [symbol]     // symbolic 操作名，如 "up_small"
 * @property {Object} [meta]       // 解析模型的说明文本（可用于日志）
 */


/**
 * @typedef {Object} CeSceneTagsDelta
 * @property {string[]|undefined} [set]    // 覆盖整个标签集合（允许清空）
 * @property {string[]|undefined} [add]
 * @property {string[]|undefined} [remove]
 */

/**
 * @typedef {Object} CeLocationHintDelta
 * @property {"set"} op
 * @property {string|null} value
 */

/**
 * @typedef {Object} CeCastIntent
 * @property {Array.<{ name: string, role?: "focus"|"supporting"|"offstage" }>} [enter]  // 仅存自然语言名字，内部再做 ID 对齐
 * @property {Array.<{ name: string }>} [leave]
 */

/**
 * @typedef {Object} CeStateDelta
 * @property {CeVariableOp[]|undefined} [variables]
 */

/**
 * @typedef {Object} CeSceneDelta
 * @property {CeLocationHintDelta|undefined} [locationHint]
 * @property {CeSceneTagsDelta|undefined} [sceneTags]
 * @property {CeCastIntent|undefined} [castIntent]
 */

/**
 * @typedef {Object} CeEntityOp
 * @property {"add"|"update"|"remove"} op
 *   - add: 若实体不存在则创建；若已存在则按提供字段进行增量合并
 *   - update: 仅更新已存在实体的指定字段（未提供的字段保持不变）
 *   - remove: 从运行时实体集中移除该实体
 * @property {string} name                           // 实体名，作为主键
 * @property {import("./entities.js").CeEntityType|undefined} [type]
 * @property {string|undefined} [baseinfo]
 * @property {string[]|undefined} [childrenNames]
 * @property {string[]|undefined} [locations]
 * @property {string[]|undefined} [characters]
 * @property {Object|undefined} [meta]               // 解析模型的说明文本（调试用）
 */

/**
 * @typedef {Object} CeChangeSet
 * @property {CeStateDelta|undefined} [stateDelta]
 * @property {CeSceneDelta|undefined} [sceneDelta]
 * @property {CeEntityOp[]|undefined} [entityDelta]  // 实体运行时状态与临时实体的变更意图
 * @property {Object|undefined} [worldIntent]        // WorldContextIntent 的结构化结果
 */

/**
 * 创建一个空的 ChangeSet。
 * @returns {CeChangeSet}
 */
export function createEmptyChangeSet() {
  return {
    stateDelta: undefined,
    sceneDelta: undefined,
    entityDelta: undefined,
    worldIntent: undefined
  };
}

/**
 * 将解析模型输出的「原始 CE_UpdateState 结构」（可能是 JSON 或近似 JSON）规整为 CeStateDelta。
 * 注意：这里不做复杂的数值解释，只做格式归一；真正的数值映射交给 variables.js。
 *
 * @param {any} raw
 * @returns {CeStateDelta}
 */
export function normalizeCeUpdateState(raw) {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  /** @type {CeVariableOp[]|undefined} */
  let variables;
  const rawVars = raw.variables;
  if (Array.isArray(rawVars)) {
    variables = rawVars
      .map(v => {
        if (!v || typeof v !== "object") return null;

        // 人类可读路径（模型看到的 name），例如 "艾莉娅.好感度.林原"、"艾莉娅.短期情绪"
        const path = v.path || v.name;

        // 内部作用域与键：允许解析层预先填好，也允许仅提供 path，由后续变量模块解析
        const scope = v.scope || "global";
        const key = v.key || v.id || path;
        if (!key) return null;

        /** @type {CeVariableOp} */
        const op = {
          path,
          scope,
          key,
          op: v.op || "set",
          value: v.value,
          symbol: v.symbol,
          meta: v.meta
        };
        return op;
      })
      .filter(Boolean);
  }

  /** @type {CeStateDelta} */
  const delta = {};
  if (variables && variables.length) {
    delta.variables = variables;
  }

  return delta;
}

/**
 * 将解析模型输出的「原始 CE_UpdateScene 结构」规整为 CeSceneDelta。
 *
 * @param {any} raw
 * @returns {CeSceneDelta}
 */
export function normalizeCeUpdateScene(raw) {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  /** @type {CeLocationHintDelta|undefined} */
  let locationHint;
  if (raw.location_hint || raw.locationHint) {
    const val = raw.location_hint || raw.locationHint;
    locationHint = {
      op: "set",
      value: typeof val === "string" ? val : null
    };
  }

  /** @type {CeSceneTagsDelta|undefined} */
  let sceneTags;
  if (raw.scene_tags || raw.sceneTags) {
    const src = raw.scene_tags || raw.sceneTags;
    sceneTags = {};
    if (Array.isArray(src.set)) {
      sceneTags.set = src.set.filter(t => typeof t === "string");
    }
    if (Array.isArray(src.add)) {
      sceneTags.add = src.add.filter(t => typeof t === "string");
    }
    if (Array.isArray(src.remove)) {
      sceneTags.remove = src.remove.filter(t => typeof t === "string");
    }
  }

  /** @type {CeCastIntent|undefined} */
  let castIntent;
  if (raw.cast_intent || raw.castIntent) {
    const src = raw.cast_intent || raw.castIntent;
    castIntent = {};

    if (Array.isArray(src.enter)) {
      castIntent.enter = src.enter
        .map(r => {
          if (!r || typeof r !== "object") return null;
          // 解析模型只需要提供自然语言名字（name），这里仍兼容 id 字段以便旧配置迁移
          const name = r.name || r.id;
          if (!name) return null;
          return {
            name,
            role: r.role
          };
        })
        .filter(Boolean);
    }

    if (Array.isArray(src.leave)) {
      castIntent.leave = src.leave
        .map(r => {
          if (!r || typeof r !== "object") return null;
          const name = r.name || r.id;
          if (!name) return null;
          return { name };
        })
        .filter(Boolean);
    }
  }

  /** @type {CeSceneDelta} */
  const delta = {};
  if (locationHint) delta.locationHint = locationHint;
  if (sceneTags && (Array.isArray(sceneTags.set) || sceneTags.add?.length || sceneTags.remove?.length)) {
    delta.sceneTags = sceneTags;
  }
  if (castIntent && (castIntent.enter?.length || castIntent.leave?.length)) {
    delta.castIntent = castIntent;
  }

  return delta;
}

/**
 * 从独立的 stateDelta / sceneDelta / entityDelta / worldIntent 组合出一个完整 ChangeSet。
 *
 * @param {CeStateDelta} [stateDelta]
 * @param {CeSceneDelta} [sceneDelta]
 * @param {CeEntityOp[]} [entityDelta]
 * @param {Object} [worldIntent]
 * @returns {CeChangeSet}
 */
export function composeChangeSet(stateDelta, sceneDelta, entityDelta, worldIntent) {
  const cs = createEmptyChangeSet();
  if (stateDelta && stateDelta.variables && stateDelta.variables.length) {
    cs.stateDelta = stateDelta;
  }
  if (sceneDelta && (sceneDelta.locationHint || sceneDelta.sceneTags || sceneDelta.castIntent)) {
    cs.sceneDelta = sceneDelta;
  }
  if (Array.isArray(entityDelta) && entityDelta.length) {
    cs.entityDelta = entityDelta;
  }
  if (worldIntent && typeof worldIntent === "object") {
    cs.worldIntent = worldIntent;
  }
  return cs;
}