// 格式化工具函数

/**
 * 将条件数组格式化为文本，每行一个条件
 * @param {import("../../../core/variables.js").CePromptRuleCondition[]} conditions
 * @returns {string}
 */
export function formatConditions(conditions) {
  if (!Array.isArray(conditions) || !conditions.length) return "";
  return conditions
    .map((c) => {
      if (!c || !c.parameterName) return "";
      const op = c.op || "==";
      if (op === "in" || op === "not_in") {
        const values = Array.isArray(c.value) ? c.value.join(" / ") : String(c.value ?? "");
        return `${c.parameterName} ${op} ${values}`;
      }
      return `${c.parameterName} ${op} ${c.value}`;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * 基于参数定义生成「参数名 → 定义」映射
 * @param {import("../../../core/variables.js").CeParameterDefinition[]} parameters
 * @returns {Record<string, import("../../../core/variables.js").CeParameterDefinition>}
 */
export function buildParameterDefsByName(parameters) {
  /** @type {Record<string, import("../../../core/variables.js").CeParameterDefinition>} */
  const map = {};
  (parameters || []).forEach((p) => {
    if (!p || typeof p.name !== "string") return;
    const key = p.name.trim();
    if (!key) return;
    map[key] = p;
  });
  return map;
}