// 条件验证与解析工具

/**
 * 条件解析：每行 "参数名 OP 值"
 * 支持 OP: ==, !=, >, >=, <, <=, in, not_in
 * in / not_in 的值可用 "A / B / C" 或 "A,B,C"
 *
 * 返回结构包含：
 * - conditions: 解析成功的条件数组（仅包含格式正确且语义合法的行）；
 * - perLine: 每一行的解析结果（含是否出错与错误原因）；
 * - hasError: 是否存在至少一行无法解析或语义非法；
 * - errorMessage: 简要错误提示（供 tooltip 使用，通常为聚合结果）；
 * - normalizedText: 自动修正后、重新拼接的条件文本（例如自动补空格）。
 *
 * 自动修正内容包括：
 * - 对符号运算符（==, !=, >, >=, <, <=）自动补齐两侧空格：
 *   - 例如 "好感度>=60" 会被修正为 "好感度 >= 60"；
 *   - 多个空格会被归一为单个空格。
 *
 * 语义校验（当提供 parameterDefsByName 时启用）：
 * - 若条件引用了未在参数表中定义的参数名，整行标记为错误；
 * - 对数值型参数（type: "number"）：
 *   - 检查值是否为数值；若定义了 range.min / range.max，则检查是否在范围内；
 * - 对枚举型参数（type: "enum"）：
 *   - 检查值是否落在 enumValues 列表中；
 * - 对布尔型参数（type: "boolean"）：
 *   - 检查值是否为 true / false（单值或列表）。
 *
 * @param {string} text
 * @param {Record<string, import("../../../core/variables.js").CeParameterDefinition>} [parameterDefsByName]
 * @returns {{
 *   conditions: import("../../../core/variables.js").CePromptRuleCondition[],
 *   perLine: { index: number, raw: string, fixed: string, hasError: boolean, reason: string }[],
 *   hasError: boolean,
 *   errorMessage: string,
 *   normalizedText: string
 * }}
 */
export function parseConditions(text, parameterDefsByName) {
  const rawLines = String(text ?? "").split(/\r?\n/);
  /** @type {import("../../../core/variables.js").CePromptRuleCondition[]} */
  const conditions = [];
  /** @type {{ index: number, raw: string, fixed: string, hasError: boolean, reason: string }[]} */
  const perLine = [];
  const ops = ["!=", ">=", "<=", "==", ">", "<", "in", "not_in"];

  const paramMap =
    parameterDefsByName && typeof parameterDefsByName === "object" ? parameterDefsByName : null;

  let hasAnyError = false;
  const normalizedLines = [];

  rawLines.forEach((raw, index) => {
    const original = raw;
    let line = raw.trim();

    if (!line) {
      // 空行既不算错误，也不会产生条件，直接保留原文
      perLine.push({ index, raw: original, fixed: original, hasError: false, reason: "" });
      normalizedLines.push(original);
      return;
    }

    // 自动为符号运算符补空格：好感度>=60 -> 好感度 >= 60
    let fixed = line;
    for (const symOp of ["!=", ">=", "<=", "==", ">", "<"]) {
      if (fixed.includes(symOp)) {
        const re = new RegExp(`\\s*${symOp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`);
        fixed = fixed.replace(re, ` ${symOp} `);
        break;
      }
    }
    // 归一化空格
    fixed = fixed.replace(/\s+/g, " ").trim();

    let matchedOp = null;
    let idx = -1;
    for (const op of ops) {
      idx = fixed.indexOf(` ${op} `);
      if (idx > 0) {
        matchedOp = op;
        break;
      }
    }

    if (!matchedOp) {
      hasAnyError = true;
      perLine.push({
        index,
        raw: original,
        fixed,
        hasError: true,
        reason: "缺少合法运算符（需要 ==, !=, >, >=, <, <=, in, not_in）"
      });
      normalizedLines.push(fixed);
      return;
    }

    const left = fixed.slice(0, idx).trim();
    const right = fixed.slice(idx + matchedOp.length + 2).trim();

    if (!left) {
      hasAnyError = true;
      perLine.push({
        index,
        raw: original,
        fixed,
        hasError: true,
        reason: "缺少参数名（运算符左侧不能为空）"
      });
      normalizedLines.push(fixed);
      return;
    }

    /** @type {any} */
    let value;
    if (matchedOp === "in" || matchedOp === "not_in") {
      const arr = right.split(/[\/,]/).map((s) => s.trim()).filter(Boolean);
      if (!arr.length) {
        hasAnyError = true;
        perLine.push({
          index,
          raw: original,
          fixed,
          hasError: true,
          reason: "in / not_in 右侧缺少有效值"
        });
        normalizedLines.push(fixed);
        return;
      }
      value = arr;
    } else if (right === "") {
      hasAnyError = true;
      perLine.push({
        index,
        raw: original,
        fixed,
        hasError: true,
        reason: "运算符右侧值为空"
      });
      normalizedLines.push(fixed);
      return;
    } else if (!Number.isNaN(Number(right))) {
      value = Number(right);
    } else if (right === "true" || right === "false") {
      value = right === "true";
    } else {
      value = right;
    }

    // 基于参数定义的语义校验（若提供了 parameterDefsByName）
    /** @type {import("../../../core/variables.js").CeParameterDefinition | undefined} */
    const paramDef = paramMap ? paramMap[left] : undefined;

    if (paramMap && !paramDef) {
      hasAnyError = true;
      perLine.push({
        index,
        raw: original,
        fixed,
        hasError: true,
        reason: `未在参数列表中找到名为「${left}」的参数，请先在「参数」Tab 中定义它`
      });
      normalizedLines.push(fixed);
      return;
    }

    /** @type {any} */
    let finalValue = value;
    let semanticError = "";

    if (paramDef && paramDef.type) {
      const paramType = paramDef.type;

      if (paramType === "number") {
        const toNumber = (v) => {
          if (typeof v === "number") return v;
          const n = Number(v);
          return Number.isNaN(n) ? null : n;
        };

        if (matchedOp === "in" || matchedOp === "not_in") {
          if (!Array.isArray(value)) {
            semanticError = "数值型参数的 in / not_in 条件应使用数值列表";
          } else {
            const nums = value.map(toNumber);
            if (nums.some((n) => n === null)) {
              semanticError = "数值型参数的列表中包含无法解析为数值的值";
            } else {
              finalValue = nums;
            }
          }
        } else {
          const n = toNumber(value);
          if (n === null) {
            semanticError = "该参数为数值型，但值不是合法数值";
          } else {
            finalValue = n;
          }
        }

        // 范围检查
        if (
          !semanticError &&
          paramDef.range &&
          (paramDef.range.min != null || paramDef.range.max != null)
        ) {
          const min = paramDef.range.min;
          const max = paramDef.range.max;
          const arr = Array.isArray(finalValue) ? finalValue : [finalValue];
          const out = arr.filter(
            (n) =>
              typeof n === "number" &&
              !Number.isNaN(n) &&
              ((min != null && n < min) || (max != null && n > max))
          );
          if (out.length) {
            if (min != null && max != null) {
              semanticError = `数值 ${out.join(", ")} 超出该参数允许范围 [${min}, ${max}]`;
            } else if (min != null) {
              semanticError = `数值 ${out.join(", ")} 小于该参数允许的最小值 ${min}`;
            } else {
              semanticError = `数值 ${out.join(", ")} 大于该参数允许的最大值 ${max}`;
            }
          }
        }
      } else if (paramType === "enum") {
        const enumValues = Array.isArray(paramDef.enumValues) ? paramDef.enumValues : [];

        if (!enumValues.length) {
          semanticError = "该参数为枚举型，但当前未在参数定义中配置枚举值列表";
        } else if (matchedOp === "in" || matchedOp === "not_in") {
          if (!Array.isArray(value)) {
            semanticError = "枚举型参数的 in / not_in 条件应使用枚举值列表";
          } else {
            const vals = value.map((v) => String(v));
            finalValue = vals;
            const invalid = vals.filter((v) => !enumValues.includes(v));
            if (invalid.length) {
              semanticError = `列表中存在不在枚举列表中的值：${invalid.join(", ")}`;
            }
          }
        } else {
          const vStr = String(value);
          finalValue = vStr;
          if (!enumValues.includes(vStr)) {
            semanticError = `值「${vStr}」不在该参数的枚举列表中`;
          }
        }
      } else if (paramType === "boolean") {
        const toBool = (v) => {
          if (typeof v === "boolean") return v;
          if (v === "true" || v === true) return true;
          if (v === "false" || v === false) return false;
          return null;
        };

        if (matchedOp === "in" || matchedOp === "not_in") {
          if (!Array.isArray(value)) {
            semanticError = "布尔型参数的 in / not_in 条件应使用 true/false 列表";
          } else {
            const parsed = value.map(toBool);
            if (parsed.some((v) => v === null)) {
              semanticError = "布尔型参数的列表值必须为 true 或 false";
            } else {
              finalValue = parsed;
            }
          }
        } else {
          const b = toBool(value);
          if (b === null) {
            semanticError = "布尔型参数的值应为 true 或 false";
          } else {
            finalValue = b;
          }
        }
      } else {
        // 文本型等其它类型，目前不做额外值检查
        finalValue = value;
      }
    }

    if (semanticError) {
      hasAnyError = true;
      perLine.push({
        index,
        raw: original,
        fixed,
        hasError: true,
        reason: semanticError
      });
      normalizedLines.push(fixed);
      return;
    }

    conditions.push({
      parameterName: left,
      op: matchedOp,
      value: finalValue
    });

    perLine.push({
      index,
      raw: original,
      fixed,
      hasError: false,
      reason: ""
    });
    normalizedLines.push(fixed);
  });

  const errorMessage = hasAnyError
    ? "部分参数条件存在语法或语义错误，将被忽略。请检查红色标记的行，并使用形如「参数名 OP 值」，OP 为 ==, !=, >, >=, <, <=, in, not_in。"
    : "";

  return {
    conditions,
    perLine,
    hasError: hasAnyError,
    errorMessage,
    normalizedText: normalizedLines.join("\n")
  };
}