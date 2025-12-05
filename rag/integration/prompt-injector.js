// RAG提示注入模块
// 负责将检索结果格式化为提示文本

import { retrieveWorldContext } from './rag-retriever.js';

/**
 * 将检索结果格式化为提示文本
 * @param {Array<Object>} results - 检索结果
 * @returns {string}
 */
function formatResultsAsPrompt(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return '';
  }

  const lines = [];
  lines.push('【世界观设定】');
  lines.push('');

  // 按集合分组
  const byCollection = new Map();
  for (const result of results) {
    const collectionName = result.collectionName || result.collectionId || '未知集合';
    if (!byCollection.has(collectionName)) {
      byCollection.set(collectionName, []);
    }
    byCollection.get(collectionName).push(result);
  }

  // 输出每个集合的结果
  for (const [collectionName, collectionResults] of byCollection) {
    lines.push(`## 来源：${collectionName}`);
    lines.push('');

    for (const result of collectionResults) {
      const chunk = result.chunk;
      if (!chunk) continue;

      const docTitle = chunk.metadata?.docTitle || '未知文档';
      const text = chunk.text || '';
      const similarity = result.similarity ? `(相似度: ${(result.similarity * 100).toFixed(1)}%)` : '';

      lines.push(`### ${docTitle} ${similarity}`);
      lines.push(text);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * 注入RAG检索结果到提示中
 * @param {Object} worldContextIntent - WorldContextIntent 对象
 * @param {Object} loreConfig - loreConfig 对象
 * @returns {Promise<string>} 格式化的提示文本
 */
export async function injectRagPrompts(worldContextIntent, loreConfig) {
  if (!worldContextIntent || !loreConfig) {
    return '';
  }

  try {
    // 执行检索
    const retrievalResult = await retrieveWorldContext(worldContextIntent, loreConfig);

    if (!retrievalResult.results || retrievalResult.results.length === 0) {
      console.log('[RAG PromptInjector] 没有检索到相关内容');
      return '';
    }

    // 格式化为提示文本
    const promptText = formatResultsAsPrompt(retrievalResult.results);

    // 添加统计信息（可选，用于调试）
    const stats = retrievalResult.stats;
    if (stats && stats.totalResults > 0) {
      console.log(`[RAG PromptInjector] 注入 ${stats.totalResults} 个片段，约 ${stats.totalTokens} tokens`);
    }

    return promptText;

  } catch (err) {
    console.error('[RAG PromptInjector] 注入失败:', err);
    return '';
  }
}

/**
 * 生成RAG提示块的摘要（用于调试）
 * @param {string} promptText - 提示文本
 * @returns {Object}
 */
export function summarizeRagPrompt(promptText) {
  if (!promptText || typeof promptText !== 'string') {
    return {
      isEmpty: true,
      charCount: 0,
      lineCount: 0,
      sectionCount: 0
    };
  }

  const lines = promptText.split('\n');
  const sections = (promptText.match(/###/g) || []).length;

  return {
    isEmpty: false,
    charCount: promptText.length,
    lineCount: lines.length,
    sectionCount: sections
  };
}

/**
 * 验证RAG提示文本的格式
 * @param {string} promptText - 提示文本
 * @returns {Object} 验证结果 {valid: boolean, warnings: string[]}
 */
export function validateRagPrompt(promptText) {
  const warnings = [];

  if (!promptText || typeof promptText !== 'string') {
    return { valid: true, warnings: ['提示文本为空'] };
  }

  // 检查是否包含标题
  if (!promptText.includes('【世界观设定】')) {
    warnings.push('缺少标题标记');
  }

  // 检查是否有实际内容
  const contentLines = promptText.split('\n').filter(line => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('【');
  });

  if (contentLines.length === 0) {
    warnings.push('没有实际内容');
  }

  // 检查长度
  if (promptText.length > 10000) {
    warnings.push(`提示文本过长 (${promptText.length} 字符)，可能超出Token预算`);
  }

  return {
    valid: warnings.length === 0,
    warnings
  };
}