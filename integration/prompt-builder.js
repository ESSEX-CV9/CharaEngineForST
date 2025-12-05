// 提示构建模块：负责所有提示注入相关的逻辑
// - 构建 Character_n / Location_n 提示块
// - 参数值解析
// - 实体选择和组装
// - 文本格式化
// - RAG世界观设定注入

import { getConfigForCurrentCharacter, getCurrentCharacterName } from "./card-storage.js";
import { buildPromptBundles } from "../core/prompt-slots.js";
import { buildNormalizedEntities } from "../core/entities.js";
import { getUserName, getUserPersonaDescription } from "./st-context.js";
import { parseVariablePath } from "../core/variables.js";
import { extension_settings } from "../../../../extensions.js";

/**
 * 创建一个基于路径的参数值查找函数。
 * 支持以下路径格式：
 * - "角色名.参数名" -> variables.character[角色名][参数名]
 * - "角色名.参数名.目标名" -> variables.relationship[角色名][参数名][目标名]
 * - "参数名" -> 根据参数定义的 scope 查找
 *
 * @param {import("../core/variables.js").CeParameterDefinition[]} parameters - 参数定义列表
 * @param {import("../core/engine-state.js").EngineState} engineState - 当前引擎状态
 * @returns {(path: string) => any}
 */
function createPathBasedValueGetter(parameters, engineState) {
  return (path) => {
    const trimmedPath = String(path || "").trim();
    if (!trimmedPath) return undefined;

    const vars = engineState?.variables || {};
    
    // 解析路径
    const parsed = parseVariablePath(trimmedPath);
    const { subjectName, parameterName, targetName } = parsed;
    
    if (!parameterName) {
      // 路径无效
      return undefined;
    }

    // 查找参数定义
    const paramDef = parameters.find(p =>
      p && (p.name === parameterName || p.id === parameterName)
    );
    
    if (!paramDef) {
      // 参数定义不存在
      return undefined;
    }

    const scope = paramDef.scope || "character";
    const bucket = vars[scope];
    
    if (!bucket || typeof bucket !== "object") {
      return undefined;
    }

    // 根据 scope 和路径查找值
    if (scope === "character" || scope === "relationship") {
      if (!subjectName) {
        // character/relationship scope 必须有 subjectName
        return undefined;
      }
      
      const subjectBucket = bucket[subjectName];
      if (!subjectBucket || typeof subjectBucket !== "object") {
        return undefined;
      }
      
      // 尝试使用参数名和 ID 查找
      const value = subjectBucket[parameterName] ?? subjectBucket[paramDef.id];
      
      // 如果是 relationship scope 且有 targetName，进一步查找
      if (scope === "relationship" && targetName && typeof value === "object") {
        return value[targetName];
      }
      
      return value;
    } else if (scope === "scene" || scope === "global") {
      // scene/global scope 直接查找
      return bucket[parameterName] ?? bucket[paramDef.id];
    }
    
    return undefined;
  };
}

/**
 * 缩进多行文本块
 * @param {string} text
 * @param {string} prefix
 */
function indentBlock(text, prefix) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

/**
 * 使用角色卡中的参数/提示定义 + 当前 EngineState，构造结构化的 Character_n / Location_n 提示块。
 *
 * 核心改进：
 * 1. 使用统一的路径式参数查找
 * 2. Cast 完全控制哪些角色被注入
 * 3. 即使没有提示条目命中，也注入 Baseline
 * 4. 支持RAG世界观设定注入
 *
 * @param {import("../core/engine-state.js").EngineState} engineState
 * @returns {Promise<string>}
 */
export async function buildPromptInjectionBlock(engineState) {
  const charConfig = getConfigForCurrentCharacter();
  
  if (!charConfig || !Array.isArray(charConfig.prompts) || !charConfig.prompts.length) {
    return "";
  }

  const parameters = charConfig.parameters || [];
  const promptTypes = charConfig.promptTypes || [];
  const currentCharacterName = getCurrentCharacterName();

  // 创建统一的路径式参数查找函数
  const getValueByPath = createPathBasedValueGetter(parameters, engineState);

  // 提示类型说明映射
  const promptTypeDescMap = new Map();
  for (const t of promptTypes) {
    if (!t || typeof t.name !== "string") continue;
    const name = t.name.trim();
    if (!name) continue;
    const desc = typeof t.description === "string" ? t.description.trim() : "";
    if (desc) {
      promptTypeDescMap.set(name, desc);
    }
  }

  // 1) 基于提示条目与参数状态构造 ownerName → promptTypeName → 文本 的 bundle
  const bundles = buildPromptBundles(charConfig.prompts, getValueByPath);

  // 2) 合成实体视图
  const runtimeEntitiesMap =
    engineState && engineState.entitiesRuntime && typeof engineState.entitiesRuntime === "object"
      ? engineState.entitiesRuntime
      : null;

  const userName = getUserName();
  const userDescription = getUserPersonaDescription();
  const userEntityData = {
    name: userName,
    baseinfo: userDescription
  };

  // 获取所有可能的 ownerName（来自 bundles 和 Cast）
  const cast = engineState?.cast || {};
  const allPossibleOwners = new Set([
    ...Object.keys(bundles),
    ...(cast.focus || []),
    ...(cast.presentSupporting || []),
    ...(cast.offstageRelated || [])
  ]);

  const normalizedEntities = buildNormalizedEntities(
    charConfig.entities || [],
    runtimeEntitiesMap,
    Array.from(allPossibleOwners),
    userEntityData,
    parameters
  );

  const entitiesByName = new Map();
  for (const e of normalizedEntities) {
    if (!e || !e.name) continue;
    entitiesByName.set(e.name, e);
  }

  // 3) 基于 Cast 选取需要注入的角色（关键改进: Cast 完全控制）
  const focusNames = Array.isArray(cast.focus) ? cast.focus : [];
  const supportingNames = Array.isArray(cast.presentSupporting) ? cast.presentSupporting : [];
  const offstageNames = Array.isArray(cast.offstageRelated) ? cast.offstageRelated : [];

  /** @type {Map<string, "focus"|"presentSupporting"|"offstageRelated">} */
  const characterLayers = new Map();

  const pushCharacter = (rawName, layer) => {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) return;
    const ent = entitiesByName.get(name);
    if (!ent || ent.type !== "character") return;
    
    // 如果角色已在更高层级，不覆盖
    const currentLayer = characterLayers.get(name);
    if (currentLayer === "focus") return;
    if (currentLayer === "presentSupporting" && layer === "offstageRelated") return;
    
    characterLayers.set(name, layer);
  };

  // 按优先级顺序添加角色
  focusNames.forEach(name => pushCharacter(name, "focus"));
  supportingNames.forEach(name => pushCharacter(name, "presentSupporting"));
  offstageNames.forEach(name => pushCharacter(name, "offstageRelated"));

  // 关键改进: 移除兜底逻辑，完全由 Cast 控制
  // 如果 Cast 为空，则不注入任何角色（符合设计文档）

  const activeCharacterNames = Array.from(characterLayers.keys());

  // 4) 选取地点实体
  const activeLocationNames = [];
  const pushLocation = (rawName) => {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name || activeLocationNames.includes(name)) return;
    const ent = entitiesByName.get(name);
    if (!ent || ent.type !== "location") return;
    activeLocationNames.push(name);
  };

  const locationHint = engineState?.scene?.locationHint || "";
  if (typeof locationHint === "string" && locationHint.trim()) {
    pushLocation(locationHint);
  }

  for (const charName of activeCharacterNames) {
    const ent = entitiesByName.get(charName);
    if (!ent || ent.type !== "character" || !Array.isArray(ent.locations)) continue;
    ent.locations.forEach(pushLocation);
  }

  // 5) 组装结构化块
  const lines = [];
  lines.push(
    "【Character Engine 提示块】以下信息由角色卡参数与数值规则自动组合，请严格以这些信息为准进行表演，不要自行修改长期人设与状态。"
  );
  lines.push("");

  // 5.0.5 RAG世界观设定块（在场景之后、角色之前注入）
  const ragBlock = await buildRagBlock(engineState, charConfig);
  if (ragBlock) {
    lines.push(ragBlock);
    lines.push("");
  }

  // 5.0 场景元数据块（优先注入，让模型首先了解当前场景）
  const sceneInfo = engineState?.scene;
  if (sceneInfo) {
    lines.push("<SceneContext>");
    
    // 场景地点
    const locationHint = sceneInfo.locationHint;
    if (locationHint && typeof locationHint === "string" && locationHint.trim()) {
      lines.push(`  location: ${locationHint.trim()}`);
    }
    
    // 场景标签
    const sceneTags = Array.isArray(sceneInfo.sceneTags) ? sceneInfo.sceneTags : [];
    if (sceneTags.length > 0) {
      lines.push(`  scene_tags: [${sceneTags.map(t => `"${t}"`).join(", ")}]`);
    }
    
    lines.push("</SceneContext>");
    lines.push("");
  }

  // 5.1 角色块
  let charIndex = 1;
  for (const name of activeCharacterNames) {
    const ent = entitiesByName.get(name);
    const bundle = bundles[name]; // 可能为 undefined
    const layer = characterLayers.get(name) || "focus";

    lines.push(`<Character_${charIndex}>`);
    lines.push(`  character: ${name}`);
    lines.push(`  cast_layer: ${layer}`);

    if (layer === "focus") {
      // Focus 层: 完整 Baseline + 所有变量解析后的提示片段 + 短期情绪/意图
      const baseinfo = ent?.baseinfo || "";
      
      // 始终注入 Baseline
      lines.push(`  baseinfo: ${baseinfo}`);
      
      // 显式注入短期情绪和短期意图（独立于提示条目系统）
      const shortTermEmotion = getValueByPath(`${name}.短期情绪`) || getValueByPath(`${name}.short_term_emotion`);
      const shortTermIntent = getValueByPath(`${name}.短期意图`) || getValueByPath(`${name}.short_term_intent`);
      
      if (shortTermEmotion !== undefined || shortTermIntent !== undefined) {
        lines.push("  short_term_state:");
        if (shortTermEmotion !== undefined) {
          const emotionText = String(shortTermEmotion || "").trim();
          if (emotionText) {
            lines.push(`    emotion: ${emotionText}`);
          }
        }
        if (shortTermIntent !== undefined) {
          const intentText = String(shortTermIntent || "").trim();
          if (intentText) {
            lines.push(`    intent: ${intentText}`);
          }
        }
      }
      
      // 只有当有提示条目命中时才注入 advanceinfo
      if (bundle && Object.keys(bundle.byPromptType).length > 0) {
        lines.push("  advanceinfo:");
        for (const [typeName, text] of Object.entries(bundle.byPromptType)) {
          if (!text) continue;
          const raw = String(text || "");
          const desc = promptTypeDescMap.get(typeName) || "";
          const combined = desc ? `${desc}\n\n${raw}` : raw;
          lines.push(`    ${typeName}: |`);
          lines.push(indentBlock(combined, "      "));
        }
      }
      
    } else if (layer === "presentSupporting") {
      // PresentSupporting 层: 压缩人设摘要 + 关键标签
      // 优先使用 summaryForSupporting，若无则使用 baseinfo 的前100字
      let summary = ent?.summaryForSupporting || "";
      if (!summary && ent?.baseinfo) {
        const baseinfo = String(ent.baseinfo);
        summary = baseinfo.length > 100
          ? baseinfo.substring(0, 100) + "..."
          : baseinfo;
      }
      
      const tags = Array.isArray(ent?.tagsForSupporting) ? ent.tagsForSupporting : [];

      if (summary) {
        lines.push(`  summary: ${summary}`);
      }
      if (tags.length > 0) {
        lines.push(`  tags: ${tags.join(", ")}`);
      }
      
      // 如果既没有摘要也没有标签，至少输出一个基础说明
      if (!summary && tags.length === 0) {
        lines.push(`  summary: ${name}（在场配角）`);
      }
    } else if (layer === "offstageRelated") {
      // OffstageRelated 层: 名字 + 关系标签 + 一句话说明
      // 优先使用 descForOffstage，若无则尝试从 baseinfo 提取第一句话
      let desc = ent?.descForOffstage || "";
      if (!desc && ent?.baseinfo) {
        const baseinfo = String(ent.baseinfo);
        // 提取第一句话（以句号、问号、感叹号结尾）
        const match = baseinfo.match(/^[^。!?！?]+[。!?！?]/);
        desc = match ? match[0] : (baseinfo.length > 50 ? baseinfo.substring(0, 50) + "..." : baseinfo);
      }
      
      // 如果仍然没有描述，使用默认格式
      if (!desc) {
        desc = `${name}（场外相关角色）`;
      }
      
      lines.push(`  description: ${desc}`);
    }

    lines.push(`</Character_${charIndex}>`);
    lines.push("");
    charIndex += 1;
  }

  // 5.2 地点块
  let locIndex = 1;
  for (const name of activeLocationNames) {
    const ent = entitiesByName.get(name);
    const bundle = bundles[name];
    const baseinfo = ent?.baseinfo || "";

    lines.push(`<Location_${locIndex}>`);
    lines.push(`  Location: ${name}`);
    lines.push(`  baseinfo: ${baseinfo}`);
    
    if (bundle && Object.keys(bundle.byPromptType).length > 0) {
      lines.push("  advanceinfo:");
      for (const [typeName, text] of Object.entries(bundle.byPromptType)) {
        if (!text) continue;
        const raw = String(text || "");
        const desc = promptTypeDescMap.get(typeName) || "";
        const combined = desc ? `${desc}\n\n${raw}` : raw;
        lines.push(`    ${typeName}: |`);
        lines.push(indentBlock(combined, "      "));
      }
    }
    
    lines.push(`</Location_${locIndex}>`);
    lines.push("");
    locIndex += 1;
  }

  return lines.join("\n");
}

/**
 * 构建RAG世界观设定块
 * @param {import("../core/engine-state.js").EngineState} engineState
 * @param {Object} charConfig
 * @returns {Promise<string>}
 */
async function buildRagBlock(engineState, charConfig) {
  // 检查是否启用RAG
  const settings = extension_settings.CharacterEngine;
  if (!settings || !settings.useWorldRag) {
    return '';
  }
  
  // 检查是否有worldIntent
  const worldIntent = engineState?.worldIntent;
  if (!worldIntent || !worldIntent.queries || worldIntent.queries.length === 0) {
    return '';
  }
  
  // 检查是否有loreConfig
  const loreConfig = charConfig?.loreConfig;
  if (!loreConfig || !loreConfig.collections || loreConfig.collections.length === 0) {
    return '';
  }
  
  try {
    // 动态导入RAG模块
    const ragModule = await import('../rag/integration/prompt-injector.js');
    const ragPromptText = await ragModule.injectRagPrompts(worldIntent, loreConfig);
    return ragPromptText;
  } catch (err) {
    console.error('[PromptBuilder] RAG注入失败:', err);
    return '';
  }
}