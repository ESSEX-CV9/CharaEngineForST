// 混合检索融合模块
// 实现RRF、加权融合、级联策略

/**
 * RRF (Reciprocal Rank Fusion) 融合算法
 * @param {Array<Object>} vectorResults - 向量检索结果
 * @param {Array<Object>} keywordResults - 关键字检索结果
 * @param {Object} chunks - chunks映射 (chunkId -> chunk对象)
 * @param {number} k - RRF常数
 * @returns {Array<Object>}
 */
export function rrfFusion(vectorResults, keywordResults, chunks, k = 60) {
  const scores = new Map();
  const resultInfo = new Map(); // 存储结果的详细信息

  // 处理向量检索结果
  vectorResults.forEach((result, rank) => {
    const chunkId = result.chunkId || result.chunk?.id;
    if (!chunkId) return;

    const score = 1 / (k + rank + 1);
    scores.set(chunkId, (scores.get(chunkId) || 0) + score);

    if (!resultInfo.has(chunkId)) {
      resultInfo.set(chunkId, {
        vectorRank: rank + 1,
        vectorSimilarity: result.similarity,
        keywordRank: null,
        keywordScore: null,
        chunk: result.chunk || chunks[chunkId],
        collectionId: result.collectionId,
        collectionName: result.collectionName
      });
    } else {
      const info = resultInfo.get(chunkId);
      info.vectorRank = rank + 1;
      info.vectorSimilarity = result.similarity;
    }
  });

  // 处理关键字检索结果
  keywordResults.forEach((result, rank) => {
    const chunkId = result.chunkId;
    if (!chunkId) return;

    const score = 1 / (k + rank + 1);
    scores.set(chunkId, (scores.get(chunkId) || 0) + score);

    if (!resultInfo.has(chunkId)) {
      resultInfo.set(chunkId, {
        vectorRank: null,
        vectorSimilarity: null,
        keywordRank: rank + 1,
        keywordScore: result.bm25Score || result.tfidfScore,
        matchedTerms: result.matchedTerms,
        chunk: chunks[chunkId],
        collectionId: result.collectionId,
        collectionName: result.collectionName
      });
    } else {
      const info = resultInfo.get(chunkId);
      info.keywordRank = rank + 1;
      info.keywordScore = result.bm25Score || result.tfidfScore;
      info.matchedTerms = result.matchedTerms;
    }
  });

  // 按融合分数排序
  const fusedResults = Array.from(scores.entries())
    .map(([chunkId, fusionScore]) => {
      const info = resultInfo.get(chunkId);
      return {
        chunkId,
        fusionScore,
        ...info
      };
    })
    .sort((a, b) => b.fusionScore - a.fusionScore);

  return fusedResults;
}

/**
 * 加权融合算法
 * @param {Array<Object>} vectorResults - 向量检索结果
 * @param {Array<Object>} keywordResults - 关键字检索结果
 * @param {Object} chunks - chunks映射
 * @param {Object} weights - 权重配置
 * @returns {Array<Object>}
 */
export function weightedFusion(vectorResults, keywordResults, chunks, weights = {}) {
  const { vectorWeight = 0.6, keywordWeight = 0.4 } = weights;
  const scores = new Map();
  const resultInfo = new Map();

  // 归一化向量分数 (0-1)
  const maxVectorScore = Math.max(...vectorResults.map(r => r.similarity || 0), 0.001);
  
  vectorResults.forEach(result => {
    const chunkId = result.chunkId || result.chunk?.id;
    if (!chunkId) return;

    const normalizedScore = (result.similarity || 0) / maxVectorScore;
    const weightedScore = normalizedScore * vectorWeight;
    
    scores.set(chunkId, (scores.get(chunkId) || 0) + weightedScore);

    if (!resultInfo.has(chunkId)) {
      resultInfo.set(chunkId, {
        vectorSimilarity: result.similarity,
        keywordScore: null,
        matchedTerms: null,
        chunk: result.chunk || chunks[chunkId],
        collectionId: result.collectionId,
        collectionName: result.collectionName
      });
    } else {
      const info = resultInfo.get(chunkId);
      info.vectorSimilarity = result.similarity;
    }
  });

  // 归一化关键字分数 (0-1)
  const maxKeywordScore = Math.max(
    ...keywordResults.map(r => r.bm25Score || r.tfidfScore || 0),
    0.001
  );

  keywordResults.forEach(result => {
    const chunkId = result.chunkId;
    if (!chunkId) return;

    const rawScore = result.bm25Score || result.tfidfScore || 0;
    const normalizedScore = rawScore / maxKeywordScore;
    const weightedScore = normalizedScore * keywordWeight;

    scores.set(chunkId, (scores.get(chunkId) || 0) + weightedScore);

    if (!resultInfo.has(chunkId)) {
      resultInfo.set(chunkId, {
        vectorSimilarity: null,
        keywordScore: rawScore,
        matchedTerms: result.matchedTerms,
        chunk: chunks[chunkId],
        collectionId: result.collectionId,
        collectionName: result.collectionName
      });
    } else {
      const info = resultInfo.get(chunkId);
      info.keywordScore = rawScore;
      info.matchedTerms = result.matchedTerms;
    }
  });

  // 按融合分数排序
  const fusedResults = Array.from(scores.entries())
    .map(([chunkId, fusionScore]) => {
      const info = resultInfo.get(chunkId);
      return {
        chunkId,
        fusionScore,
        ...info
      };
    })
    .sort((a, b) => b.fusionScore - a.fusionScore);

  return fusedResults;
}

/**
 * 级联策略融合
 * @param {Array<Object>} vectorResults - 向量检索结果
 * @param {Array<Object>} keywordResults - 关键字检索结果
 * @param {Object} chunks - chunks映射
 * @param {Object} config - 级联配置
 * @returns {Array<Object>}
 */
export function cascadeFusion(vectorResults, keywordResults, chunks, config = {}) {
  const {
    primaryMethod = 'keyword',
    fallbackMethod = 'vector',
    minPrimaryResults = 3
  } = config;

  // 确定主方法和备用方法的结果
  const primaryResults = primaryMethod === 'keyword' ? keywordResults : vectorResults;
  const fallbackResults = primaryMethod === 'keyword' ? vectorResults : keywordResults;

  const results = [];
  const addedChunkIds = new Set();

  // 添加主方法的结果
  for (const result of primaryResults) {
    const chunkId = result.chunkId || result.chunk?.id;
    if (!chunkId || addedChunkIds.has(chunkId)) continue;

    results.push({
      chunkId,
      chunk: result.chunk || chunks[chunkId],
      vectorSimilarity: result.similarity || null,
      keywordScore: result.bm25Score || result.tfidfScore || null,
      matchedTerms: result.matchedTerms || null,
      collectionId: result.collectionId,
      collectionName: result.collectionName,
      source: primaryMethod
    });

    addedChunkIds.add(chunkId);
  }

  // 如果主方法结果不足，用备用方法补充
  if (results.length < minPrimaryResults) {
    for (const result of fallbackResults) {
      const chunkId = result.chunkId || result.chunk?.id;
      if (!chunkId || addedChunkIds.has(chunkId)) continue;

      results.push({
        chunkId,
        chunk: result.chunk || chunks[chunkId],
        vectorSimilarity: result.similarity || null,
        keywordScore: result.bm25Score || result.tfidfScore || null,
        matchedTerms: result.matchedTerms || null,
        collectionId: result.collectionId,
        collectionName: result.collectionName,
        source: fallbackMethod
      });

      addedChunkIds.add(chunkId);
    }
  }

  return results;
}

/**
 * 执行混合检索融合
 * @param {Array<Object>} vectorResults - 向量检索结果
 * @param {Array<Object>} keywordResults - 关键字检索结果
 * @param {Object} chunks - chunks映射 (chunkId -> chunk对象)
 * @param {Object} fusionConfig - 融合配置
 * @returns {Array<Object>}
 */
export function hybridFusion(vectorResults, keywordResults, chunks, fusionConfig = {}) {
  const { method = 'rrf' } = fusionConfig;

  let fusedResults = [];

  switch (method) {
    case 'rrf':
      fusedResults = rrfFusion(
        vectorResults,
        keywordResults,
        chunks,
        fusionConfig.rrf?.k || 60
      );
      break;

    case 'weighted':
      fusedResults = weightedFusion(
        vectorResults,
        keywordResults,
        chunks,
        fusionConfig.weighted || { vectorWeight: 0.6, keywordWeight: 0.4 }
      );
      break;

    case 'cascade':
      fusedResults = cascadeFusion(
        vectorResults,
        keywordResults,
        chunks,
        fusionConfig.cascade || {
          primaryMethod: 'keyword',
          fallbackMethod: 'vector',
          minPrimaryResults: 3
        }
      );
      break;

    default:
      console.warn(`[Fusion] 不支持的融合方法: ${method}，使用RRF`);
      fusedResults = rrfFusion(vectorResults, keywordResults, chunks, 60);
  }

  return fusedResults;
}

/**
 * 生成融合统计信息
 * @param {Array<Object>} fusedResults - 融合后的结果
 * @param {string} method - 融合方法
 * @returns {Object}
 */
export function generateFusionStats(fusedResults, method = 'rrf') {
  if (!Array.isArray(fusedResults) || fusedResults.length === 0) {
    return {
      totalResults: 0,
      vectorOnlyCount: 0,
      keywordOnlyCount: 0,
      bothMethodsCount: 0,
      avgFusionScore: 0,
      method
    };
  }

  let vectorOnlyCount = 0;
  let keywordOnlyCount = 0;
  let bothMethodsCount = 0;

  for (const result of fusedResults) {
    const hasVector = result.vectorSimilarity !== null && result.vectorSimilarity !== undefined;
    const hasKeyword = result.keywordScore !== null && result.keywordScore !== undefined;

    if (hasVector && hasKeyword) {
      bothMethodsCount++;
    } else if (hasVector) {
      vectorOnlyCount++;
    } else if (hasKeyword) {
      keywordOnlyCount++;
    }
  }

  const avgFusionScore = fusedResults.reduce((sum, r) => sum + (r.fusionScore || 0), 0) / fusedResults.length;

  return {
    totalResults: fusedResults.length,
    vectorOnlyCount,
    keywordOnlyCount,
    bothMethodsCount,
    avgFusionScore: Math.round(avgFusionScore * 10000) / 10000,
    method
  };
}

/**
 * 构建chunks映射（用于融合时快速查找）
 * @param {Array<Object>} collections - 集合列表
 * @returns {Object} chunkId -> chunk对象的映射
 */
export function buildChunksMap(collections) {
  const chunksMap = {};

  if (!Array.isArray(collections)) {
    console.warn('[Fusion] buildChunksMap: collections不是数组');
    return chunksMap;
  }

  for (const collection of collections) {
    if (!collection) {
      continue;
    }

    // ⭐ 确保vectorStore和chunks存在
    if (!collection.vectorStore || !Array.isArray(collection.vectorStore.chunks)) {
      console.warn(`[Fusion] 集合 ${collection.id || 'unknown'} 没有有效的vectorStore.chunks`);
      continue;
    }

    // ⭐ 构建映射，同时记录集合信息
    for (const chunk of collection.vectorStore.chunks) {
      if (!chunk || !chunk.id) {
        console.warn('[Fusion] 发现无效的chunk（缺少id）');
        continue;
      }

      // ⭐ 添加集合信息到chunk（如果还没有）
      chunksMap[chunk.id] = {
        ...chunk,
        collectionId: chunk.collectionId || collection.id,
        collectionName: chunk.collectionName || collection.name || collection.id
      };
    }
  }

  console.log(`[Fusion] 构建了 ${Object.keys(chunksMap).length} 个chunks的映射`);
  return chunksMap;
}