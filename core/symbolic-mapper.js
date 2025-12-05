// 符号化操作映射模块：将符号化意图（up_small/up_medium/up_large等）映射为具体数值变化
// 本模块不依赖 SillyTavern，只提供纯数据逻辑

/**
 * @typedef {import("./variables.js").CeParameterDefinition} CeParameterDefinition
 * @typedef {import("./change-set.js").CeVariableOp} CeVariableOp
 */

/**
 * 符号化操作的默认映射配置
 * 这些值可以被参数定义中的自定义配置覆盖
 */
const DEFAULT_SYMBOLIC_MAPPING = {
  // 数值型参数的符号化增量（相对于range的百分比）
  up_small: 0.05,    // 5% of range
  up_medium: 0.10,   // 10% of range
  up_large: 0.20,    // 20% of range
  down_small: -0.05,
  down_medium: -0.10,
  down_large: -0.20,
  
  // 无range时的绝对增量
  up_small_absolute: 5,
  up_medium_absolute: 10,
  up_large_absolute: 20,
  down_small_absolute: -5,
  down_medium_absolute: -10,
  down_large_absolute: -20
};

/**
 * 将符号化操作应用到数值型参数，返回具体的数值变化量
 * 
 * @param {string} symbol - 符号操作名，如 "up_small", "down_large", "set_70" 等
 * @param {number} currentValue - 当前参数值
 * @param {CeParameterDefinition} paramDef - 参数定义
 * @returns {{ op: "set"|"add", value: number, clamped: boolean }} 
 *   - op: 最终操作类型
 *   - value: 具体数值（set时为目标值，add时为增量）
 *   - clamped: 是否因为range限制而被截断
 */
export function resolveSymbolicForNumber(symbol, currentValue, paramDef) {
  if (!symbol || typeof symbol !== "string") {
    return { op: "set", value: currentValue, clamped: false };
  }

  const sym = symbol.trim().toLowerCase();
  
  // 处理 set_xxx 形式：直接设置到指定值
  const setMatch = /^set_(-?\d+(?:\.\d+)?)$/i.exec(sym);
  if (setMatch) {
    const targetValue = Number(setMatch[1]);
    const clamped = clampToRange(targetValue, paramDef.range);
    return {
      op: "set",
      value: clamped.value,
      clamped: clamped.wasClamped
    };
  }

  // 处理增量符号操作
  const range = paramDef.range;
  let delta = 0;

  if (range && typeof range.min === "number" && typeof range.max === "number") {
    // 有range：使用百分比增量
    const rangeSize = range.max - range.min;
    const mapping = DEFAULT_SYMBOLIC_MAPPING;
    
    switch (sym) {
      case "up_small":
        delta = rangeSize * mapping.up_small;
        break;
      case "up_medium":
        delta = rangeSize * mapping.up_medium;
        break;
      case "up_large":
        delta = rangeSize * mapping.up_large;
        break;
      case "down_small":
        delta = rangeSize * mapping.down_small;
        break;
      case "down_medium":
        delta = rangeSize * mapping.down_medium;
        break;
      case "down_large":
        delta = rangeSize * mapping.down_large;
        break;
      default:
        // 未知符号，不做变化
        return { op: "set", value: currentValue, clamped: false };
    }
  } else {
    // 无range：使用绝对增量
    const mapping = DEFAULT_SYMBOLIC_MAPPING;
    
    switch (sym) {
      case "up_small":
        delta = mapping.up_small_absolute;
        break;
      case "up_medium":
        delta = mapping.up_medium_absolute;
        break;
      case "up_large":
        delta = mapping.up_large_absolute;
        break;
      case "down_small":
        delta = mapping.down_small_absolute;
        break;
      case "down_medium":
        delta = mapping.down_medium_absolute;
        break;
      case "down_large":
        delta = mapping.down_large_absolute;
        break;
      default:
        return { op: "set", value: currentValue, clamped: false };
    }
  }

  // 计算新值并应用range限制
  const newValue = currentValue + delta;
  const clamped = clampToRange(newValue, range);

  return {
    op: "set",
    value: clamped.value,
    clamped: clamped.wasClamped
  };
}

/**
 * 将符号化操作应用到枚举型参数，返回具体的枚举值变化
 * 
 * @param {string} symbol - 符号操作名，如 "next", "prev", "set_暧昧" 等
 * @param {any} currentValue - 当前参数值
 * @param {CeParameterDefinition} paramDef - 参数定义
 * @returns {{ op: "set", value: any, moved: boolean }}
 *   - op: 始终为 "set"
 *   - value: 目标枚举值
 *   - moved: 是否实际发生了移动
 */
export function resolveSymbolicForEnum(symbol, currentValue, paramDef) {
  if (!symbol || typeof symbol !== "string") {
    return { op: "set", value: currentValue, moved: false };
  }

  const sym = symbol.trim().toLowerCase();
  const enumValues = Array.isArray(paramDef.enumValues) ? paramDef.enumValues : [];
  
  if (!enumValues.length) {
    return { op: "set", value: currentValue, moved: false };
  }

  // 处理 set_xxx 形式：直接设置到指定枚举值
  const setMatch = /^set_(.+)$/i.exec(sym);
  if (setMatch) {
    const targetValue = setMatch[1].trim();
    // 检查目标值是否在枚举列表中
    if (enumValues.includes(targetValue)) {
      return {
        op: "set",
        value: targetValue,
        moved: targetValue !== currentValue
      };
    }
    // 目标值不在枚举列表中，保持不变
    return { op: "set", value: currentValue, moved: false };
  }

  // 处理 next/prev 操作：在枚举列表中移动
  const currentIndex = enumValues.indexOf(currentValue);
  
  if (sym === "next") {
    if (currentIndex < 0) {
      // 当前值不在列表中，设置为第一个
      return { op: "set", value: enumValues[0], moved: true };
    }
    if (currentIndex >= enumValues.length - 1) {
      // 已经是最后一个，保持不变
      return { op: "set", value: currentValue, moved: false };
    }
    // 移动到下一个
    return { op: "set", value: enumValues[currentIndex + 1], moved: true };
  }

  if (sym === "prev" || sym === "previous") {
    if (currentIndex < 0) {
      // 当前值不在列表中，设置为最后一个
      return { op: "set", value: enumValues[enumValues.length - 1], moved: true };
    }
    if (currentIndex <= 0) {
      // 已经是第一个，保持不变
      return { op: "set", value: currentValue, moved: false };
    }
    // 移动到上一个
    return { op: "set", value: enumValues[currentIndex - 1], moved: true };
  }

  // 未知符号，保持不变
  return { op: "set", value: currentValue, moved: false };
}

/**
 * 将数值限制在参数定义的range范围内
 * 
 * @param {number} value - 待限制的数值
 * @param {{ min?: number, max?: number }} [range] - 范围定义
 * @returns {{ value: number, wasClamped: boolean }}
 */
function clampToRange(value, range) {
  if (!range || typeof range !== "object") {
    return { value, wasClamped: false };
  }

  let clamped = value;
  let wasClamped = false;

  if (typeof range.min === "number" && clamped < range.min) {
    clamped = range.min;
    wasClamped = true;
  }

  if (typeof range.max === "number" && clamped > range.max) {
    clamped = range.max;
    wasClamped = true;
  }

  return { value: clamped, wasClamped };
}

/**
 * 将符号化操作解析为具体的数值操作
 * 这是对外的统一入口，会根据参数类型自动选择合适的解析策略
 * 
 * @param {CeVariableOp} variableOp - 变量操作对象
 * @param {number|string|boolean|any} currentValue - 当前参数值
 * @param {CeParameterDefinition} paramDef - 参数定义
 * @returns {{ op: "set"|"add", value: any, meta?: any }}
 *   - op: 最终操作类型
 *   - value: 具体数值或枚举值
 *   - meta: 可选的元信息（如是否被截断、是否移动等）
 */
export function resolveSymbolicOperation(variableOp, currentValue, paramDef) {
  if (!variableOp || variableOp.op !== "symbolic") {
    // 非符号化操作，直接返回原操作
    return {
      op: variableOp.op || "set",
      value: variableOp.value
    };
  }

  const symbol = variableOp.symbol;
  if (!symbol) {
    // 没有符号，保持当前值
    return { op: "set", value: currentValue };
  }

  const paramType = paramDef?.type || "text";

  if (paramType === "number") {
    const numValue = typeof currentValue === "number" ? currentValue : 0;
    const result = resolveSymbolicForNumber(symbol, numValue, paramDef);
    return {
      op: result.op,
      value: result.value,
      meta: { clamped: result.clamped }
    };
  }

  if (paramType === "enum") {
    const result = resolveSymbolicForEnum(symbol, currentValue, paramDef);
    return {
      op: result.op,
      value: result.value,
      meta: { moved: result.moved }
    };
  }

  // 其他类型（boolean/text等）不支持符号化操作，保持当前值
  return { op: "set", value: currentValue };
}