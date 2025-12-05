// 本地向量化模块
// 使用 Transformers.js 在浏览器中进行向量化
// 同时构建关键字索引

import { chunkDocuments } from './chunker.js';
import { createEmptyVectorStore, updateVectorStoreMeta } from './vector-store.js';
import { modelCacheManager } from './model-manager.js';
import { buildKeywordIndexForCollection } from '../retrieval/keyword-index.js';

/**
 * 向量化进度状态
 */
let vectorizationState = {
  isRunning: false,
  currentCollection: null,
  progress: {
    current: 0,
    total: 0,
    percentage: 0,
    currentDoc: '',
    startTime: null,
    estimatedTimeRemaining: null
  },
  cancelRequested: false
};

/**
 * 获取向量化进度
 * @returns {Object}
 */
export function getVectorizationProgress() {
  return { ...vectorizationState.progress };
}

/**
 * 取消向量化
 */
export function cancelVectorization() {
  if (vectorizationState.isRunning) {
    vectorizationState.cancelRequested = true;
    console.log('[RAG LocalVectorizer] 收到取消请求');
  }
}

/**
 * 重置向量化状态
 */
function resetVectorizationState() {
  vectorizationState = {
    isRunning: false,
    currentCollection: null,
    progress: {
      current: 0,
      total: 0,
      percentage: 0,
      currentDoc: '',
      startTime: null,
      estimatedTimeRemaining: null
    },
    cancelRequested: false
  };
}

/**
 * 更新向量化进度
 * @param {number} current - 当前进度
 * @param {number} total - 总数
 * @param {string} currentDoc - 当前文档
 */
function updateProgress(current, total, currentDoc = '') {
  const now = Date.now();
  const startTime = vectorizationState.progress.startTime || now;
  const elapsed = now - startTime;
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  
  let estimatedTimeRemaining = null;
  if (current > 0 && current < total) {
    const avgTimePerChunk = elapsed / current;
    const remaining = total - current;
    estimatedTimeRemaining = Math.round((avgTimePerChunk * remaining) / 1000);
  }

  vectorizationState.progress = {
    current,
    total,
    percentage,
    currentDoc,
    startTime,
    estimatedTimeRemaining
  };
}

/**
 * 实际的向量化函数（使用 Transformers.js）
 * @param {string} text - 文本内容
 * @param {any} extractor - 已加载的模型
 * @returns {Promise<Float32Array>}
 */
async function vectorizeText(text, extractor) {
  try {
    // 使用 Transformers.js 进行向量化
    const output = await extractor(text, {
      pooling: 'mean',  // 使用平均池化
      normalize: true   // 归一化向量
    });
    
    // 提取向量数据
    const vector = output.data;
    
    // 转换为 Float32Array
    if (vector instanceof Float32Array) {
      return vector;
    } else if (Array.isArray(vector)) {
      return new Float32Array(vector);
    } else {
      // 如果是其他格式，尝试转换
      return new Float32Array(Array.from(vector));
    }
  } catch (err) {
    console.error('[RAG LocalVectorizer] 向量化失败:', err);
    throw new Error(`向量化失败: ${err.message}`);
  }
}

/**
 * 批量向量化文本块
 * @param {Array<Object>} chunks - 文本块列表
 * @param {any} extractor - 已加载的模型
 * @param {Function} onProgress - 进度回调
 * @returns {Promise<Array<Object>>}
 */
async function vectorizeChunks(chunks, extractor, onProgress) {
  const vectorizedChunks = [];
  const batchSize = 5; // 减小批次大小以避免内存问题
  
  for (let i = 0; i < chunks.length; i += batchSize) {
    if (vectorizationState.cancelRequested) {
      throw new Error('向量化已取消');
    }
    
    const batch = chunks.slice(i, Math.min(i + batchSize, chunks.length));
    
    // 串行处理以避免内存溢出
    for (const chunk of batch) {
      try {
        const vector = await vectorizeText(chunk.text, extractor);
        vectorizedChunks.push({
          ...chunk,
          vector: Array.from(vector)
        });
        
        if (onProgress) {
          const currentDoc = chunk.metadata?.docTitle || '';
          onProgress(vectorizedChunks.length, chunks.length, currentDoc);
        }
      } catch (err) {
        console.error(`[RAG LocalVectorizer] 向量化块失败: ${chunk.id}`, err);
        // 继续处理其他块
      }
    }
  }
  
  return vectorizedChunks;
}

/**
 * 向量化集合（同时构建关键字索引）
 * @param {Object} collection - 集合对象
 * @param {Object} config - 向量化配置 (可以是扁平的 {modelId, dimensions} 或完整的 vectorization 配置)
 * @param {Object} retrievalConfig - 检索配置（用于关键字索引）
 * @param {Function} onProgress - 进度回调
 * @returns {Promise<Object>} 更新后的集合对象
 */
export async function vectorizeCollection(collection, config = {}, retrievalConfig = null, onProgress = null) {
  if (!collection || !Array.isArray(collection.documents)) {
    throw new Error('无效的集合对象');
  }

  if (vectorizationState.isRunning) {
    throw new Error('已有向量化任务正在运行');
  }

  try {
    vectorizationState.isRunning = true;
    vectorizationState.currentCollection = collection.id;
    vectorizationState.progress.startTime = Date.now();
    vectorizationState.cancelRequested = false;

    console.log(`[RAG LocalVectorizer] 开始向量化集合: ${collection.name || collection.id}`);

    // 支持两种配置格式：
    // 1. 扁平格式: {modelId, dimensions}
    // 2. 完整格式: {method, localModel: {modelId, dimensions}, ...}
    let modelId, dimensions;
    if (config.localModel) {
      // 完整格式
      modelId = config.localModel.modelId || 'Xenova/all-MiniLM-L6-v2';
      dimensions = config.localModel.dimensions || 384;
    } else {
      // 扁平格式
      modelId = config.modelId || 'Xenova/all-MiniLM-L6-v2';
      dimensions = config.dimensions || 384;
    }
    
    // ⭐ 修复：直接使用集合的 chunkConfig，必须完整传入
    const chunkConfig = collection.chunkConfig;
    
    if (!chunkConfig || !chunkConfig.strategy) {
      throw new Error('集合缺少分块配置，请先在管理器中配置分块策略');
    }
    
    const strategyConfig = chunkConfig[chunkConfig.strategy];
    if (!strategyConfig) {
      throw new Error(`分块策略 ${chunkConfig.strategy} 的配置缺失`);
    }
    
    console.log(`[RAG LocalVectorizer] 使用分块策略: ${chunkConfig.strategy}`);
    console.log(`[RAG LocalVectorizer] 分块配置:`, JSON.stringify(strategyConfig, null, 2));

    console.log('[RAG LocalVectorizer] 正在分块文档...');
    const chunks = chunkDocuments(collection.documents, chunkConfig);
    console.log(`[RAG LocalVectorizer] 共生成 ${chunks.length} 个文本块`);

    if (chunks.length === 0) {
      throw new Error('没有生成任何文本块');
    }

    console.log('[RAG LocalVectorizer] 正在加载模型...');
    
    // 加载模型
    const extractor = await modelCacheManager.loadModel(modelId, (progress) => {
      console.log(`[RAG LocalVectorizer] 模型加载进度: ${progress.percent}% - ${progress.file}`);
      if (onProgress) {
        onProgress({
          ...vectorizationState.progress,
          modelLoadProgress: progress.percent,
          modelLoadStatus: progress.status
        });
      }
    });
    
    console.log('[RAG LocalVectorizer] 模型加载完成，开始向量化...');
    
    const progressCallback = (current, total, currentDoc) => {
      updateProgress(current, total, currentDoc);
      if (onProgress) {
        onProgress(vectorizationState.progress);
      }
    };

    const vectorizedChunks = await vectorizeChunks(chunks, extractor, progressCallback);

    let vectorStore = createEmptyVectorStore(modelId, dimensions, 'local');
    vectorStore.chunks = vectorizedChunks;
    vectorStore = await updateVectorStoreMeta(vectorStore, collection.documents);

    console.log('[RAG LocalVectorizer] 向量化完成');

    // 构建关键字索引
    console.log('[RAG LocalVectorizer] 正在构建关键字索引...');
    let keywordIndex = null;
    try {
      const tokenizationConfig = retrievalConfig?.keywordSearch?.tokenization || {
        language: 'zh',
        stopWords: ['的', '了', '在', '是', '和'],
        stemming: false
      };
      
      // 创建临时集合对象用于构建索引
      const tempCollection = {
        ...collection,
        vectorStore
      };
      
      keywordIndex = buildKeywordIndexForCollection(tempCollection, tokenizationConfig);
      console.log('[RAG LocalVectorizer] 关键字索引构建完成');
    } catch (err) {
      console.error('[RAG LocalVectorizer] 关键字索引构建失败:', err);
      // 索引构建失败不影响向量化结果
    }

    resetVectorizationState();

    return {
      ...collection,
      vectorStore,
      keywordIndex
    };

  } catch (err) {
    console.error('[RAG LocalVectorizer] 向量化失败:', err);
    resetVectorizationState();
    throw err;
  }
}