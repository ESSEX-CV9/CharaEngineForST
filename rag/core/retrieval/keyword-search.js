// BM25关键字检索模块
// 实现BM25算法进行关键字检索

import { tokenize } from './keyword-index.js';

/**
 * BM25算法计算相关性分数
 * @param {string} query - 查询文本
 * @param {Object} keywordIndex - 关键字索引
 * @param {Object} config - BM25配置
 * @returns {Array<Object>} 检索结果
 */
export function bm25Search(query, keywordIndex, config = {}) {
  if (!query || !keywordIndex) {
    return [];
  }

  const {
    k1 = 1.5,
    b = 0.75,
    topK = 10
  } = config.bm25 || {};

  const {
    invertedIndex,
    termFrequency,
    docLengths,
    avgDocLength,
    totalChunks
  } = keywordIndex;

  // 分词查询
  const queryTerms = tokenize(query, config.tokenization || {});
  
  if (queryTerms.length === 0) {
    return [];
  }

  // 计算每个chunk的BM25分数
  const scores = new Map();

  for (const term of queryTerms) {
    const chunkIds = invertedIndex[term] || [];
    const df = chunkIds.length; // 文档频率
    
    if (df === 0) continue;

    // 计算IDF
    const idf = Math.log((totalChunks - df + 0.5) / (df + 0.5) + 1);

    for (const chunkId of chunkIds) {
      const tf = termFrequency[chunkId]?.[term] || 0; // 词频
      const docLength = docLengths[chunkId] || 0;

      // BM25公式
      const score = idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLength / avgDocLength));

      scores.set(chunkId, (scores.get(chunkId) || 0) + score);
    }
  }

  // 排序并返回topK
  const results = Array.from(scores.entries())
    .map(([chunkId, bm25Score]) => ({
      chunkId,
      bm25Score,
      matchedTerms: getMatchedTerms(chunkId, queryTerms, termFrequency)
    }))
    .sort((a, b) => b.bm25Score - a.bm25Score)
    .slice(0, topK);

  return results;
}

/**
 * 获取匹配的词项及其频率
 * @param {string} chunkId - chunk ID
 * @param {Array<string>} queryTerms - 查询词项
 * @param {Object} termFrequency - 词频统计
 * @returns {Object}
 */
function getMatchedTerms(chunkId, queryTerms, termFrequency) {
  const matched = {};
  const chunkTerms = termFrequency[chunkId] || {};

  for (const term of queryTerms) {
    if (chunkTerms[term]) {
      matched[term] = chunkTerms[term];
    }
  }

  return matched;
}

/**
 * TF-IDF算法（备选）
 * @param {string} query - 查询文本
 * @param {Object} keywordIndex - 关键字索引
 * @param {Object} config - 配置
 * @returns {Array<Object>}
 */
export function tfidfSearch(query, keywordIndex, config = {}) {
  if (!query || !keywordIndex) {
    return [];
  }

  const { topK = 10 } = config;

  const {
    invertedIndex,
    termFrequency,
    docLengths,
    totalChunks
  } = keywordIndex;

  const queryTerms = tokenize(query, config.tokenization || {});
  
  if (queryTerms.length === 0) {
    return [];
  }

  const scores = new Map();

  for (const term of queryTerms) {
    const chunkIds = invertedIndex[term] || [];
    const df = chunkIds.length;
    
    if (df === 0) continue;

    // IDF
    const idf = Math.log(totalChunks / df);

    for (const chunkId of chunkIds) {
      const tf = termFrequency[chunkId]?.[term] || 0;
      const docLength = docLengths[chunkId] || 1;
      
      // TF-IDF = (tf / docLength) * idf
      const score = (tf / docLength) * idf;

      scores.set(chunkId, (scores.get(chunkId) || 0) + score);
    }
  }

  const results = Array.from(scores.entries())
    .map(([chunkId, tfidfScore]) => ({
      chunkId,
      tfidfScore,
      matchedTerms: getMatchedTerms(chunkId, queryTerms, termFrequency)
    }))
    .sort((a, b) => b.tfidfScore - a.tfidfScore)
    .slice(0, topK);

  return results;
}

/**
 * 在集合中进行关键字检索
 * @param {string} query - 查询文本
 * @param {Array<Object>} collections - 集合列表
 * @param {Array<string>} collectionIds - 要检索的集合ID（可选）
 * @param {Object} config - 检索配置
 * @returns {Array<Object>}
 */
export function keywordSearchInCollections(query, collections, collectionIds = null, config = {}) {
  if (!query || !Array.isArray(collections)) {
    return [];
  }

  const { algorithm = 'bm25' } = config;
  const results = [];

  for (const collection of collections) {
    // 如果指定了集合ID，只检索这些集合
    if (collectionIds && !collectionIds.includes(collection.id)) {
      continue;
    }

    // 检查集合是否有关键字索引
    if (!collection.keywordIndex) {
      console.warn(`[Keyword Search] 集合 ${collection.id} 没有关键字索引`);
      continue;
    }

    // ⭐ 构建chunkId到chunk对象的映射
    const chunksMap = {};
    if (collection.vectorStore && Array.isArray(collection.vectorStore.chunks)) {
      for (const chunk of collection.vectorStore.chunks) {
        chunksMap[chunk.id] = chunk;
      }
    }

    // 执行检索
    let collectionResults = [];
    if (algorithm === 'bm25') {
      collectionResults = bm25Search(query, collection.keywordIndex, config);
    } else if (algorithm === 'tfidf') {
      collectionResults = tfidfSearch(query, collection.keywordIndex, config);
    } else {
      console.warn(`[Keyword Search] 不支持的算法: ${algorithm}`);
      continue;
    }

    // ⭐ 添加集合信息和完整的chunk对象
    for (const result of collectionResults) {
      const chunk = chunksMap[result.chunkId];
      if (!chunk) {
        console.warn(`[Keyword Search] 找不到chunk: ${result.chunkId}`);
        continue;
      }

      results.push({
        ...result,
        chunk, // ⭐ 添加完整的chunk对象
        collectionId: collection.id,
        collectionName: collection.name || collection.id
      });
    }
  }

  // 按分数重新排序所有结果
  const scoreKey = algorithm === 'bm25' ? 'bm25Score' : 'tfidfScore';
  results.sort((a, b) => b[scoreKey] - a[scoreKey]);

  return results;
}

/**
 * 高亮显示匹配的关键词
 * @param {string} text - 原始文本
 * @param {Array<string>} queryTerms - 查询词项
 * @returns {string}
 */
export function highlightMatches(text, queryTerms) {
  if (!text || !Array.isArray(queryTerms) || queryTerms.length === 0) {
    return text;
  }

  let highlighted = text;
  
  // 按长度降序排序，优先匹配长词
  const sortedTerms = [...queryTerms].sort((a, b) => b.length - a.length);

  for (const term of sortedTerms) {
    // 转义特殊字符
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedTerm, 'gi');
    highlighted = highlighted.replace(regex, match => `**${match}**`);
  }

  return highlighted;
}

/**
 * 计算查询覆盖率（有多少查询词被匹配）
 * @param {Array<string>} queryTerms - 查询词项
 * @param {Object} matchedTerms - 匹配的词项
 * @returns {number} 覆盖率 (0-1)
 */
export function calculateQueryCoverage(queryTerms, matchedTerms) {
  if (!Array.isArray(queryTerms) || queryTerms.length === 0) {
    return 0;
  }

  const uniqueQueryTerms = new Set(queryTerms);
  const matchedCount = Array.from(uniqueQueryTerms).filter(term => 
    matchedTerms && matchedTerms[term] > 0
  ).length;

  return matchedCount / uniqueQueryTerms.size;
}

/**
 * 生成关键字检索统计
 * @param {Array<Object>} results - 检索结果
 * @param {string} algorithm - 使用的算法
 * @returns {Object}
 */
export function generateKeywordSearchStats(results, algorithm = 'bm25') {
  if (!Array.isArray(results) || results.length === 0) {
    return {
      totalResults: 0,
      avgScore: 0,
      maxScore: 0,
      minScore: 0,
      collections: []
    };
  }

  const scoreKey = algorithm === 'bm25' ? 'bm25Score' : 'tfidfScore';
  const scores = results.map(r => r[scoreKey] || 0);
  const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const collectionSet = new Set(results.map(r => r.collectionId).filter(Boolean));

  return {
    totalResults: results.length,
    avgScore: Math.round(avgScore * 100) / 100,
    maxScore: Math.round(maxScore * 100) / 100,
    minScore: Math.round(minScore * 100) / 100,
    collections: Array.from(collectionSet)
  };
}