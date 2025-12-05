// 模型管理模块
// 负责Transformers.js模型的下载、缓存和加载

/**
 * 模型缓存管理器
 */
class ModelCacheManager {
  constructor() {
    this.loadedModels = new Map(); // 内存中已加载的模型
  }

  /**
   * 检查模型是否已缓存
   * @param {string} modelId - 模型ID
   * @returns {Promise<boolean>}
   */
  async isModelCached(modelId) {
    try {
      // Transformers.js 使用浏览器的 Cache API
      const cacheName = 'transformers-cache';
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      
      // 规范化 modelId（移除可能的 URL 前缀）
      const normalizedModelId = modelId.replace(/^https?:\/\/huggingface\.co\//, '');
      
      // 检查是否有该模型的缓存文件
      // Transformers.js 缓存的 URL 格式通常包含模型的 org/name
      const hasCache = keys.some(request => {
        const url = request.url;
        // 检查多种可能的URL格式
        return url.includes(normalizedModelId) ||
               url.includes(encodeURIComponent(normalizedModelId)) ||
               url.includes(normalizedModelId.replace('/', '-'));
      });
      
      console.log(`[RAG ModelManager] 缓存检查: ${normalizedModelId} -> ${hasCache ? '已缓存' : '未缓存'}`);
      console.log(`[RAG ModelManager] 缓存键数量: ${keys.length}`);
      
      return hasCache;
    } catch (err) {
      console.error('[RAG ModelManager] 检查缓存失败:', err);
      return false;
    }
  }

  /**
   * 加载模型
   * @param {string} modelId - 模型ID
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<any>}
   */
  async loadModel(modelId, onProgress) {
    // 检查内存缓存
    if (this.loadedModels.has(modelId)) {
      console.log(`[RAG ModelManager] 从内存加载模型: ${modelId}`);
      // ⭐ 修复：即使模型已缓存，也要通知进度回调（100%完成）
      if (onProgress) {
        onProgress({
          percent: 100,
          status: 'done',
          file: 'cached',
          loaded: 1,
          total: 1
        });
      }
      return this.loadedModels.get(modelId);
    }

    try {
      console.log(`[RAG ModelManager] 开始加载模型: ${modelId}`);
      
      // 动态导入 Transformers.js
      const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
      
      // ⭐ 修复：跟踪每个文件的进度，计算整体进度
      const fileProgress = new Map(); // 存储每个文件的进度 {fileName: progress}
      let totalFiles = 0;
      
      // 创建进度回调包装器
      const progressCallback = (progress) => {
        if (onProgress && progress) {
          const file = progress.file || '';
          const status = progress.status || 'loading';
          const currentProgress = progress.progress || 0;
          
          // 如果是新文件，增加总文件数
          if (file && !fileProgress.has(file)) {
            totalFiles++;
            fileProgress.set(file, 0);
          }
          
          // 更新当前文件进度
          if (file) {
            fileProgress.set(file, currentProgress);
          }
          
          // ⭐ 修复：计算整体进度 = 所有文件进度之和 / 总文件数
          let overallPercent = 0;
          if (totalFiles > 0) {
            let totalProgress = 0;
            for (const prog of fileProgress.values()) {
              totalProgress += prog;
            }
            // 整体进度 = 平均进度 * 100
            overallPercent = Math.min(100, Math.round((totalProgress / totalFiles) * 100));
          }
          
          // ⭐ 修复：确保最后一个文件完成时显示100%
          if (status === 'done' || (currentProgress >= 1 && file)) {
            // 检查是否所有文件都完成
            let allComplete = true;
            for (const prog of fileProgress.values()) {
              if (prog < 1) {
                allComplete = false;
                break;
              }
            }
            if (allComplete) {
              overallPercent = 100;
            }
          }
          
          onProgress({
            percent: overallPercent,
            status,
            file,
            loaded: progress.loaded || 0,
            total: progress.total || 0,
            totalFiles,
            completedFiles: Array.from(fileProgress.values()).filter(p => p >= 1).length
          });
        }
      };

      // 加载模型
      const extractor = await pipeline('feature-extraction', modelId, {
        progress_callback: progressCallback
      });

      // 缓存到内存
      this.loadedModels.set(modelId, extractor);
      
      console.log(`[RAG ModelManager] 模型加载成功: ${modelId}`);
      return extractor;
    } catch (err) {
      console.error(`[RAG ModelManager] 模型加载失败: ${modelId}`, err);
      throw new Error(`模型加载失败: ${err.message}`);
    }
  }

  /**
   * 清除模型缓存
   * @param {string} modelId - 模型ID
   * @returns {Promise<void>}
   */
  async clearModelCache(modelId) {
    try {
      // 从内存中移除
      this.loadedModels.delete(modelId);

      // 清除浏览器缓存
      const cacheName = 'transformers-cache';
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      
      for (const request of keys) {
        if (request.url.includes(modelId)) {
          await cache.delete(request);
        }
      }
      
      console.log(`[RAG ModelManager] 已清除模型缓存: ${modelId}`);
    } catch (err) {
      console.error(`[RAG ModelManager] 清除缓存失败: ${modelId}`, err);
      throw err;
    }
  }

  /**
   * 获取所有已缓存的模型
   * @returns {Promise<Array<string>>}
   */
  async getCachedModels() {
    try {
      const cacheName = 'transformers-cache';
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      
      // 提取模型ID（简化版，实际可能需要更复杂的解析）
      const modelIds = new Set();
      keys.forEach(request => {
        const url = request.url;
        // 尝试从URL中提取模型ID
        const match = url.match(/huggingface\.co\/([^\/]+\/[^\/]+)/);
        if (match) {
          modelIds.add(match[1]);
        }
      });
      
      return Array.from(modelIds);
    } catch (err) {
      console.error('[RAG ModelManager] 获取缓存列表失败:', err);
      return [];
    }
  }

  /**
   * 估算缓存大小
   * @returns {Promise<number>} 字节数
   */
  async estimateCacheSize() {
    try {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        return estimate.usage || 0;
      }
      return 0;
    } catch (err) {
      console.error('[RAG ModelManager] 估算缓存大小失败:', err);
      return 0;
    }
  }
}

// 全局单例
const modelCacheManager = new ModelCacheManager();

export { modelCacheManager };

/**
 * 检查模型是否已缓存（便捷函数）
 * @param {string} modelId - 模型ID
 * @returns {Promise<boolean>}
 */
export async function isModelCached(modelId) {
  return modelCacheManager.isModelCached(modelId);
}

/**
 * 验证 HuggingFace 模型
 * @param {string} modelId - 模型ID
 * @returns {Promise<Object>}
 */
export async function validateHuggingFaceModel(modelId) {
  try {
    console.log(`[RAG ModelManager] 验证模型: ${modelId}`);
    
    // 调用 HuggingFace API 获取模型信息
    const response = await fetch(`https://huggingface.co/api/models/${modelId}`);
    
    if (!response.ok) {
      return {
        valid: false,
        error: '模型不存在或无法访问'
      };
    }
    
    const modelInfo = await response.json();
    
    // 检查模型类型
    const pipelineTag = modelInfo.pipeline_tag;
    if (pipelineTag !== 'feature-extraction' && pipelineTag !== 'sentence-similarity') {
      return {
        valid: false,
        error: `不支持的模型类型: ${pipelineTag}。请使用 feature-extraction 或 sentence-similarity 类型的模型。`
      };
    }
    
    // 尝试获取模型配置
    let dimensions = null;
    try {
      const configResponse = await fetch(`https://huggingface.co/${modelId}/resolve/main/config.json`);
      if (configResponse.ok) {
        const config = await configResponse.json();
        dimensions = config.hidden_size || config.dim || config.d_model;
      }
    } catch (err) {
      console.warn('[RAG ModelManager] 无法获取模型维度信息');
    }
    
    return {
      valid: true,
      modelInfo: {
        modelId,
        url: `https://huggingface.co/${modelId}`,
        pipelineTag: pipelineTag,
        dimensions,
        languages: modelInfo.languages || [],
        tags: modelInfo.tags || [],
        downloads: modelInfo.downloads || 0,
        likes: modelInfo.likes || 0
      }
    };
  } catch (err) {
    return {
      valid: false,
      error: `验证失败: ${err.message}`
    };
  }
}

/**
 * 解析 HuggingFace URL
 * @param {string} input - 用户输入
 * @returns {Object|null}
 */
export function parseHuggingFaceUrl(input) {
  if (!input) return null;
  
  let url = input.trim();
  
  // 补全协议
  if (!url.startsWith('http')) {
    if (url.startsWith('huggingface.co/')) {
      url = 'https://' + url;
    } else if (url.includes('/')) {
      // 假设是 org/model 格式
      url = 'https://huggingface.co/' + url;
    } else {
      return null;
    }
  }
  
  // 提取 org 和 model
  const match = url.match(/huggingface\.co\/([^\/]+)\/([^\/\?#]+)/);
  if (!match) return null;
  
  const [, org, model] = match;
  
  return {
    org,
    model,
    modelId: `${org}/${model}`,
    url: `https://huggingface.co/${org}/${model}`
  };
}