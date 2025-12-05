// 向量存储模块
// 负责向量数据的CRUD操作和内容变化检测

/**
 * 计算文档内容的SHA-256哈希
 * @param {Array<Object>} documents - 文档列表
 * @returns {Promise<string>}
 */
export async function computeContentHash(documents) {
  if (!Array.isArray(documents) || documents.length === 0) {
    return '';
  }

  // 按ID排序确保顺序稳定
  const sortedDocs = [...documents].sort((a, b) => 
    (a.id || '').localeCompare(b.id || '')
  );

  // 拼接所有文档内容
  const content = sortedDocs
    .map(doc => `${doc.id}:${doc.title}:${doc.content}`)
    .join('|');

  // 使用Web Crypto API计算SHA-256
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `sha256:${hashHex}`;
  } catch (err) {
    console.error('[RAG VectorStore] 计算内容哈希失败:', err);
    // 降级方案：使用简单的字符串哈希
    return `simple:${simpleHash(content)}`;
  }
}

/**
 * 简单的字符串哈希函数（降级方案）
 * @param {string} str
 * @returns {string}
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * 检测是否需要重新向量化
 * @param {Object} collection - 集合对象
 * @returns {Promise<boolean>}
 */
export async function needsRevectorization(collection) {
  if (!collection) {
    return true;
  }

  // 如果从未向量化过
  if (!collection.vectorStore || !collection.vectorStore.meta) {
    return true;
  }

  // 如果没有文档
  if (!Array.isArray(collection.documents) || collection.documents.length === 0) {
    return false;
  }

  // 计算当前文档的哈希
  const currentHash = await computeContentHash(collection.documents);
  const storedHash = collection.vectorStore.meta.contentHash || '';

  // 比较哈希值
  return currentHash !== storedHash;
}

/**
 * 创建空的向量存储结构
 * @param {string} modelId - 模型ID
 * @param {number} dimensions - 向量维度
 * @param {string} method - 向量化方法
 * @returns {Object}
 */
export function createEmptyVectorStore(modelId, dimensions, method = 'local') {
  return {
    version: '1.0',
    vectorizationMethod: method,
    modelId: modelId,
    dimensions: dimensions,
    chunks: [],
    meta: {
      totalChunks: 0,
      totalDocuments: 0,
      totalCharacters: 0,
      vectorizedAt: null,
      contentHash: '',
      estimatedSize: '0 KB'
    }
  };
}

/**
 * 更新向量存储的元信息
 * @param {Object} vectorStore - 向量存储对象
 * @param {Array<Object>} documents - 文档列表
 * @returns {Promise<Object>}
 */
export async function updateVectorStoreMeta(vectorStore, documents) {
  if (!vectorStore || !vectorStore.meta) {
    return vectorStore;
  }

  const totalChunks = Array.isArray(vectorStore.chunks) ? vectorStore.chunks.length : 0;
  const totalDocuments = Array.isArray(documents) ? documents.length : 0;
  const totalCharacters = Array.isArray(documents)
    ? documents.reduce((sum, doc) => sum + (doc.content?.length || 0), 0)
    : 0;

  // 计算内容哈希
  const contentHash = await computeContentHash(documents);

  // 估算大小（粗略计算）
  const vectorSize = totalChunks * vectorStore.dimensions * 4; // Float32 = 4 bytes
  const textSize = totalCharacters * 2; // UTF-16 ≈ 2 bytes per char
  const metaSize = 20 * 1024; // 约20KB元数据
  const totalSize = vectorSize + textSize + metaSize;
  const estimatedSize = formatBytes(totalSize);

  vectorStore.meta = {
    ...vectorStore.meta,
    totalChunks,
    totalDocuments,
    totalCharacters,
    vectorizedAt: new Date().toISOString(),
    contentHash,
    estimatedSize
  };

  return vectorStore;
}

/**
 * 格式化字节数为可读字符串
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * 验证向量存储的完整性
 * @param {Object} vectorStore - 向量存储对象
 * @returns {Object} 验证结果 {valid: boolean, errors: string[]}
 */
export function validateVectorStore(vectorStore) {
  const errors = [];

  if (!vectorStore) {
    errors.push('向量存储对象为空');
    return { valid: false, errors };
  }

  if (!vectorStore.version) {
    errors.push('缺少版本信息');
  }

  if (!vectorStore.modelId) {
    errors.push('缺少模型ID');
  }

  if (typeof vectorStore.dimensions !== 'number' || vectorStore.dimensions <= 0) {
    errors.push('向量维度无效');
  }

  if (!Array.isArray(vectorStore.chunks)) {
    errors.push('chunks字段必须是数组');
  } else {
    // 验证每个chunk的结构
    for (let i = 0; i < Math.min(vectorStore.chunks.length, 10); i++) {
      const chunk = vectorStore.chunks[i];
      if (!chunk.id || !chunk.text || !Array.isArray(chunk.vector)) {
        errors.push(`chunk[${i}]结构不完整`);
        break;
      }
      if (chunk.vector.length !== vectorStore.dimensions) {
        errors.push(`chunk[${i}]向量维度不匹配`);
        break;
      }
    }
  }

  if (!vectorStore.meta || typeof vectorStore.meta !== 'object') {
    errors.push('缺少元信息');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 从向量存储中提取文档快照（用于增量更新）
 * @param {Object} vectorStore - 向量存储对象
 * @returns {Array<Object>}
 */
export function extractDocumentSnapshot(vectorStore) {
  if (!vectorStore || !Array.isArray(vectorStore.chunks)) {
    return [];
  }

  // 按docId分组
  const docMap = new Map();
  
  for (const chunk of vectorStore.chunks) {
    if (!chunk.docId) continue;
    
    if (!docMap.has(chunk.docId)) {
      docMap.set(chunk.docId, {
        id: chunk.docId,
        title: chunk.metadata?.docTitle || chunk.docId,
        chunkCount: 0
      });
    }
    
    docMap.get(chunk.docId).chunkCount++;
  }

  return Array.from(docMap.values());
}