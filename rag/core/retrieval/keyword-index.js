// 关键字索引构建模块
// 负责构建BM25倒排索引

/**
 * 分词函数（改进版：更好地处理专有名词）
 * @param {string} text - 文本内容
 * @param {Object} config - 分词配置
 * @returns {Array<string>}
 */
export function tokenize(text, config = {}) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const {
    language = 'zh',
    stopWords = [],
    stemming = false
  } = config;

  // 1. 转小写
  text = text.toLowerCase();

  // 2. 分词
  let tokens = [];
  if (language === 'zh') {
    // ⭐ 改进的中文分词策略
    const chars = Array.from(text);
    
    // ⭐ 提取1-4字的n-gram，更好地捕获专有名词
    // 单字
    tokens = [...chars];
    
    // 2字词
    for (let i = 0; i < chars.length - 1; i++) {
      const bigram = chars[i] + chars[i + 1];
      if (!/[\s\p{P}]/u.test(bigram)) {
        tokens.push(bigram);
      }
    }
    
    // 3字词
    for (let i = 0; i < chars.length - 2; i++) {
      const trigram = chars[i] + chars[i + 1] + chars[i + 2];
      if (!/[\s\p{P}]/u.test(trigram)) {
        tokens.push(trigram);
      }
    }
    
    // ⭐ 4字词（对于"临时政府"这样的词很重要）
    for (let i = 0; i < chars.length - 3; i++) {
      const fourgram = chars[i] + chars[i + 1] + chars[i + 2] + chars[i + 3];
      if (!/[\s\p{P}]/u.test(fourgram)) {
        tokens.push(fourgram);
      }
    }
    
    // ⭐ 5字词（处理更长的专有名词）
    for (let i = 0; i < chars.length - 4; i++) {
      const fivegram = chars.slice(i, i + 5).join('');
      if (!/[\s\p{P}]/u.test(fivegram)) {
        tokens.push(fivegram);
      }
    }
  } else {
    // 英文：按空格和标点分词
    tokens = text.split(/[\s\p{P}]+/u).filter(t => t.length > 0);
  }

  // 3. 去除停用词
  if (stopWords.length > 0) {
    tokens = tokens.filter(t => !stopWords.includes(t));
  }

  // 4. 去除纯标点和空白
  tokens = tokens.filter(t => /[\w\u4e00-\u9fa5]/.test(t));

  // 5. 词干提取（英文）
  if (stemming && language === 'en') {
    // 简单的词干提取（可以后续集成专业库）
    tokens = tokens.map(t => simpleStem(t));
  }

  return tokens;
}

/**
 * 简单的英文词干提取
 * @param {string} word - 单词
 * @returns {string}
 */
function simpleStem(word) {
  // 移除常见后缀
  return word
    .replace(/ing$/, '')
    .replace(/ed$/, '')
    .replace(/s$/, '')
    .replace(/es$/, '');
}

/**
 * 构建倒排索引
 * @param {Array<Object>} chunks - 文档块列表
 * @param {Object} tokenizationConfig - 分词配置
 * @returns {Object} 索引对象
 */
export function buildInvertedIndex(chunks, tokenizationConfig = {}) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return {
      invertedIndex: {},
      termFrequency: {},
      docLengths: {},
      avgDocLength: 0,
      totalChunks: 0
    };
  }

  const invertedIndex = {}; // 词 -> [chunkId, ...]
  const termFrequency = {}; // chunkId -> { term: count, ... }
  const docLengths = {}; // chunkId -> length
  let totalLength = 0;

  // 遍历所有chunks
  for (const chunk of chunks) {
    const chunkId = chunk.id;
    const text = chunk.text || '';
    
    // 分词
    const tokens = tokenize(text, tokenizationConfig);
    
    // 记录文档长度
    docLengths[chunkId] = tokens.length;
    totalLength += tokens.length;
    
    // 统计词频
    const termCounts = {};
    for (const token of tokens) {
      termCounts[token] = (termCounts[token] || 0) + 1;
    }
    
    termFrequency[chunkId] = termCounts;
    
    // 构建倒排索引
    for (const term of Object.keys(termCounts)) {
      if (!invertedIndex[term]) {
        invertedIndex[term] = [];
      }
      if (!invertedIndex[term].includes(chunkId)) {
        invertedIndex[term].push(chunkId);
      }
    }
  }

  const avgDocLength = chunks.length > 0 ? totalLength / chunks.length : 0;

  return {
    invertedIndex,
    termFrequency,
    docLengths,
    avgDocLength,
    totalChunks: chunks.length
  };
}

/**
 * 为集合构建关键字索引
 * @param {Object} collection - 集合对象
 * @param {Object} tokenizationConfig - 分词配置
 * @returns {Object} 关键字索引
 */
export function buildKeywordIndexForCollection(collection, tokenizationConfig = {}) {
  if (!collection || !collection.vectorStore || !Array.isArray(collection.vectorStore.chunks)) {
    return null;
  }

  const chunks = collection.vectorStore.chunks;
  const indexData = buildInvertedIndex(chunks, tokenizationConfig);

  return {
    version: '1.0',
    indexedAt: new Date().toISOString(),
    ...indexData
  };
}

/**
 * 增量更新索引（当chunks变化时）
 * @param {Object} existingIndex - 现有索引
 * @param {Array<Object>} newChunks - 新的chunks
 * @param {Array<string>} removedChunkIds - 被移除的chunk IDs
 * @param {Object} tokenizationConfig - 分词配置
 * @returns {Object} 更新后的索引
 */
export function updateKeywordIndex(existingIndex, newChunks, removedChunkIds, tokenizationConfig = {}) {
  if (!existingIndex) {
    return buildInvertedIndex(newChunks, tokenizationConfig);
  }

  const {
    invertedIndex,
    termFrequency,
    docLengths,
    avgDocLength,
    totalChunks
  } = existingIndex;

  // 1. 移除已删除的chunks
  let totalLength = avgDocLength * totalChunks;
  let remainingChunks = totalChunks;

  for (const chunkId of removedChunkIds) {
    if (docLengths[chunkId]) {
      totalLength -= docLengths[chunkId];
      remainingChunks--;
      delete docLengths[chunkId];
    }

    if (termFrequency[chunkId]) {
      const terms = Object.keys(termFrequency[chunkId]);
      for (const term of terms) {
        if (invertedIndex[term]) {
          invertedIndex[term] = invertedIndex[term].filter(id => id !== chunkId);
          if (invertedIndex[term].length === 0) {
            delete invertedIndex[term];
          }
        }
      }
      delete termFrequency[chunkId];
    }
  }

  // 2. 添加新的chunks
  for (const chunk of newChunks) {
    const chunkId = chunk.id;
    const text = chunk.text || '';
    
    const tokens = tokenize(text, tokenizationConfig);
    
    docLengths[chunkId] = tokens.length;
    totalLength += tokens.length;
    remainingChunks++;
    
    const termCounts = {};
    for (const token of tokens) {
      termCounts[token] = (termCounts[token] || 0) + 1;
    }
    
    termFrequency[chunkId] = termCounts;
    
    for (const term of Object.keys(termCounts)) {
      if (!invertedIndex[term]) {
        invertedIndex[term] = [];
      }
      if (!invertedIndex[term].includes(chunkId)) {
        invertedIndex[term].push(chunkId);
      }
    }
  }

  const newAvgDocLength = remainingChunks > 0 ? totalLength / remainingChunks : 0;

  return {
    invertedIndex,
    termFrequency,
    docLengths,
    avgDocLength: newAvgDocLength,
    totalChunks: remainingChunks
  };
}

/**
 * 验证索引完整性
 * @param {Object} keywordIndex - 关键字索引
 * @returns {Object} 验证结果
 */
export function validateKeywordIndex(keywordIndex) {
  const errors = [];

  if (!keywordIndex || typeof keywordIndex !== 'object') {
    errors.push('索引对象无效');
    return { valid: false, errors };
  }

  if (!keywordIndex.invertedIndex || typeof keywordIndex.invertedIndex !== 'object') {
    errors.push('缺少倒排索引');
  }

  if (!keywordIndex.termFrequency || typeof keywordIndex.termFrequency !== 'object') {
    errors.push('缺少词频统计');
  }

  if (!keywordIndex.docLengths || typeof keywordIndex.docLengths !== 'object') {
    errors.push('缺少文档长度信息');
  }

  if (typeof keywordIndex.avgDocLength !== 'number') {
    errors.push('缺少平均文档长度');
  }

  if (typeof keywordIndex.totalChunks !== 'number') {
    errors.push('缺少总chunk数');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}