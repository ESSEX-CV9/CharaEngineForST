// 角色卡扩展字段读写：所有参数与提示配置都严格绑定在角色卡上。
// 本模块只负责：
// - 从当前角色卡读取 CharacterEngine 的扩展字段
// - 将编辑器中的结果写回角色卡扩展字段
// 不做任何运行时状态（数值）存储。

import { getStContext } from "./st-context.js";

/**
 * 角色卡扩展字段的 key。
 * 最终数据会存放在：
 *   character.data.extensions[CE_CARD_EXT_KEY]
 */
export const CE_CARD_EXT_KEY = "CharacterEngine";

/**
 * @typedef {import("../core/variables.js").CeParameterDefinition} CeParameterDefinition
 * @typedef {import("../core/variables.js").CePromptTypeDefinition} CePromptTypeDefinition
 * @typedef {import("../core/variables.js").CePromptEntry} CePromptEntry
 * @typedef {import("../core/entities.js").CeEntityDefinition} CeEntityDefinition
 */

/**
 * @typedef {Object} CeCharacterConfig
 * @property {CeParameterDefinition[]} parameters
 * @property {CePromptTypeDefinition[]} promptTypes
 * @property {CePromptEntry[]} prompts
 * @property {CeEntityDefinition[]} entities
 * @property {Object} [initialState]  // 角色引擎的基线初始状态配置（variables/scene/cast/entitiesRuntime）
 * @property {Object} [options]
 * @property {boolean} [options.disableShortTermEmotion]
 * @property {boolean} [options.disableShortTermIntent]
 * @property {Object} [loreConfig]  // RAG世界观设定配置
 */

/**
 * 生成一个空的角色配置对象。
 * @returns {CeCharacterConfig}
 */
export function createEmptyCharacterConfig() {
  return {
    parameters: [],
    promptTypes: [],
    prompts: [],
    entities: [],
    // initialState 为可选字段，若未配置则在 chat-state-storage 中回退到 createInitialEngineState 默认值
    initialState: {},
    options: {
      disableShortTermEmotion: false,
      disableShortTermIntent: false
    },
    loreConfig: null  // RAG配置，默认为null表示未启用
  };
}

/**
 * 获取当前选中角色的 ID（SillyTavern 里的 characterId）。
 * - 以字符串 ID 为主；
 * - 若为数字类型，会转换为字符串（向后兼容旧版本环境）；
 * - 其它情况返回 undefined（例如群聊或未选中角色）。
 * @returns {string|undefined}
 */
export function getCurrentCharacterId() {
  const ctx = getStContext();
  const rawId = ctx.characterId;

  if (typeof rawId === "string" && rawId) {
    return rawId;
  }

  if (typeof rawId === "number" && Number.isInteger(rawId) && rawId >= 0) {
    // 向后兼容：旧环境中 characterId 可能仍为数字索引
    // eslint-disable-next-line no-console
    console.warn(
      "[CharacterEngine] characterId 为数字，将其作为字符串 ID 使用：",
      rawId
    );
    return String(rawId);
  }

  // eslint-disable-next-line no-console
  console.error(
    "[CharacterEngine] 当前没有有效的 characterId，可能未选中角色或为群聊。ctx.characterId =",
    rawId
  );
  return undefined;
}

/**
 * 获取当前选中角色对象。
 * 若不存在（群聊/未选中角色），返回 null。
 * @returns {any|null}
 */
export function getCurrentCharacter() {
  const ctx = getStContext();
  const id = getCurrentCharacterId();
  if (id === undefined) return null;

  // 优先使用 ST 提供的 getCharacter(id)（兼容字符串 ID）
  if (typeof ctx.getCharacter === "function") {
    try {
      const ch = ctx.getCharacter(id);
      if (ch && typeof ch === "object") {
        return ch;
      }
    } catch {
      // 忽略 getCharacter 内部异常，回退到 characters 列表
    }
  }

  const chars = ctx.characters;
  if (!chars || typeof chars !== "object") return null;

  const ch = chars[id];
  if (ch && typeof ch === "object") {
    return ch;
  }

  return null;
}

/**
 * 获取当前选中角色卡的显示名称（用于编辑器标题等）。
 * 优先顺序：
 * - character.name
 * - character.data?.name
 * - character.data?.display_name
 * 若均不存在则返回空字符串。
 * @returns {string}
 */
export function getCurrentCharacterName() {
  const character = getCurrentCharacter();
  if (!character || typeof character !== "object") return "";

  const directName = typeof character.name === "string" ? character.name : "";
  const dataName =
    character.data && typeof character.data.name === "string" ? character.data.name : "";
  const dataDisplayName =
    character.data && typeof character.data.display_name === "string"
      ? character.data.display_name
      : "";

  return directName || dataName || dataDisplayName || "";
}

/**
 * 从角色对象上读取 CharacterEngine 扩展字段。
 * 若不存在则返回空配置。
 * 自动确保包含默认的短期情绪和短期意图参数。
 *
 * @param {any|null} character
 * @returns {CeCharacterConfig}
 */
export function getCharacterConfigFromCard(character) {
  if (!character || typeof character !== "object") {
    return createEmptyCharacterConfig();
  }
  const data = character.data || {};
  const extRoot = data.extensions || {};
  const raw = extRoot[CE_CARD_EXT_KEY];

  if (!raw || typeof raw !== "object") {
    return createEmptyCharacterConfig();
  }

  /** @type {CeCharacterConfig} */
  const cfg = {
    parameters: Array.isArray(raw.parameters) ? raw.parameters : [],
    promptTypes: Array.isArray(raw.promptTypes) ? raw.promptTypes : [],
    prompts: Array.isArray(raw.prompts) ? raw.prompts : [],
    entities: Array.isArray(raw.entities) ? raw.entities : [],
    initialState:
      raw.initialState && typeof raw.initialState === "object" ? raw.initialState : {},
    options: {
      disableShortTermEmotion: !!raw.options?.disableShortTermEmotion,
      disableShortTermIntent: !!raw.options?.disableShortTermIntent
    },
    loreConfig: raw.loreConfig && typeof raw.loreConfig === "object" ? raw.loreConfig : null
  };

  // 确保包含默认的短期情绪和短期意图参数
  ensureDefaultParameters(cfg);

  return cfg;
}

/**
 * 确保配置中包含默认的短期情绪和短期意图参数。
 * 如果参数已存在（通过 id 或 name 匹配），则不添加。
 * 如果对应的 disable 选项为 true，则不添加该参数。
 *
 * @param {CeCharacterConfig} cfg
 */
function ensureDefaultParameters(cfg) {
  if (!Array.isArray(cfg.parameters)) {
    cfg.parameters = [];
  }

  const options = cfg.options || {};

  // 检查是否已存在短期情绪参数
  const hasShortTermEmotion = cfg.parameters.some(p =>
    p && (p.id === "short_term_emotion" || p.name === "短期情绪")
  );

  // 检查是否已存在短期意图参数
  const hasShortTermIntent = cfg.parameters.some(p =>
    p && (p.id === "short_term_intent" || p.name === "短期意图")
  );

  // 如果不存在短期情绪参数且未禁用，添加默认定义
  if (!hasShortTermEmotion && !options.disableShortTermEmotion) {
    cfg.parameters.push({
      name: "短期情绪",
      id: "short_term_emotion",
      type: "text",
      scope: "character",
      isShortTerm: true,  // 标记为短期参数
      description: "角色当前的短期情绪状态，会随剧情自然衰减"
    });
  }

  // 如果不存在短期意图参数且未禁用，添加默认定义
  if (!hasShortTermIntent && !options.disableShortTermIntent) {
    cfg.parameters.push({
      name: "短期意图",
      id: "short_term_intent",
      type: "text",
      scope: "character",
      isShortTerm: true,  // 标记为短期参数
      description: "角色当前想做什么、想表达什么的短期目标"
    });
  }
}

/**
 * 读取当前角色卡的 CharacterEngine 配置。
 * 若无选中角色或无扩展字段，则返回空配置。
 *
 * @returns {CeCharacterConfig}
 */
export function getConfigForCurrentCharacter() {
  const character = getCurrentCharacter();
  return getCharacterConfigFromCard(character);
}

/**
 * 将配置写回当前角色卡的扩展字段。
 * 若当前无选中角色，则返回 false 并输出明确错误日志。
 *
 * @param {CeCharacterConfig} config
 * @returns {Promise<boolean>} 是否成功写入
 */
export async function saveConfigForCurrentCharacter(config) {
  const ctx = getStContext();
  const id = getCurrentCharacterId();
  if (id === undefined) {
    // eslint-disable-next-line no-console
    console.error(
      "[CharacterEngine] saveConfigForCurrentCharacter：当前没有选中角色或无法解析 characterId，写入已取消。"
    );
    return false;
  }

  const writeExtensionField = ctx.writeExtensionField;
  if (typeof writeExtensionField !== "function") {
    // eslint-disable-next-line no-console
    console.error(
      "[CharacterEngine] writeExtensionField 不可用，无法写入角色卡扩展字段。ctx =",
      ctx
    );
    return false;
  }

  const safeConfig = {
    parameters: Array.isArray(config.parameters) ? config.parameters : [],
    promptTypes: Array.isArray(config.promptTypes) ? config.promptTypes : [],
    prompts: Array.isArray(config.prompts) ? config.prompts : [],
    entities: Array.isArray(config.entities) ? config.entities : [],
    initialState:
      config.initialState && typeof config.initialState === "object"
        ? config.initialState
        : undefined,
    options: {
      disableShortTermEmotion: !!config.options?.disableShortTermEmotion,
      disableShortTermIntent: !!config.options?.disableShortTermIntent
    },
    loreConfig: config.loreConfig && typeof config.loreConfig === "object" ? config.loreConfig : undefined
  };

  try {
    await writeExtensionField(id, CE_CARD_EXT_KEY, safeConfig);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[CharacterEngine] 写入角色卡扩展字段失败", err);
    return false;
  }
}