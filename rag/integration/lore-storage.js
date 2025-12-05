// 设定文件管理模块
// 负责读写角色卡的 loreConfig 字段

/**
 * 从角色卡配置中加载 loreConfig
 * @param {Object} characterConfig - 角色卡配置对象
 * @returns {Object|null}
 */
export function loadLoreConfig(characterConfig) {
  if (!characterConfig || typeof characterConfig !== 'object') {
    return null;
  }

  const loreConfig = characterConfig.loreConfig;
  
  if (!loreConfig || typeof loreConfig !== 'object') {
    return createDefaultLoreConfig();
  }

  // ⭐ 修复：确保包含 defaultChunkConfig 字段
  return {
    vectorization: loreConfig.vectorization || createDefaultVectorizationConfig(),
    collections: Array.isArray(loreConfig.collections) ? loreConfig.collections : [],
    retrievalConfig: loreConfig.retrievalConfig || createDefaultRetrievalConfig(),
    defaultChunkConfig: loreConfig.defaultChunkConfig || {
      strategy: 'fixed',
      fixed: {
        chunkSize: 512,
        overlap: 50
      },
      semantic: {
        minChunkSize: 200,
        maxChunkSize: 800,
        splitBy: 'paragraph'
      },
      sentence: {
        sentencesPerChunk: 3,
        overlap: 1
      },
      custom: {
        delimiter: '---CHUNK---',
        preserveDelimiter: false
      }
    }
  };
}

/**
 * 保存 loreConfig 到角色卡配置
 * @param {Object} characterConfig - 角色卡配置对象
 * @param {Object} loreConfig - loreConfig 对象
 * @returns {Object} 更新后的角色卡配置
 */
export function saveLoreConfig(characterConfig, loreConfig) {
  if (!characterConfig || typeof characterConfig !== 'object') {
    throw new Error('无效的角色卡配置对象');
  }

  if (!loreConfig || typeof loreConfig !== 'object') {
    throw new Error('无效的 loreConfig 对象');
  }

  // ⭐ 修复：保存时包含 defaultChunkConfig
  return {
    ...characterConfig,
    loreConfig: {
      vectorization: loreConfig.vectorization || createDefaultVectorizationConfig(),
      collections: Array.isArray(loreConfig.collections) ? loreConfig.collections : [],
      retrievalConfig: loreConfig.retrievalConfig || createDefaultRetrievalConfig(),
      defaultChunkConfig: loreConfig.defaultChunkConfig || {
        strategy: 'fixed',
        fixed: {
          chunkSize: 512,
          overlap: 50
        },
        semantic: {
          minChunkSize: 200,
          maxChunkSize: 800,
          splitBy: 'paragraph'
        },
        sentence: {
          sentencesPerChunk: 3,
          overlap: 1
        },
        custom: {
          delimiter: '---CHUNK---',
          preserveDelimiter: false
        }
      }
    }
  };
}

/**
 * 获取所有集合
 * @param {Object} loreConfig - loreConfig 对象
 * @returns {Array<Object>}
 */
export function getLoreCollections(loreConfig) {
  if (!loreConfig || !Array.isArray(loreConfig.collections)) {
    return [];
  }

  return loreConfig.collections;
}

/**
 * 根据ID获取集合
 * @param {Object} loreConfig - loreConfig 对象
 * @param {string} collectionId - 集合ID
 * @returns {Object|null}
 */
export function getCollectionById(loreConfig, collectionId) {
  const collections = getLoreCollections(loreConfig);
  return collections.find(c => c.id === collectionId) || null;
}

/**
 * 添加新集合
 * @param {Object} loreConfig - loreConfig 对象
 * @param {Object} collection - 集合对象
 * @returns {Object} 更新后的 loreConfig
 */
export function addCollection(loreConfig, collection) {
  if (!loreConfig || typeof loreConfig !== 'object') {
    throw new Error('无效的 loreConfig 对象');
  }

  if (!collection || !collection.id) {
    throw new Error('集合必须有 id 字段');
  }

  const collections = getLoreCollections(loreConfig);
  
  // 检查ID是否已存在
  if (collections.some(c => c.id === collection.id)) {
    throw new Error(`集合ID已存在: ${collection.id}`);
  }

  return {
    ...loreConfig,
    collections: [...collections, collection]
  };
}

/**
 * 更新集合
 * @param {Object} loreConfig - loreConfig 对象
 * @param {string} collectionId - 集合ID
 * @param {Object} updates - 更新内容
 * @returns {Object} 更新后的 loreConfig
 */
export function updateCollection(loreConfig, collectionId, updates) {
  if (!loreConfig || typeof loreConfig !== 'object') {
    throw new Error('无效的 loreConfig 对象');
  }

  const collections = getLoreCollections(loreConfig);
  const index = collections.findIndex(c => c.id === collectionId);
  
  if (index === -1) {
    throw new Error(`集合不存在: ${collectionId}`);
  }

  const updatedCollections = [...collections];
  updatedCollections[index] = {
    ...updatedCollections[index],
    ...updates,
    id: collectionId // 确保ID不被修改
  };

  return {
    ...loreConfig,
    collections: updatedCollections
  };
}

/**
 * 删除集合
 * @param {Object} loreConfig - loreConfig 对象
 * @param {string} collectionId - 集合ID
 * @returns {Object} 更新后的 loreConfig
 */
export function deleteCollection(loreConfig, collectionId) {
  if (!loreConfig || typeof loreConfig !== 'object') {
    throw new Error('无效的 loreConfig 对象');
  }

  const collections = getLoreCollections(loreConfig);
  const filtered = collections.filter(c => c.id !== collectionId);

  if (filtered.length === collections.length) {
    throw new Error(`集合不存在: ${collectionId}`);
  }

  return {
    ...loreConfig,
    collections: filtered
  };
}

/**
 * 创建默认的 loreConfig
 * @returns {Object}
 */
function createDefaultLoreConfig() {
  return {
    vectorization: createDefaultVectorizationConfig(),
    collections: [],
    retrievalConfig: createDefaultRetrievalConfig(),
    defaultChunkConfig: {
      strategy: 'fixed',
      fixed: {
        chunkSize: 512,
        overlap: 50
      },
      semantic: {
        minChunkSize: 200,
        maxChunkSize: 800,
        splitBy: 'paragraph'
      },
      sentence: {
        sentencesPerChunk: 3,
        overlap: 1
      },
      custom: {
        delimiter: '---CHUNK---',
        preserveDelimiter: false
      }
    }
  };
}

/**
 * 创建默认的向量化配置
 * @returns {Object}
 */
function createDefaultVectorizationConfig() {
  return {
    method: 'local',
    localModel: {
      modelId: 'Xenova/all-MiniLM-L6-v2',
      modelUrl: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2',
      dimensions: 384,
      cached: false,
      cacheKey: 'ce-model-all-MiniLM-L6-v2',
      cacheVersion: '1.0'
    },
    apiConfig: {
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1/embeddings',
      apiKey: '',
      model: 'text-embedding-ada-002',
      dimensions: 1536
    }
  };
}

/**
 * 创建默认的检索配置
 * @returns {Object}
 */
function createDefaultRetrievalConfig() {
  return {
    mode: 'hybrid',
    vectorSearch: {
      topK: 10,
      similarityThreshold: 0.6
    },
    keywordSearch: {
      topK: 10,
      algorithm: 'bm25',
      bm25: {
        k1: 1.5,
        b: 0.75
      },
      tokenization: {
        language: 'zh',
        stopWords: ['的', '了', '在', '是', '和', '有', '这', '个', '我', '你', '他', '她', '它', '们', '与', '及', '或', '等', '为', '以', '到', '从', '对', '把', '被', '将', '让', '使', '给', '向', '往', '由', '于', '按', '照', '跟', '同', '随', '着', '沿', '朝', '当', '趁', '顺', '比', '除', '关于', '根据', '通过', '经过', '凭借', '依靠', '按照', '根据'],
        stemming: false
      }
    },
    fusion: {
      method: 'rrf',
      rrf: {
        k: 60
      },
      weighted: {
        vectorWeight: 0.6,
        keywordWeight: 0.4
      },
      cascade: {
        primaryMethod: 'keyword',
        fallbackMethod: 'vector',
        minPrimaryResults: 3
      }
    },
    finalTopK: 5,
    tokenBudget: 2000,
    rerankEnabled: false
  };
}

/**
 * 创建新的空集合
 * @param {string} id - 集合ID
 * @param {string} name - 集合名称
 * @param {string} description - 集合描述
 * @param {Object} defaultChunkConfig - 全局默认分块配置（可选）
 * @returns {Object}
 */
export function createEmptyCollection(id, name, description = '', defaultChunkConfig = null) {
  return {
    id,
    name,
    description,
    documents: [],
    chunkConfig: defaultChunkConfig || {
      strategy: 'fixed',
      fixed: {
        chunkSize: 512,
        overlap: 50
      },
      semantic: {
        minChunkSize: 200,
        maxChunkSize: 800,
        splitBy: 'paragraph'
      },
      sentence: {
        sentencesPerChunk: 3,
        overlap: 1
      },
      custom: {
        delimiter: '---CHUNK---',
        preserveDelimiter: false
      }
    },
    keywordIndex: null,
    vectorStore: null
  };
}

/**
 * 验证 loreConfig 的完整性
 * @param {Object} loreConfig - loreConfig 对象
 * @returns {Object} 验证结果 {valid: boolean, errors: string[]}
 */
export function validateLoreConfig(loreConfig) {
  const errors = [];

  if (!loreConfig || typeof loreConfig !== 'object') {
    errors.push('loreConfig 对象无效');
    return { valid: false, errors };
  }

  if (!loreConfig.vectorization || typeof loreConfig.vectorization !== 'object') {
    errors.push('缺少 vectorization 配置');
  }

  if (!Array.isArray(loreConfig.collections)) {
    errors.push('collections 必须是数组');
  } else {
    // 验证每个集合
    const ids = new Set();
    for (let i = 0; i < loreConfig.collections.length; i++) {
      const collection = loreConfig.collections[i];
      if (!collection.id) {
        errors.push(`集合[${i}]缺少 id 字段`);
      } else if (ids.has(collection.id)) {
        errors.push(`集合ID重复: ${collection.id}`);
      } else {
        ids.add(collection.id);
      }
      
      if (!Array.isArray(collection.documents)) {
        errors.push(`集合[${i}]的 documents 必须是数组`);
      }
    }
  }

  if (!loreConfig.retrievalConfig || typeof loreConfig.retrievalConfig !== 'object') {
    errors.push('缺少 retrievalConfig 配置');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}