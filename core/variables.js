// 变量与提示词定义模型 + 人类可读路径解析
// 注意：本模块不依赖 SillyTavern，只提供纯数据结构和工具函数。

/**
 * @typedef {Object} CeArrayConfig
 * @property {"string"|"number"|"boolean"|"object"} itemType  // 数组元素类型
 * @property {number} [maxLength]  // 可选：数组最大长度限制
 * @property {Object.<string, {type: string, required?: boolean, default?: any}>} [itemSchema]  // 当 itemType 为 object 时的对象结构定义
 */

/**
 * @typedef {Object} CeParameterDefinition
 * @property {string} name              // 作者/LLM 看到的参数名，例如 "好感度"
 * @property {string} id                // 引擎内部 ID，例如 "affection"；若作者未给，内部可生成
 * @property {"number"|"boolean"|"enum"|"text"|"array"} type
 * @property {"character"|"relationship"|"scene"|"global"} [scope] // 参数作用域：character=角色自身，relationship=需要目标实体，scene=场景级，global=全局级
 * @property {boolean} [isShortTerm]    // 标记是否为短期参数（短期情绪/意图等），短期参数会在每轮对话后自动重置
 * @property {string} [description]     // 人类可读解释，解析模型用来理解含义
 * @property {{ min?: number, max?: number }} [range]  // 数值型可选范围
 * @property {string[]} [enumValues]    // 枚举型的可选值列表（名称同样面向作者/LLM）
 * @property {CeArrayConfig} [arrayConfig]  // 数组型参数的配置
 * @property {string} [textHint]        // 文本型参数的格式提示
 */

/**
 * @typedef {Object} CePromptTypeDefinition
 * @property {string} name          // 提示类型名字，例如 "语气"、"内心独白"
 * @property {string} id            // 内部 ID，例如 "tone"；若作者未给可自动生成
 * @property {string} [description] // 用于作者/解析模型理解此类型的用途
 */

/**
 * @typedef {Object} CePromptRuleCondition
 * @property {string} parameterName       // 使用参数的 name（而非内部 id）
 * @property {("=="|"!="|">"|">="|"<"|"<="|"in"|"not_in")} op
 * @property {any} value
 */

/**
 * @typedef {Object} CePromptEntry
 * @property {string} ownerName                // 归属实体的自然语言名字，如某角色或地点
 * @property {string} promptTypeName           // 提示类型的名字（与 CePromptTypeDefinition.name 对齐）
 * @property {string} text                     // 实际插入到提示中的文案
 * @property {CePromptRuleCondition[]} [when]  // 参数条件列表，全部满足时生效
 * @property {string} [id]                     // 可选内部 ID，便于编辑器引用
 */

/**
 * @typedef {Object} ParsedVariablePath
 * @property {string} raw            // 原始路径字符串，例如 "艾莉娅.好感度.林原"
 * @property {string[]} segments     // 按 "." 切分后的片段
 * @property {string|null} subjectName   // 主体名字（通常是角色），例如 "艾莉娅"
 * @property {string|null} parameterName // 参数名字，例如 "好感度" 或 "短期情绪"
 * @property {string|null} targetName    // 可选目标名字，例如 "林原"
 */

/**
 * 解析人类可读的变量路径字符串。
 *
 * 约定形式示例：
 * - "艾莉娅.好感度.林原"
 * - "艾莉娅.短期情绪"
 * - "全局.天气"
 *
 * 实际允许任意段数，至少会尝试提取：
 * - 第一段：subjectName
 * - 第二段：parameterName
 * - 第三段（如果存在）：targetName
 *
 * @param {string} path
 * @returns {ParsedVariablePath}
 */
export function parseVariablePath(path) {
  const raw = String(path ?? "");
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      raw,
      segments: [],
      subjectName: null,
      parameterName: null,
      targetName: null
    };
  }

  const segments = trimmed
    .split(".")
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const subjectName = segments[0] ?? null;
  const parameterName = segments[1] ?? null;
  const targetName = segments[2] ?? null;

  return {
    raw,
    segments,
    subjectName,
    parameterName,
    targetName
  };
}

/**
 * 在解析模型输出的 CeVariableOp 基础上，附加解析好的路径信息。
 * 注意：本函数不修改传入对象，而是返回一个浅拷贝。
 *
 * @param {import("./change-set.js").CeVariableOp} op
 * @returns {import("./change-set.js").CeVariableOp & { parsedPath?: ParsedVariablePath }}
 */
export function withParsedPath(op) {
  if (!op || typeof op !== "object") {
    return op;
  }

  const path = op.path || op.meta?.path || op.meta?.name;
  if (!path) {
    return op;
  }

  const parsed = parseVariablePath(path);
  return {
    ...op,
    parsedPath: parsed
  };
}

/**
 * 匹配提示条件，支持路径式参数引用。
 *
 * 参数名解析规则：
 * 1. 如果 parameterName 包含 "."，解析为完整路径 "主体名.参数名"
 * 2. 如果不包含 "." 且提供了 ownerContext，自动补全为 "ownerContext.parameterName"
 * 3. 否则直接使用 parameterName（用于 scene/global scope）
 *
 * @param {CePromptRuleCondition[]} conditions - 条件列表
 * @param {(fullPath: string) => any} getValueByPath - 通过完整路径获取参数值的函数
 * @param {string|null} [ownerContext] - 当前提示条目的 ownerName，用于自动补全路径
 * @returns {boolean}
 */
export function matchPromptConditions(conditions, getValueByPath, ownerContext = null) {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return true; // 无条件视为始终生效
  }
  if (typeof getValueByPath !== "function") {
    return false;
  }

  for (const cond of conditions) {
    if (!cond || typeof cond !== "object") continue;
    
    let parameterPath = cond.parameterName;
    
    // 路径补全逻辑
    if (!parameterPath.includes(".") && ownerContext) {
      // 自动补全: "好感度" -> "樱井美咲.好感度"
      parameterPath = `${ownerContext}.${parameterPath}`;
    }
    // 如果已经包含 "."，直接使用: "樱井美咲.好感度"
    // 如果不包含 "." 且无 ownerContext，直接使用: "天气"（scene/global）
    
    const actual = getValueByPath(parameterPath);
    const expected = cond.value;
    switch (cond.op) {
      case "==":
        if (actual !== expected) return false;
        break;
      case "!=":
        if (actual === expected) return false;
        break;
      case ">":
        if (!(typeof actual === "number" && actual > expected)) return false;
        break;
      case ">=":
        if (!(typeof actual === "number" && actual >= expected)) return false;
        break;
      case "<":
        if (!(typeof actual === "number" && actual < expected)) return false;
        break;
      case "<=":
        if (!(typeof actual === "number" && actual <= expected)) return false;
        break;
      case "in":
        if (!Array.isArray(expected) || !expected.includes(actual)) return false;
        break;
      case "not_in":
        if (Array.isArray(expected) && expected.includes(actual)) return false;
        break;
      default:
        // 未知操作符视为不匹配，避免意外放行
        return false;
    }
  }

  return true;
}