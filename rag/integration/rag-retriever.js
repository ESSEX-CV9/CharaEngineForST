// RAG检索主流程模块
// 协调向量化和检索流程（支持混合检索）

import { parseWorldContextIntent, intentToRetrievalConfig } from '../core/retrieval/query-parser.js';
import { searchInCollections } from '../core/retrieval/similarity.js';
import { keywordSearchInCollections } from '../core/retrieval/keyword-search.js';
import { hybridFusion, buildChunksMap, generateFusionStats } from '../core/retrieval/fusion.js';
import { rankResults, mergeQueryResults } from '../core/retrieval/ranker.js';
import { getLoreCollections } from './lore-storage.js';
import { modelCacheManager } from '../core/vectorization/model-manager.js';

/**
 * 根据 WorldContextIntent 检索世界观内容
 * @param {Object} worldContextIntent - WorldContextIntent 对象
 * @param {Object} loreConfig - loreConfig 对象
 * @returns {Promise<Object>} 检索结果
 */
export async function retrieveWorldContext(worldContextIntent, loreConfig) {
  if (!worldContextIntent || !loreConfig) {
    return createEmptyResult();
  }

  try {
    console.log('[RAG Retriever] 开始检索世界观内容');

    // 获取检索配置
    const retrievalConfig = loreConfig.retrievalConfig || {};
    const mode = retrievalConfig.mode || 'hybrid';

    // 获取所有集合
    const collections = getLoreCollections(loreConfig);
    
    if (collections.length === 0) {
      console.warn('[RAG Retriever] 没有可用的集合');
      return createEmptyResult();
    }

    // 根据模式选择检索策略
    let finalResults = [];
    let stats = {};

    if (mode === 'vector_only') {
      // 纯向量检索
      finalResults = await vectorOnlyRetrieval(worldContextIntent, loreConfig, collections);
      stats = generateStats(finalResults);
    } else if (mode === 'keyword_only') {
      // 纯关键字检索
      finalResults = await keywordOnlyRetrieval(worldContextIntent, loreConfig, collections);
      stats = generateKeywordStats(finalResults);
    } else {
      // 混合检索（默认）
      const hybridResult = await hybridRetrieval(worldContextIntent, loreConfig, collections);
      finalResults = hybridResult.results;
      stats = hybridResult.stats;
    }

    console.log(`[RAG Retriever] 检索完成，共 ${finalResults.length} 个结果`);

    return {
      results: finalResults,
      stats
    };

  } catch (err) {
    console.error('[RAG Retriever] 检索失败:', err);
    return {
      ...createEmptyResult(),
      error: err.message
    };
  }
}

/**
 * 混合检索（向量 + 关键字 + 融合）
 * @param {Object} worldContextIntent - WorldContextIntent对象
 * @param {Object} loreConfig - loreConfig对象
 * @param {Array<Object>} collections - 集合列表
 * @returns {Promise<Object>}
 */
async function hybridRetrieval(worldContextIntent, loreConfig, collections) {
  const retrievalConfig = loreConfig.retrievalConfig || {};
  const queries = worldContextIntent.queries || [];

  // 构建chunks映射（用于融合）
  const chunksMap = buildChunksMap(collections);

  const allQueryResults = [];
  let allVectorResults = [];
  let allKeywordResults = [];

  for (const query of queries) {
    console.log(`[RAG Retriever] 混合检索查询: ${query.query}`);

    // 1. 向量检索
    const queryVector = await vectorizeQuery(query.query, loreConfig.vectorization);
    const vectorResults = searchInCollections(
      queryVector,
      collections,
      query.collections.length > 0 ? query.collections : null,
      retrievalConfig.vectorSearch?.topK || 10,
      retrievalConfig.vectorSearch?.similarityThreshold || 0.6
    );

    // 2. 关键字检索
    const keywordResults = keywordSearchInCollections(
      query.query,
      collections,
      query.collections.length > 0 ? query.collections : null,
      {
        ...retrievalConfig.keywordSearch,
        topK: retrievalConfig.keywordSearch?.topK || 10
      }
    );

    // 保存原始结果用于统计
    allVectorResults = allVectorResults.concat(vectorResults);
    allKeywordResults = allKeywordResults.concat(keywordResults);

    // 3. 融合结果
    const fusedResults = hybridFusion(
      vectorResults,
      keywordResults,
      chunksMap,
      retrievalConfig.fusion || { method: 'rrf', rrf: { k: 60 } }
    );

    // 添加重要性标记
    const markedResults = fusedResults.map(r => ({
      ...r,
      importance: query.importance,
      queryText: query.query
    }));

    allQueryResults.push(markedResults);
  }

  // 合并和排序所有结果
  const rankedResults = mergeQueryResults(allQueryResults, {
    tokenBudget: retrievalConfig.tokenBudget || 2000,
    deduplicate: true,
    deduplicateBy: 'docId'
  });

  // 生成统计信息
  const fusionStats = generateFusionStats(
    rankedResults,
    retrievalConfig.fusion?.method || 'rrf'
  );
  const generalStats = generateStats(rankedResults);

  return {
    results: rankedResults,
    stats: {
      ...generalStats,
      fusion: fusionStats,
      vectorResults: allVectorResults,
      keywordResults: allKeywordResults,
      fusionMethod: retrievalConfig.fusion?.method || 'rrf'
    }
  };
}

/**
 * 纯向量检索
 * @param {Object} worldContextIntent - WorldContextIntent对象
 * @param {Object} loreConfig - loreConfig对象
 * @param {Array<Object>} collections - 集合列表
 * @returns {Promise<Array<Object>>}
 */
async function vectorOnlyRetrieval(worldContextIntent, loreConfig, collections) {
  const retrievalConfig = loreConfig.retrievalConfig || {};
  const queries = worldContextIntent.queries || [];

  const allQueryResults = [];

  for (const query of queries) {
    console.log(`[RAG Retriever] 向量检索查询: ${query.query}`);

    const queryVector = await vectorizeQuery(query.query, loreConfig.vectorization);
    const queryResults = searchInCollections(
      queryVector,
      collections,
      query.collections.length > 0 ? query.collections : null,
      retrievalConfig.vectorSearch?.topK || 10,
      retrievalConfig.vectorSearch?.similarityThreshold || 0.6
    );

    const markedResults = queryResults.map(r => ({
      ...r,
      importance: query.importance,
      queryText: query.query
    }));

    allQueryResults.push(markedResults);
  }

  return mergeQueryResults(allQueryResults, {
    tokenBudget: retrievalConfig.tokenBudget || 2000,
    deduplicate: true,
    deduplicateBy: 'docId'
  });
}

/**
 * 纯关键字检索
 * @param {Object} worldContextIntent - WorldContextIntent对象
 * @param {Object} loreConfig - loreConfig对象
 * @param {Array<Object>} collections - 集合列表
 * @returns {Promise<Array<Object>>}
 */
async function keywordOnlyRetrieval(worldContextIntent, loreConfig, collections) {
  const retrievalConfig = loreConfig.retrievalConfig || {};
  const queries = worldContextIntent.queries || [];

  const allQueryResults = [];

  for (const query of queries) {
    console.log(`[RAG Retriever] 关键字检索查询: ${query.query}`);

    const queryResults = keywordSearchInCollections(
      query.query,
      collections,
      query.collections.length > 0 ? query.collections : null,
      {
        ...retrievalConfig.keywordSearch,
        topK: retrievalConfig.keywordSearch?.topK || 10
      }
    );

    const markedResults = queryResults.map(r => ({
      ...r,
      chunk: r.chunk || {},
      importance: query.importance,
      queryText: query.query
    }));

    allQueryResults.push(markedResults);
  }

  return mergeQueryResults(allQueryResults, {
    tokenBudget: retrievalConfig.tokenBudget || 2000,
    deduplicate: true,
    deduplicateBy: 'docId'
  });
}

/**
 * 创建空结果
 * @returns {Object}
 */
function createEmptyResult() {
  return {
    results: [],
    stats: {
      totalResults: 0,
      totalTokens: 0,
      avgSimilarity: 0,
      collections: []
    }
  };
}

/**
 * 向量化查询文本
 * @param {string} queryText - 查询文本
 * @param {Object} vectorizationConfig - 向量化配置
 * @returns {Promise<Float32Array>}
 */
async function vectorizeQuery(queryText, vectorizationConfig) {
  try {
    const modelId = vectorizationConfig?.localModel?.modelId || 'Xenova/all-MiniLM-L6-v2';
    
    // 加载模型（会使用缓存）
    const extractor = await modelCacheManager.loadModel(modelId);
    
    // 向量化查询
    const output = await extractor(queryText, {
      pooling: 'mean',
      normalize: true
    });
    
    // 提取向量数据
    const vector = output.data;
    
    // 转换为 Float32Array
    if (vector instanceof Float32Array) {
      return vector;
    } else if (Array.isArray(vector)) {
      return new Float32Array(vector);
    } else {
      return new Float32Array(Array.from(vector));
    }
  } catch (err) {
    console.error('[RAG Retriever] 查询向量化失败:', err);
    throw new Error(`查询向量化失败: ${err.message}`);
  }
}

/**
 * 生成检索统计信息
 * @param {Array<Object>} results - 检索结果
 * @returns {Object}
 */
function generateStats(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return {
      totalResults: 0,
      totalTokens: 0,
      avgSimilarity: 0,
      collections: []
    };
  }

  const totalTokens = results.reduce((sum, r) => sum + (r.estimatedTokens || 0), 0);
  
  // 计算平均相似度（如果有）
  const withSimilarity = results.filter(r => r.similarity !== null && r.similarity !== undefined);
  const avgSimilarity = withSimilarity.length > 0
    ? withSimilarity.reduce((sum, r) => sum + r.similarity, 0) / withSimilarity.length
    : 0;
  
  const collectionSet = new Set(results.map(r => r.collectionId).filter(Boolean));

  return {
    totalResults: results.length,
    totalTokens,
    avgSimilarity: Math.round(avgSimilarity * 100) / 100,
    collections: Array.from(collectionSet)
  };
}

/**
 * 生成关键字检索统计信息
 * @param {Array<Object>} results - 检索结果
 * @returns {Object}
 */
function generateKeywordStats(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return {
      totalResults: 0,
      totalTokens: 0,
      avgKeywordScore: 0,
      collections: []
    };
  }

  const totalTokens = results.reduce((sum, r) => sum + (r.estimatedTokens || 0), 0);
  
  // 计算平均关键字分数
  const withScore = results.filter(r => r.keywordScore !== null && r.keywordScore !== undefined);
  const avgKeywordScore = withScore.length > 0
    ? withScore.reduce((sum, r) => sum + r.keywordScore, 0) / withScore.length
    : 0;
  
  const collectionSet = new Set(results.map(r => r.collectionId).filter(Boolean));

  return {
    totalResults: results.length,
    totalTokens,
    avgKeywordScore: Math.round(avgKeywordScore * 100) / 100,
    collections: Array.from(collectionSet)
  };
}

/**
 * 从文本中解析并检索世界观内容
 * @param {string} text - 包含 WorldContextIntent 的文本
 * @param {Object} loreConfig - loreConfig 对象
 * @returns {Promise<Object>} 检索结果
 */
export async function parseAndRetrieve(text, loreConfig) {
  const intent = parseWorldContextIntent(text);
  
  if (!intent || !intent.queries || intent.queries.length === 0) {
    console.log('[RAG Retriever] 未检测到有效的 WorldContextIntent');
    return {
      results: [],
      stats: {
        totalResults: 0,
        totalTokens: 0,
        avgSimilarity: 0,
        collections: []
      }
    };
  }

  return await retrieveWorldContext(intent, loreConfig);
}