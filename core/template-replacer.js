// 模板替换模块：处理 CharacterEngine 专属的变量和提示词占位符
// 兼容 SillyTavern 原生的 {{}} 宏系统

/**
 * 替换提示文本中的 CharacterEngine 变量和提示词占位符
 * 
 * 支持的占位符格式：
 * - {{ce-var::参数名}} - 获取当前角色的参数值
 * - {{ce-var::角色名.参数名}} - 获取指定角色的参数值
 * - {{ce-var::角色名.参数名.目标}} - 获取关系型参数值
 * - {{ce-prompt::提示类型名}} - 获取当前角色的提示内容
 * - {{ce-prompt::角色名.提示类型名}} - 获取指定角色的提示内容
 * 
 * @param {string} text - 原始提示文本
 * @param {Function} getValueByName - 获取参数值的函数 (parameterName) => value
 * @param {Object.<string, import("./prompt-slots.js").PromptBundle>} promptBundles - 所有角色的提示 bundles
 * @param {string} currentOwnerName - 当前角色名（用于简写形式）
 * @param {number} [depth=0] - 递归深度（防止循环引用）
 * @returns {string} 替换后的文本
 */
export function replaceCeTemplates(text, getValueByName, promptBundles, currentOwnerName, depth = 0) {
  if (!text || typeof text !== 'string') {
    return text || '';
  }

  // 防止无限递归（最多3层）
  const MAX_DEPTH = 3;
  if (depth >= MAX_DEPTH) {
    // eslint-disable-next-line no-console
    console.warn('[CharacterEngine] Template replacement max depth reached, possible circular reference');
    return text;
  }

  let result = text;
  let hasReplacement = false;

  // 1. 替换 {{ce-var::路径}} 形式的变量占位符
  result = result.replace(/\{\{ce-var::([^}]+)\}\}/g, (match, path) => {
    const trimmedPath = path.trim();
    if (!trimmedPath) return match;

    // 尝试获取变量值
    const value = getValueByName(trimmedPath);
    
    if (value !== undefined && value !== null) {
      hasReplacement = true;
      // 将值转换为字符串
      if (typeof value === 'object') {
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      }
      return String(value);
    }

    // 未找到值，保持原样（可能是拼写错误或参数不存在）
    return match;
  });

  // 2. 替换 {{ce-prompt::路径}} 形式的提示词占位符
  result = result.replace(/\{\{ce-prompt::([^}]+)\}\}/g, (match, path) => {
    const trimmedPath = path.trim();
    if (!trimmedPath) return match;

    const parts = trimmedPath.split('.');
    let ownerName, promptTypeName;

    if (parts.length === 1) {
      // {{ce-prompt::语气}} - 使用当前角色
      ownerName = currentOwnerName;
      promptTypeName = parts[0];
    } else {
      // {{ce-prompt::上原惠.语气}} - 使用指定角色
      ownerName = parts[0];
      promptTypeName = parts.slice(1).join('.');
    }

    // 查找对应的提示内容
    const bundle = promptBundles[ownerName];
    if (bundle && bundle.byPromptType && bundle.byPromptType[promptTypeName]) {
      hasReplacement = true;
      const promptText = bundle.byPromptType[promptTypeName];
      
      // 递归替换提示内容中的占位符（防止循环引用）
      return replaceCeTemplates(
        promptText,
        getValueByName,
        promptBundles,
        ownerName,
        depth + 1
      );
    }

    // 未找到提示内容，保持原样
    return match;
  });

  // 如果进行了替换且深度为0，再进行一次替换以处理嵌套的占位符
  if (hasReplacement && depth === 0) {
    result = replaceCeTemplates(result, getValueByName, promptBundles, currentOwnerName, depth + 1);
  }

  return result;
}

/**
 * 批量替换 PromptBundles 中所有提示文本的占位符
 * 
 * @param {Object.<string, import("./prompt-slots.js").PromptBundle>} bundles - 提示 bundles
 * @param {Function} getValueByName - 获取参数值的函数
 * @returns {Object.<string, import("./prompt-slots.js").PromptBundle>} 替换后的 bundles
 */
export function replaceBundlesTemplates(bundles, getValueByName) {
  if (!bundles || typeof bundles !== 'object') {
    return bundles;
  }

  // 创建深拷贝以避免修改原始数据
  const result = {};

  for (const ownerName in bundles) {
    if (!Object.prototype.hasOwnProperty.call(bundles, ownerName)) continue;

    const bundle = bundles[ownerName];
    if (!bundle || !bundle.byPromptType) continue;

    result[ownerName] = {
      ownerName: bundle.ownerName,
      byPromptType: {}
    };

    // 替换每个提示类型的文本
    for (const promptTypeName in bundle.byPromptType) {
      if (!Object.prototype.hasOwnProperty.call(bundle.byPromptType, promptTypeName)) continue;

      const originalText = bundle.byPromptType[promptTypeName];
      result[ownerName].byPromptType[promptTypeName] = replaceCeTemplates(
        originalText,
        getValueByName,
        bundles, // 传入原始 bundles 以支持跨角色引用
        ownerName
      );
    }
  }

  return result;
}

/**
 * 检测文本中是否包含 CharacterEngine 占位符
 * 
 * @param {string} text - 要检测的文本
 * @returns {boolean} 是否包含占位符
 */
export function hasCeTemplates(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }

  return /\{\{ce-(?:var|prompt)::/.test(text);
}

/**
 * 提取文本中所有的 CharacterEngine 占位符
 * 用于调试和验证
 * 
 * @param {string} text - 要分析的文本
 * @returns {Array<{type: 'var'|'prompt', path: string, raw: string}>} 占位符列表
 */
export function extractCeTemplates(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const templates = [];
  const regex = /\{\{ce-(var|prompt)::([^}]+)\}\}/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    templates.push({
      type: match[1], // 'var' or 'prompt'
      path: match[2].trim(),
      raw: match[0]
    });
  }

  return templates;
}