// 相似度计算模块
// 负责计算向量之间的余弦相似度

/**
 * 计算两个向量的余弦相似度
 * 注意：假设向量已经归一化，因此直接计算点积即可
 * @param {Float32Array|Array<number>} vecA - 向量A
 * @param {Float32Array|Array<number>} vecB - 向量B
 * @returns {number} 相似度值 (0-1)
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) {
    return 0;
  }

  const len = Math.min(vecA.length, vecB.length);
  if (len === 0) {
    return 0;
  }

  let dotProduct = 0;
  for (let i = 0; i < len; i++) {
    dotProduct += vecA[i] * vecB[i];
  }

  // 如果向量已归一化，点积即为余弦相似度
  // 限制在 [0, 1] 范围内（处理浮点误差）
  return Math.max(0, Math.min(1, dotProduct));
}

/**
 * 批量计算查询向量与所有文档块的相似度
 * @param {Float32Array|Array<number>} queryVector - 查询向量
 * @param {Array<Object>} chunks - 文档块列表
 * @param {number} topK - 返回前K个最相似的结果
 * @param {number} threshold - 相似度阈值 (0-1)
 * @returns {Array<Object>} 排序后的结果列表
 */
export function findTopKSimilar(queryVector, chunks, topK = 5, threshold = 0.7) {
  if (!queryVector || !Array.isArray(chunks) || chunks.length === 0) {
    return [];
  }

  // 计算所有块的相似度
  const scored = chunks.map(chunk => {
    const chunkVector = chunk.vector;
    if (!chunkVector || !Array.isArray(chunkVector)) {
      return { chunk, similarity: 0 };
    }

    const similarity = cosineSimilarity(queryVector, chunkVector);
    return { chunk, similarity };
  });

  // 过滤低于阈值的结果
  const filtered = scored.filter(s => s.similarity >= threshold);

  // 按相似度降序排序
  filtered.sort((a, b) => b.similarity - a.similarity);

  // 返回前K个结果
  return filtered.slice(0, topK);
}

/**
 * 在指定集合中检索
 * @param {Float32Array|Array<number>} queryVector - 查询向量
 * @param {Array<Object>} collections - 集合列表
 * @param {Array<string>} collectionIds - 要检索的集合ID列表（可选）
 * @param {number} topK - 每个集合返回的最大结果数
 * @param {number} threshold - 相似度阈值
 * @returns {Array<Object>} 检索结果
 */
export function searchInCollections(queryVector, collections, collectionIds = null, topK = 5, threshold = 0.7) {
  if (!queryVector || !Array.isArray(collections)) {
    return [];
  }

  const results = [];

  for (const collection of collections) {
    // 如果指定了集合ID列表，只检索这些集合
    if (collectionIds && !collectionIds.includes(collection.id)) {
      continue;
    }

    // 检查集合是否有向量存储
    if (!collection.vectorStore || !Array.isArray(collection.vectorStore.chunks)) {
      continue;
    }

    // 在当前集合中检索
    const collectionResults = findTopKSimilar(
      queryVector,
      collection.vectorStore.chunks,
      topK,
      threshold
    );

    // 添加集合信息
    for (const result of collectionResults) {
      results.push({
        ...result,
        collectionId: collection.id,
        collectionName: collection.name || collection.id
      });
    }
  }

  // 按相似度重新排序所有结果
  results.sort((a, b) => b.similarity - a.similarity);

  return results;
}

/**
 * 计算向量的L2范数（用于归一化）
 * @param {Float32Array|Array<number>} vector - 向量
 * @returns {number}
 */
export function vectorNorm(vector) {
  if (!vector || vector.length === 0) {
    return 0;
  }

  let sum = 0;
  for (let i = 0; i < vector.length; i++) {
    sum += vector[i] * vector[i];
  }
  return Math.sqrt(sum);
}

/**
 * 归一化向量
 * @param {Float32Array|Array<number>} vector - 向量
 * @returns {Float32Array}
 */
export function normalizeVector(vector) {
  if (!vector || vector.length === 0) {
    return new Float32Array(0);
  }

  const norm = vectorNorm(vector);
  if (norm === 0) {
    return new Float32Array(vector.length);
  }

  const normalized = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    normalized[i] = vector[i] / norm;
  }

  return normalized;
}

/**
 * 批量归一化向量
 * @param {Array<Float32Array|Array<number>>} vectors - 向量列表
 * @returns {Array<Float32Array>}
 */
export function normalizeVectors(vectors) {
  if (!Array.isArray(vectors)) {
    return [];
  }

  return vectors.map(v => normalizeVector(v));
}