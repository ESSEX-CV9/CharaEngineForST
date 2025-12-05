// RAG子系统入口与API导出
// 主插件通过这些接口与RAG交互，保持解耦

/**
 * RAG子系统初始化状态
 */
let isInitialized = false;
let ragConfig = null;

/**
 * 初始化RAG子系统
 * @param {Object} config - RAG配置
 * @returns {Promise<boolean>}
 */
export async function initializeRagSystem(config = {}) {
  if (isInitialized) {
    console.log('[RAG] 系统已初始化');
    return true;
  }

  try {
    console.log('[RAG] 正在初始化RAG子系统...');
    ragConfig = config;
    
    // 这里可以添加初始化逻辑，如检查浏览器兼容性、加载必要的依赖等
    
    isInitialized = true;
    console.log('[RAG] RAG子系统初始化成功');
    return true;
  } catch (err) {
    console.error('[RAG] RAG子系统初始化失败:', err);
    return false;
  }
}

/**
 * 检查RAG系统是否已初始化
 * @returns {boolean}
 */
export function isRagInitialized() {
  return isInitialized;
}

/**
 * 获取RAG配置
 * @returns {Object|null}
 */
export function getRagConfig() {
  return ragConfig;
}

// ===== 向量化相关API =====
export { vectorizeCollection, getVectorizationProgress, cancelVectorization } from './core/vectorization/local-vectorizer.js';
export { chunkDocument } from './core/vectorization/chunker.js';
export { computeContentHash, needsRevectorization } from './core/vectorization/vector-store.js';

// ===== 检索相关API =====
export { cosineSimilarity, findTopKSimilar } from './core/retrieval/similarity.js';
export { rankResults } from './core/retrieval/ranker.js';
export { parseWorldContextIntent } from './core/retrieval/query-parser.js';

// ===== 存储相关API =====
export { loadLoreConfig, saveLoreConfig, getLoreCollections, addCollection, updateCollection, deleteCollection } from './integration/lore-storage.js';

// ===== 检索主流程API =====
export { retrieveWorldContext } from './integration/rag-retriever.js';

// ===== 提示注入API =====
export { injectRagPrompts } from './integration/prompt-injector.js';

// ===== UI相关API =====
export { openLoreManager } from './ui/lore-manager.js';
export { openDocumentEditor } from './ui/document-editor.js';
export { openRetrievalTester } from './ui/retrieval-tester.js';