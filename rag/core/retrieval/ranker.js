// 结果排序与过滤模块
// 负责对检索结果进行排序、去重和Token预算管理

/**
 * 估算文本的Token数量（粗略估算）
 * @param {string} text - 文本内容
 * @returns {number}
 */
function estimateTokenCount(text) {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  
  // 粗略估算：中文约1.5字符/token，英文约4字符/token
  // 这里使用简单的混合估算
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

/**
 * 对检索结果进行排序和过滤
 * @param {Array<Object>} results - 检索结果列表
 * @param {Object} config - 排序配置
 * @param {number} config.tokenBudget - Token预算
 * @param {boolean} config.deduplicate - 是否去重
 * @param {string} config.deduplicateBy - 去重依据 ('docId' | 'similarity')
 * @returns {Array<Object>}
 */
export function rankResults(results, config = {}) {
  if (!Array.isArray(results) || results.length === 0) {
    return [];
  }

  const {
    tokenBudget = 2000,
    deduplicate = true,
    deduplicateBy = 'docId'
  } = config;

  let ranked = [...results];

  // 1. 按重要性和分数排序
  ranked.sort((a, b) => {
    // 优先级：must_have > nice_to_have
    const importanceA = a.importance === 'must_have' ? 2 : 1;
    const importanceB = b.importance === 'must_have' ? 2 : 1;
    
    if (importanceA !== importanceB) {
      return importanceB - importanceA;
    }
    
    // 相同重要性，按分数排序（支持多种分数类型）
    const scoreA = a.fusionScore || a.similarity || a.bm25Score || a.keywordScore || 0;
    const scoreB = b.fusionScore || b.similarity || b.bm25Score || b.keywordScore || 0;
    return scoreB - scoreA;
  });

  // 2. 去重
  if (deduplicate) {
    if (deduplicateBy === 'docId') {
      // 按文档ID去重，保留每个文档的最高分片段
      const docMap = new Map();
      for (const result of ranked) {
        const docId = result.chunk?.docId;
        if (!docId) continue;
        
        const currentScore = result.fusionScore || result.similarity || result.bm25Score || result.keywordScore || 0;
        const existingScore = docMap.has(docId)
          ? (docMap.get(docId).fusionScore || docMap.get(docId).similarity || docMap.get(docId).bm25Score || docMap.get(docId).keywordScore || 0)
          : -1;
        
        if (!docMap.has(docId) || existingScore < currentScore) {
          docMap.set(docId, result);
        }
      }
      ranked = Array.from(docMap.values());
    } else if (deduplicateBy === 'similarity') {
      // 按相似度去重，移除过于相似的结果
      const filtered = [];
      for (const result of ranked) {
        const resultScore = result.fusionScore || result.similarity || result.bm25Score || result.keywordScore || 0;
        const isDuplicate = filtered.some(existing => {
          const existingScore = existing.fusionScore || existing.similarity || existing.bm25Score || existing.keywordScore || 0;
          return Math.abs(existingScore - resultScore) < 0.01;
        });
        if (!isDuplicate) {
          filtered.push(result);
        }
      }
      ranked = filtered;
    }
  }

  // 3. Token预算管理
  const withinBudget = [];
  let currentTokens = 0;

  for (const result of ranked) {
    const text = result.chunk?.text || '';
    const tokens = estimateTokenCount(text);
    
    if (currentTokens + tokens <= tokenBudget) {
      withinBudget.push({
        ...result,
        estimatedTokens: tokens
      });
      currentTokens += tokens;
    } else {
      // 如果是 must_have 且预算还有空间，尝试截断
      if (result.importance === 'must_have' && currentTokens < tokenBudget) {
        const remainingBudget = tokenBudget - currentTokens;
        const truncatedText = truncateText(text, remainingBudget);
        withinBudget.push({
          ...result,
          chunk: {
            ...result.chunk,
            text: truncatedText
          },
          estimatedTokens: estimateTokenCount(truncatedText),
          truncated: true
        });
        break;
      } else {
        break;
      }
    }
  }

  return withinBudget;
}

/**
 * 截断文本以适应Token预算
 * @param {string} text - 原始文本
 * @param {number} tokenBudget - Token预算
 * @returns {string}
 */
function truncateText(text, tokenBudget) {
  if (!text || tokenBudget <= 0) {
    return '';
  }

  // 粗略估算需要保留的字符数
  const estimatedChars = Math.floor(tokenBudget * 3);
  
  if (text.length <= estimatedChars) {
    return text;
  }

  // 截断并添加省略号
  return text.substring(0, estimatedChars) + '...';
}

/**
 * 合并多个查询的结果
 * @param {Array<Array<Object>>} queryResults - 多个查询的结果列表
 * @param {Object} config - 合并配置
 * @returns {Array<Object>}
 */
export function mergeQueryResults(queryResults, config = {}) {
  if (!Array.isArray(queryResults) || queryResults.length === 0) {
    return [];
  }

  // 展平所有结果
  const allResults = [];
  for (const results of queryResults) {
    if (Array.isArray(results)) {
      allResults.push(...results);
    }
  }

  // 使用 rankResults 进行统一排序和过滤
  return rankResults(allResults, config);
}

/**
 * 按集合分组结果
 * @param {Array<Object>} results - 检索结果
 * @returns {Map<string, Array<Object>>}
 */
export function groupByCollection(results) {
  const grouped = new Map();
  
  for (const result of results) {
    const collectionId = result.collectionId || 'unknown';
    if (!grouped.has(collectionId)) {
      grouped.set(collectionId, []);
    }
    grouped.get(collectionId).push(result);
  }
  
  return grouped;
}

/**
 * 生成结果摘要统计
 * @param {Array<Object>} results - 检索结果
 * @returns {Object}
 */
export function generateResultStats(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return {
      totalResults: 0,
      totalTokens: 0,
      avgSimilarity: 0,
      collections: []
    };
  }

  const totalTokens = results.reduce((sum, r) => sum + (r.estimatedTokens || 0), 0);
  
  // 计算平均分数（支持多种分数类型）
  const scores = results.map(r => r.fusionScore || r.similarity || r.bm25Score || r.keywordScore || 0);
  const avgScore = scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : 0;
  
  const collectionSet = new Set(results.map(r => r.collectionId).filter(Boolean));
  
  return {
    totalResults: results.length,
    totalTokens,
    avgSimilarity: Math.round(avgScore * 100) / 100,
    collections: Array.from(collectionSet)
  };
}