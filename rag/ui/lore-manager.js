// 世界观设定管理器UI
// 提供集合管理、文档编辑、向量化等功能的用户界面

import { loadLoreConfig, saveLoreConfig, getLoreCollections, addCollection, updateCollection, deleteCollection, createEmptyCollection } from '../integration/lore-storage.js';
import { vectorizeCollection, getVectorizationProgress, cancelVectorization } from '../core/vectorization/local-vectorizer.js';
import { needsRevectorization } from '../core/vectorization/vector-store.js';
import { getConfigForCurrentCharacter, saveConfigForCurrentCharacter } from '../../integration/card-storage.js';
import { openDocumentEditor } from './document-editor.js';
import { validateHuggingFaceModel, isModelCached } from '../core/vectorization/model-manager.js';

/**
 * 打开世界观设定管理器
 */
export function openLoreManager() {
  console.log('[RAG LoreManager] 打开世界观设定管理器');
  
  // 创建模态窗口
  const modal = createLoreManagerModal();
  document.body.appendChild(modal);
  
  // 加载数据
  loadLoreManagerData(modal);
  
  // 绑定事件
  bindLoreManagerEvents(modal);
}

/**
 * 创建世界观设定管理器模态窗口
 * @returns {HTMLElement}
 */
function createLoreManagerModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'ce-modal-backdrop';
  backdrop.setAttribute('data-ce-rag-root', '');
  backdrop.style.display = 'flex';
  
  backdrop.innerHTML = `
    <div class="ce-modal">
      <div class="ce-modal-header">
        <div class="ce-modal-title">
          <span>世界观设定管理器</span>
        </div>
        <button class="ce-modal-close" data-action="close" title="关闭">&times;</button>
      </div>
      
      <div class="ce-modal-body">
        <!-- 向量化配置区域 -->
        <div class="ce-section-header">
          <span>向量化配置</span>
        </div>
        <div style="margin-top: 10px; padding: 15px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 8px;">
          <div style="margin-bottom: 12px;">
            <label style="display: block; margin-bottom: 6px; font-weight: 500;">
              HuggingFace 模型链接:
            </label>
            <div style="display: flex; gap: 8px;">
              <input
                type="text"
                id="ce-rag-model-url"
                placeholder="https://huggingface.co/Xenova/all-MiniLM-L6-v2"
                style="flex: 1; padding: 8px; background: var(--black50a, rgba(0,0,0,0.5)); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 4px; color: var(--SmartThemeBodyColor, #ddd);"
              >
              <button class="ce-btn ce-btn-small" data-action="download-model">下载</button>
            </div>
          </div>
          
          <div style="margin-bottom: 12px;">
            <div style="font-size: 0.9em; color: var(--SmartThemeQuoteColor, #999); margin-bottom: 6px;">
              常用模型快捷填入:
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
              <button class="ce-btn ce-btn-small ce-btn-secondary" data-action="use-preset-model" data-model-url="https://huggingface.co/Xenova/all-MiniLM-L6-v2">
                all-MiniLM-L6-v2 (384维, 23MB)
              </button>
              <button class="ce-btn ce-btn-small ce-btn-secondary" data-action="use-preset-model" data-model-url="https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2">
                paraphrase-multilingual (384维, 50MB)
              </button>
              <button class="ce-btn ce-btn-small ce-btn-secondary" data-action="use-preset-model" data-model-url="https://huggingface.co/Xenova/multilingual-e5-small">
                multilingual-e5-small (384维, 118MB)
              </button>
            </div>
          </div>
          
          <div id="ce-rag-model-info" style="padding: 10px; background: var(--black50a, rgba(0,0,0,0.5)); border-radius: 4px; font-size: 0.9em; display: none;">
            <!-- 下载进度将显示在这里 -->
            <div class="ce-loading-indicator" style="display: none;">
              <div class="ce-loading-spinner ce-loading-spinner-small"></div>
              <span>加载中...</span>
            </div>
          </div>
          
          <div id="ce-rag-message" style="margin-top: 10px; padding: 10px; border-radius: 4px; font-size: 0.9em; display: none;">
            <!-- 提示消息将显示在这里 -->
          </div>
          
          <div style="margin-top: 12px;">
            <div style="font-size: 0.9em; font-weight: 500; margin-bottom: 6px;">
              已下载的模型:
            </div>
            <div id="ce-rag-cached-models-list" style="display: flex; flex-direction: column; gap: 6px;">
              <!-- 已缓存模型列表将显示在这里 -->
            </div>
          </div>
        </div>
        
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--SmartThemeBorderColor, #444);">
          <div class="ce-section-header">
            <span>分块策略配置</span>
          </div>
          
          <div style="margin-top: 10px; padding: 15px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 8px;">
            <div style="margin-bottom: 12px;">
              <label style="display: block; margin-bottom: 6px; font-weight: 500;">分块策略:</label>
              <select id="ce-rag-chunk-strategy" style="width: 100%; padding: 8px; background: var(--black50a, rgba(0,0,0,0.5)); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 4px; color: var(--SmartThemeBodyColor, #ddd);">
                <option value="fixed">固定长度分块 (推荐 - 通用)</option>
                <option value="semantic">语义分块 (适合有结构的文档)</option>
                <option value="sentence">句子分块 (精确语义边界)</option>
                <option value="custom">自定义分块 (手动标记)</option>
              </select>
            </div>
            
            <!-- 固定长度分块配置 -->
            <div id="ce-chunk-fixed-config" style="display: block;">
              <div style="font-weight: 500; margin-bottom: 10px;">固定长度配置</div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div class="ce-form-row-horizontal">
                  <label>
                    <span class="ce-form-label">Chunk大小 (字符):</span>
                    <input type="number" id="ce-rag-chunk-size" min="128" max="2048" step="64" value="512">
                  </label>
                </div>
                <div class="ce-form-row-horizontal">
                  <label>
                    <span class="ce-form-label">重叠大小 (字符):</span>
                    <input type="number" id="ce-rag-chunk-overlap" min="0" max="500" step="10" value="50">
                  </label>
                </div>
              </div>
              <div style="margin-top: 8px; font-size: 0.85em; color: var(--SmartThemeQuoteColor, #999);">
                推荐: 512字符 + 50字符重叠，适合大多数场景
              </div>
            </div>
            
            <!-- 语义分块配置 -->
            <div id="ce-chunk-semantic-config" style="display: none;">
              <div style="font-weight: 500; margin-bottom: 10px;">语义分块配置</div>
              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                <div class="ce-form-row-horizontal">
                  <label>
                    <span class="ce-form-label">最小大小:</span>
                    <input type="number" id="ce-rag-semantic-min" min="50" max="1000" step="50" value="200">
                  </label>
                </div>
                <div class="ce-form-row-horizontal">
                  <label>
                    <span class="ce-form-label">最大大小:</span>
                    <input type="number" id="ce-rag-semantic-max" min="200" max="2000" step="100" value="800">
                  </label>
                </div>
                <div class="ce-form-row-horizontal">
                  <label>
                    <span class="ce-form-label">分割方式:</span>
                    <select id="ce-rag-semantic-split" style="width: 100%; padding: 6px; background: var(--black50a, rgba(0,0,0,0.5)); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 4px; color: var(--SmartThemeBodyColor, #ddd);">
                      <option value="paragraph">段落</option>
                      <option value="heading">标题</option>
                      <option value="sentence">句子</option>
                    </select>
                  </label>
                </div>
              </div>
              <div style="font-size: 0.85em; color: var(--SmartThemeQuoteColor, #999);">
                按文档结构自动分块，保持语义完整性
              </div>
            </div>
            
            <!-- 句子分块配置 -->
            <div id="ce-chunk-sentence-config" style="display: none;">
              <div style="font-weight: 500; margin-bottom: 10px;">句子分块配置</div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div class="ce-form-row-horizontal">
                  <label>
                    <span class="ce-form-label">每块句子数:</span>
                    <input type="number" id="ce-rag-sentence-per-chunk" min="1" max="10" value="3">
                  </label>
                </div>
                <div class="ce-form-row-horizontal">
                  <label>
                    <span class="ce-form-label">重叠句子数:</span>
                    <input type="number" id="ce-rag-sentence-overlap" min="0" max="5" value="1">
                  </label>
                </div>
              </div>
              <div style="margin-top: 8px; font-size: 0.85em; color: var(--SmartThemeQuoteColor, #999);">
                按句子边界分块，保证语义完整
              </div>
            </div>
            
            <!-- 自定义分块配置 -->
            <div id="ce-chunk-custom-config" style="display: none;">
              <div style="font-weight: 500; margin-bottom: 10px;">自定义分块配置</div>
              <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 6px;">分隔符:</label>
                <input type="text" id="ce-rag-custom-delimiter" value="---CHUNK---" style="width: 100%; padding: 8px; background: var(--black50a, rgba(0,0,0,0.5)); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 4px; color: var(--SmartThemeBodyColor, #ddd);">
              </div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <input type="checkbox" id="ce-rag-custom-preserve" style="width: auto;">
                <label for="ce-rag-custom-preserve" style="margin: 0; cursor: pointer;">保留分隔符</label>
              </div>
              <div style="font-size: 0.85em; color: var(--SmartThemeQuoteColor, #999);">
                在文档中使用分隔符手动标记分块位置，例如: ---CHUNK---
              </div>
            </div>
          </div>
        </div>
        
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--SmartThemeBorderColor, #444);">
          <div class="ce-section-header">
            <span>集合管理</span>
          <div style="display: flex; gap: 8px;">
            <button class="ce-btn ce-btn-small" data-action="new-collection">
              <span>➕</span> 新建集合
            </button>
            <button class="ce-btn ce-btn-small ce-btn-secondary" data-action="refresh">
              <span>🔄</span> 刷新
            </button>
          </div>
        </div>
        
        <div id="ce-rag-collections-list" style="margin-top: 10px;">
          <div style="text-align: center; padding: 40px; color: var(--SmartThemeQuoteColor, #999);">
            <div class="ce-loading-indicator" style="display: inline-flex; margin-bottom: 8px;">
              <div class="ce-loading-spinner"></div>
              <span>加载中...</span>
            </div>
          </div>
        </div>
        
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--SmartThemeBorderColor, #444);">
          <div class="ce-section-header">
            <span>混合检索配置</span>
          </div>
          
          <!-- 检索模式选择 -->
          <div style="margin-top: 10px;">
            <label style="display: block; margin-bottom: 6px; font-weight: 500;">检索模式:</label>
            <select id="ce-rag-mode" style="width: 100%; padding: 8px; background: var(--black50a, rgba(0,0,0,0.5)); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 4px; color: var(--SmartThemeBodyColor, #ddd);">
              <option value="hybrid">混合检索 (推荐 - 向量+关键字)</option>
              <option value="vector_only">仅向量检索 (纯语义理解)</option>
              <option value="keyword_only">仅关键字检索 (精确匹配)</option>
            </select>
          </div>
          
          <!-- 向量检索配置 -->
          <div id="ce-vector-search-config" style="margin-top: 15px; padding: 12px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 6px;">
            <div style="font-weight: 500; margin-bottom: 10px;">向量检索配置</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div class="ce-form-row-horizontal">
                <label>
                  <span class="ce-form-label">TopK:</span>
                  <input type="number" id="ce-rag-vector-topk" min="1" max="20" value="10">
                </label>
              </div>
              <div class="ce-form-row-horizontal">
                <label>
                  <span class="ce-form-label">相似度阈值:</span>
                  <input type="number" id="ce-rag-vector-threshold" min="0" max="1" step="0.05" value="0.6">
                </label>
              </div>
            </div>
          </div>
          
          <!-- 关键字检索配置 -->
          <div id="ce-keyword-search-config" style="margin-top: 15px; padding: 12px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 6px;">
            <div style="font-weight: 500; margin-bottom: 10px;">关键字检索配置</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
              <div class="ce-form-row-horizontal">
                <label>
                  <span class="ce-form-label">TopK:</span>
                  <input type="number" id="ce-rag-keyword-topk" min="1" max="20" value="10">
                </label>
              </div>
              <div class="ce-form-row-horizontal">
                <label>
                  <span class="ce-form-label">算法:</span>
                  <select id="ce-rag-keyword-algorithm" style="width: 100%; padding: 6px; background: var(--black50a, rgba(0,0,0,0.5)); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 4px; color: var(--SmartThemeBodyColor, #ddd);">
                    <option value="bm25">BM25 (推荐)</option>
                    <option value="tfidf">TF-IDF</option>
                  </select>
                </label>
              </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div class="ce-form-row-horizontal">
                <label>
                  <span class="ce-form-label">BM25 k1:</span>
                  <input type="number" id="ce-rag-bm25-k1" min="0.5" max="3" step="0.1" value="1.5">
                </label>
              </div>
              <div class="ce-form-row-horizontal">
                <label>
                  <span class="ce-form-label">BM25 b:</span>
                  <input type="number" id="ce-rag-bm25-b" min="0" max="1" step="0.05" value="0.75">
                </label>
              </div>
            </div>
          </div>
          
          <!-- 融合策略配置 -->
          <div id="ce-fusion-config" style="margin-top: 15px; padding: 12px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 6px;">
            <div style="font-weight: 500; margin-bottom: 10px;">融合策略</div>
            <div style="margin-bottom: 10px;">
              <label style="display: block; margin-bottom: 6px;">融合方法:</label>
              <select id="ce-rag-fusion-method" style="width: 100%; padding: 8px; background: var(--black50a, rgba(0,0,0,0.5)); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 4px; color: var(--SmartThemeBodyColor, #ddd);">
                <option value="rrf">RRF - 基于排名融合 (推荐)</option>
                <option value="weighted">加权融合 - 可调权重</option>
                <option value="cascade">级联策略 - 优先级</option>
              </select>
            </div>
            
            <!-- RRF配置 -->
            <div id="ce-rrf-config" style="display: block;">
              <div class="ce-form-row-horizontal">
                <label>
                  <span class="ce-form-label">RRF k常数:</span>
                  <input type="number" id="ce-rag-rrf-k" min="10" max="100" step="10" value="60">
                </label>
              </div>
            </div>
            
            <!-- 加权融合配置 -->
            <div id="ce-weighted-config" style="display: none;">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div class="ce-form-row-horizontal">
                  <label>
                    <span class="ce-form-label">向量权重:</span>
                    <input type="number" id="ce-rag-vector-weight" min="0" max="1" step="0.1" value="0.6">
                  </label>
                </div>
                <div class="ce-form-row-horizontal">
                  <label>
                    <span class="ce-form-label">关键字权重:</span>
                    <input type="number" id="ce-rag-keyword-weight" min="0" max="1" step="0.1" value="0.4">
                  </label>
                </div>
              </div>
            </div>
            
            <!-- 级联策略配置 -->
            <div id="ce-cascade-config" style="display: none;">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div class="ce-form-row-horizontal">
                  <label>
                    <span class="ce-form-label">主方法:</span>
                    <select id="ce-rag-cascade-primary" style="width: 100%; padding: 6px; background: var(--black50a, rgba(0,0,0,0.5)); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 4px; color: var(--SmartThemeBodyColor, #ddd);">
                      <option value="keyword">关键字优先</option>
                      <option value="vector">向量优先</option>
                    </select>
                  </label>
                </div>
                <div class="ce-form-row-horizontal">
                  <label>
                    <span class="ce-form-label">最小结果数:</span>
                    <input type="number" id="ce-rag-cascade-min" min="1" max="10" value="3">
                  </label>
                </div>
              </div>
            </div>
          </div>
          
          <!-- 最终输出配置 -->
          <div style="margin-top: 15px; padding: 12px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 6px;">
            <div style="font-weight: 500; margin-bottom: 10px;">最终输出配置</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div class="ce-form-row-horizontal">
                <label>
                  <span class="ce-form-label">最终TopK:</span>
                  <input type="number" id="ce-rag-final-topk" min="1" max="20" value="5">
                </label>
              </div>
              <div class="ce-form-row-horizontal">
                <label>
                  <span class="ce-form-label">Token预算:</span>
                  <input type="number" id="ce-rag-token-budget" min="500" max="4000" step="100" value="2000">
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div class="ce-modal-footer">
        <button class="ce-btn" data-action="save">保存配置</button>
        <button class="ce-btn ce-btn-secondary" data-action="close">关闭</button>
      </div>
    </div>
  `;
  
  return backdrop;
}

/**
 * 添加样式 - 复用插件主样式系统
 */
function addLoreManagerStyles() {
  // RAG使用插件主样式，无需额外添加
  // 所有样式类都使用 ce- 前缀，与主插件保持一致
}

/**
 * 加载世界观设定管理器数据
 * @param {HTMLElement} modal
 */
async function loadLoreManagerData(modal) {
  const charConfig = getConfigForCurrentCharacter();
  const loreConfig = loadLoreConfig(charConfig);
  
  // 加载模型配置（异步）
  await loadModelConfig(modal, loreConfig);
  
  // 加载集合列表
  renderCollectionsList(modal, loreConfig);
  
  // 加载检索配置
  loadRetrievalConfig(modal, loreConfig);
}

/**
 * 加载模型配置
 * @param {HTMLElement} modal
 * @param {Object} loreConfig
 */
async function loadModelConfig(modal, loreConfig) {
  const modelUrlInput = modal.querySelector('#ce-rag-model-url');
  const modelConfig = loreConfig.vectorization?.localModel;
  
  if (modelUrlInput && modelConfig?.modelUrl) {
    modelUrlInput.value = modelConfig.modelUrl;
  }
  
  // 加载已缓存模型列表
  await loadCachedModelsList(modal, loreConfig);
}

/**
 * 加载已缓存模型列表
 * @param {HTMLElement} modal
 * @param {Object} loreConfig
 */
async function loadCachedModelsList(modal, loreConfig) {
  const listContainer = modal.querySelector('#ce-rag-cached-models-list');
  if (!listContainer) return;
  
  // 显示加载动画
  listContainer.innerHTML = `
    <div style="text-align: center; padding: 20px;">
      <div class="ce-loading-indicator" style="display: inline-flex;">
        <div class="ce-loading-spinner ce-loading-spinner-small"></div>
        <span>加载中...</span>
      </div>
    </div>
  `;
  
  try {
    // 获取所有已缓存的模型
    const { modelCacheManager } = await import('../core/vectorization/model-manager.js');
    const cachedModels = await modelCacheManager.getCachedModels();
    
    if (cachedModels.length === 0) {
      listContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--SmartThemeQuoteColor, #999); font-style: italic;">暂无已下载的模型</div>';
      return;
    }
    
    const currentModelId = loreConfig.vectorization?.localModel?.modelId;
    
    listContainer.innerHTML = cachedModels.map(modelId => {
      const isActive = modelId === currentModelId;
      const activeStyle = isActive ? 'border: 2px solid var(--SmartThemeBlurTintColor, #4a9eff);' : '';
      const activeBadge = isActive ? '<span class="ce-collapsible-badge" style="background: var(--SmartThemeBlurTintColor, #4a9eff);">当前使用</span>' : '';
      
      return `
        <div style="padding: 10px; background: var(--black50a, rgba(0,0,0,0.5)); border-radius: 4px; ${activeStyle}">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="flex: 1;">
              <div style="font-weight: 500; margin-bottom: 4px;">${modelId} ${activeBadge}</div>
              <div style="font-size: 0.85em; color: var(--SmartThemeQuoteColor, #999);">
                <span style="color: var(--green, #4caf50);">✓ 已缓存</span>
              </div>
            </div>
            <div style="display: flex; gap: 6px;">
              ${!isActive ? `<button class="ce-btn ce-btn-small" data-action="use-cached-model" data-model-id="${modelId}">使用</button>` : ''}
              <button class="ce-btn ce-btn-small ce-btn-danger" data-action="delete-cached-model" data-model-id="${modelId}">删除</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('[RAG] 加载缓存模型列表失败:', err);
    listContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--red, #f44336);">加载失败</div>';
  }
}

/**
 * 显示消息提示
 * @param {HTMLElement} modal
 * @param {string} message - 消息内容
 * @param {string} type - 消息类型: 'success', 'error', 'info', 'warning'
 * @param {number} duration - 显示时长（毫秒），0表示不自动隐藏
 */
function showMessage(modal, message, type = 'info', duration = 3000) {
  const messageDiv = modal.querySelector('#ce-rag-message');
  if (!messageDiv) return;
  
  const colors = {
    success: 'var(--green, #4caf50)',
    error: 'var(--red, #f44336)',
    info: 'var(--SmartThemeBlurTintColor, #4a9eff)',
    warning: 'var(--orange, #ff9800)'
  };
  
  const icons = {
    success: '✓',
    error: '✗',
    info: 'ℹ',
    warning: '⚠'
  };
  
  messageDiv.style.background = `${colors[type]}22`;
  messageDiv.style.border = `1px solid ${colors[type]}`;
  messageDiv.style.color = colors[type];
  messageDiv.innerHTML = `<strong>${icons[type]}</strong> ${message}`;
  messageDiv.style.display = 'block';
  
  if (duration > 0) {
    setTimeout(() => {
      messageDiv.style.display = 'none';
    }, duration);
  }
}

/**
 * 隐藏消息提示
 * @param {HTMLElement} modal
 */
function hideMessage(modal) {
  const messageDiv = modal.querySelector('#ce-rag-message');
  if (messageDiv) {
    messageDiv.style.display = 'none';
  }
}

/**
 * 渲染集合列表
 * @param {HTMLElement} modal
 * @param {Object} loreConfig
 */
function renderCollectionsList(modal, loreConfig) {
  const listContainer = modal.querySelector('#ce-rag-collections-list');
  const collections = getLoreCollections(loreConfig);
  
  if (collections.length === 0) {
    listContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--SmartThemeQuoteColor, #999); font-style: italic;">暂无集合，点击"新建集合"开始</div>';
    return;
  }
  
  listContainer.innerHTML = collections.map(collection => {
    const docCount = collection.documents?.length || 0;
    const chunkCount = collection.vectorStore?.chunks?.length || 0;
    const isVectorized = chunkCount > 0;
    const statusBadge = isVectorized ?
      '<span class="ce-collapsible-badge" style="background: var(--green, #4caf50);">已向量化</span>' :
      '<span class="ce-collapsible-badge" style="background: var(--orange, #ff9800);">未向量化</span>';
    
    return `
      <div class="ce-collapsible-card" data-collection-id="${collection.id}" style="margin-bottom: 10px;">
        <div class="ce-collapsible-card-header" style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="ce-collapsible-title">${collection.name || collection.id}</span>
            ${statusBadge}
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="ce-btn ce-btn-small" data-action="edit" data-collection-id="${collection.id}">编辑</button>
            <button class="ce-btn ce-btn-small ce-btn-secondary" data-action="vectorize" data-collection-id="${collection.id}">向量化</button>
            <button class="ce-btn ce-btn-small ce-btn-danger" data-action="delete" data-collection-id="${collection.id}">删除</button>
          </div>
        </div>
        <div class="ce-collapsible-card-content" style="padding: 10px 15px; font-size: 0.9em; color: var(--SmartThemeQuoteColor, #999);">
          ${docCount} 个文档 | ${chunkCount} 个片段
          ${collection.description ? `<br><span style="font-style: italic;">${collection.description}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 加载检索配置
 * @param {HTMLElement} modal
 * @param {Object} loreConfig
 */
function loadRetrievalConfig(modal, loreConfig) {
  const config = loreConfig.retrievalConfig || {};
  
  // 加载分块策略配置
  loadChunkConfig(modal, loreConfig);
  
  // 加载检索模式
  const modeSelect = modal.querySelector('#ce-rag-mode');
  if (modeSelect) {
    modeSelect.value = config.mode || 'hybrid';
  }
  
  // 加载向量检索配置
  const vectorTopKInput = modal.querySelector('#ce-rag-vector-topk');
  const vectorThresholdInput = modal.querySelector('#ce-rag-vector-threshold');
  if (vectorTopKInput) vectorTopKInput.value = config.vectorSearch?.topK || 10;
  if (vectorThresholdInput) vectorThresholdInput.value = config.vectorSearch?.similarityThreshold || 0.6;
  
  // 加载关键字检索配置
  const keywordTopKInput = modal.querySelector('#ce-rag-keyword-topk');
  const keywordAlgorithmSelect = modal.querySelector('#ce-rag-keyword-algorithm');
  const bm25K1Input = modal.querySelector('#ce-rag-bm25-k1');
  const bm25BInput = modal.querySelector('#ce-rag-bm25-b');
  if (keywordTopKInput) keywordTopKInput.value = config.keywordSearch?.topK || 10;
  if (keywordAlgorithmSelect) keywordAlgorithmSelect.value = config.keywordSearch?.algorithm || 'bm25';
  if (bm25K1Input) bm25K1Input.value = config.keywordSearch?.bm25?.k1 || 1.5;
  if (bm25BInput) bm25BInput.value = config.keywordSearch?.bm25?.b || 0.75;
  
  // 加载融合策略配置
  const fusionMethodSelect = modal.querySelector('#ce-rag-fusion-method');
  if (fusionMethodSelect) {
    fusionMethodSelect.value = config.fusion?.method || 'rrf';
  }
  
  const rrfKInput = modal.querySelector('#ce-rag-rrf-k');
  const vectorWeightInput = modal.querySelector('#ce-rag-vector-weight');
  const keywordWeightInput = modal.querySelector('#ce-rag-keyword-weight');
  const cascadePrimarySelect = modal.querySelector('#ce-rag-cascade-primary');
  const cascadeMinInput = modal.querySelector('#ce-rag-cascade-min');
  
  if (rrfKInput) rrfKInput.value = config.fusion?.rrf?.k || 60;
  if (vectorWeightInput) vectorWeightInput.value = config.fusion?.weighted?.vectorWeight || 0.6;
  if (keywordWeightInput) keywordWeightInput.value = config.fusion?.weighted?.keywordWeight || 0.4;
  if (cascadePrimarySelect) cascadePrimarySelect.value = config.fusion?.cascade?.primaryMethod || 'keyword';
  if (cascadeMinInput) cascadeMinInput.value = config.fusion?.cascade?.minPrimaryResults || 3;
  
  // 加载最终输出配置
  const finalTopKInput = modal.querySelector('#ce-rag-final-topk');
  const tokenBudgetInput = modal.querySelector('#ce-rag-token-budget');
  if (finalTopKInput) finalTopKInput.value = config.finalTopK || 5;
  if (tokenBudgetInput) tokenBudgetInput.value = config.tokenBudget || 2000;
  
  // 更新UI显示状态
  updateRetrievalConfigVisibility(modal);
  updateChunkConfigVisibility(modal);
}

/**
 * 加载分块配置
 * @param {HTMLElement} modal
 * @param {Object} loreConfig
 */
function loadChunkConfig(modal, loreConfig) {
  // ⭐ 修复：直接使用 loreConfig.defaultChunkConfig 作为全局默认配置
  // 不再从第一个集合读取，避免刷新后显示不一致
  const defaultChunkConfig = loreConfig.defaultChunkConfig || {
    strategy: 'fixed',
    fixed: { chunkSize: 512, overlap: 50 },
    semantic: { minChunkSize: 200, maxChunkSize: 800, splitBy: 'paragraph' },
    sentence: { sentencesPerChunk: 3, overlap: 1 },
    custom: { delimiter: '---CHUNK---', preserveDelimiter: false }
  };
  
  console.log('[RAG LoreManager] 加载全局默认分块配置:', defaultChunkConfig);
  
  // 加载策略选择
  const strategySelect = modal.querySelector('#ce-rag-chunk-strategy');
  if (strategySelect) {
    strategySelect.value = defaultChunkConfig.strategy || 'fixed';
  }
  
  // 加载固定长度配置
  const chunkSizeInput = modal.querySelector('#ce-rag-chunk-size');
  const chunkOverlapInput = modal.querySelector('#ce-rag-chunk-overlap');
  if (chunkSizeInput) chunkSizeInput.value = defaultChunkConfig.fixed?.chunkSize || 512;
  if (chunkOverlapInput) chunkOverlapInput.value = defaultChunkConfig.fixed?.overlap || 50;
  
  // 加载语义分块配置
  const semanticMinInput = modal.querySelector('#ce-rag-semantic-min');
  const semanticMaxInput = modal.querySelector('#ce-rag-semantic-max');
  const semanticSplitSelect = modal.querySelector('#ce-rag-semantic-split');
  if (semanticMinInput) semanticMinInput.value = defaultChunkConfig.semantic?.minChunkSize || 200;
  if (semanticMaxInput) semanticMaxInput.value = defaultChunkConfig.semantic?.maxChunkSize || 800;
  if (semanticSplitSelect) semanticSplitSelect.value = defaultChunkConfig.semantic?.splitBy || 'paragraph';
  
  // 加载句子分块配置
  const sentencePerChunkInput = modal.querySelector('#ce-rag-sentence-per-chunk');
  const sentenceOverlapInput = modal.querySelector('#ce-rag-sentence-overlap');
  if (sentencePerChunkInput) sentencePerChunkInput.value = defaultChunkConfig.sentence?.sentencesPerChunk || 3;
  if (sentenceOverlapInput) sentenceOverlapInput.value = defaultChunkConfig.sentence?.overlap || 1;
  
  // 加载自定义分块配置
  const customDelimiterInput = modal.querySelector('#ce-rag-custom-delimiter');
  const customPreserveCheckbox = modal.querySelector('#ce-rag-custom-preserve');
  if (customDelimiterInput) customDelimiterInput.value = defaultChunkConfig.custom?.delimiter || '---CHUNK---';
  if (customPreserveCheckbox) customPreserveCheckbox.checked = defaultChunkConfig.custom?.preserveDelimiter || false;
}

/**
 * 绑定事件
 * @param {HTMLElement} modal
 */
function bindLoreManagerEvents(modal) {
  // 关闭按钮 - 使用事件委托确保所有关闭按钮都能工作
  modal.querySelectorAll('[data-action="close"]').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.remove();
    });
  });
  
  // 点击背景关闭（可选）
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
  
  // 新建集合
  modal.querySelector('[data-action="new-collection"]')?.addEventListener('click', () => {
    handleNewCollection(modal);
  });
  
  // 保存配置
  modal.querySelector('[data-action="save"]')?.addEventListener('click', () => {
    handleSaveConfig(modal);
  });
  
  // 刷新
  modal.querySelector('[data-action="refresh"]')?.addEventListener('click', () => {
    loadLoreManagerData(modal);
  });
  
  // 下载模型
  modal.querySelector('[data-action="download-model"]')?.addEventListener('click', () => {
    handleDownloadModel(modal);
  });
  
  // 使用预设模型
  modal.querySelectorAll('[data-action="use-preset-model"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modelUrl = btn.dataset.modelUrl;
      const modelUrlInput = modal.querySelector('#ce-rag-model-url');
      if (modelUrlInput) {
        modelUrlInput.value = modelUrl;
      }
    });
  });
  
  // 已缓存模型操作（使用事件委托）
  modal.querySelector('#ce-rag-cached-models-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    
    const action = btn.dataset.action;
    const modelId = btn.dataset.modelId;
    
    if (action === 'use-cached-model') {
      handleUseCachedModel(modal, modelId);
    } else if (action === 'delete-cached-model') {
      handleDeleteCachedModel(modal, modelId);
    }
  });
  
  // 集合操作（使用事件委托）
  modal.querySelector('#ce-rag-collections-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    
    const action = btn.dataset.action;
    const collectionId = btn.dataset.collectionId;
    
    if (action === 'edit') {
      handleEditCollection(modal, collectionId);
    } else if (action === 'vectorize') {
      handleVectorizeCollection(modal, collectionId);
    } else if (action === 'delete') {
      handleDeleteCollection(modal, collectionId);
    }
  });
  
  // 检索模式切换事件
  modal.querySelector('#ce-rag-mode')?.addEventListener('change', () => {
    updateRetrievalConfigVisibility(modal);
  });
  
  // 融合方法切换事件
  modal.querySelector('#ce-rag-fusion-method')?.addEventListener('change', () => {
    updateFusionConfigVisibility(modal);
  });
  
  // 分块策略切换事件
  modal.querySelector('#ce-rag-chunk-strategy')?.addEventListener('change', () => {
    updateChunkConfigVisibility(modal);
  });
}

/**
 * 更新分块配置区域的可见性
 * @param {HTMLElement} modal
 */
function updateChunkConfigVisibility(modal) {
  const strategy = modal.querySelector('#ce-rag-chunk-strategy')?.value || 'fixed';
  
  const fixedConfig = modal.querySelector('#ce-chunk-fixed-config');
  const semanticConfig = modal.querySelector('#ce-chunk-semantic-config');
  const sentenceConfig = modal.querySelector('#ce-chunk-sentence-config');
  const customConfig = modal.querySelector('#ce-chunk-custom-config');
  
  // 隐藏所有配置
  if (fixedConfig) fixedConfig.style.display = 'none';
  if (semanticConfig) semanticConfig.style.display = 'none';
  if (sentenceConfig) sentenceConfig.style.display = 'none';
  if (customConfig) customConfig.style.display = 'none';
  
  // 根据选择的策略显示对应配置
  if (strategy === 'fixed' && fixedConfig) {
    fixedConfig.style.display = 'block';
  } else if (strategy === 'semantic' && semanticConfig) {
    semanticConfig.style.display = 'block';
  } else if (strategy === 'sentence' && sentenceConfig) {
    sentenceConfig.style.display = 'block';
  } else if (strategy === 'custom' && customConfig) {
    customConfig.style.display = 'block';
  }
}

/**
 * 更新检索配置区域的可见性
 * @param {HTMLElement} modal
 */
function updateRetrievalConfigVisibility(modal) {
  const mode = modal.querySelector('#ce-rag-mode')?.value || 'hybrid';
  
  const vectorConfig = modal.querySelector('#ce-vector-search-config');
  const keywordConfig = modal.querySelector('#ce-keyword-search-config');
  const fusionConfig = modal.querySelector('#ce-fusion-config');
  
  if (mode === 'hybrid') {
    // 混合模式：显示所有配置
    if (vectorConfig) vectorConfig.style.display = 'block';
    if (keywordConfig) keywordConfig.style.display = 'block';
    if (fusionConfig) fusionConfig.style.display = 'block';
  } else if (mode === 'vector_only') {
    // 仅向量模式：只显示向量配置
    if (vectorConfig) vectorConfig.style.display = 'block';
    if (keywordConfig) keywordConfig.style.display = 'none';
    if (fusionConfig) fusionConfig.style.display = 'none';
  } else if (mode === 'keyword_only') {
    // 仅关键字模式：只显示关键字配置
    if (vectorConfig) vectorConfig.style.display = 'none';
    if (keywordConfig) keywordConfig.style.display = 'block';
    if (fusionConfig) fusionConfig.style.display = 'none';
  }
  
  // 更新融合策略配置的可见性
  updateFusionConfigVisibility(modal);
}

/**
 * 更新融合策略配置的可见性
 * @param {HTMLElement} modal
 */
function updateFusionConfigVisibility(modal) {
  const fusionMethod = modal.querySelector('#ce-rag-fusion-method')?.value || 'rrf';
  
  const rrfConfig = modal.querySelector('#ce-rrf-config');
  const weightedConfig = modal.querySelector('#ce-weighted-config');
  const cascadeConfig = modal.querySelector('#ce-cascade-config');
  
  // 隐藏所有融合配置
  if (rrfConfig) rrfConfig.style.display = 'none';
  if (weightedConfig) weightedConfig.style.display = 'none';
  if (cascadeConfig) cascadeConfig.style.display = 'none';
  
  // 根据选择的方法显示对应配置
  if (fusionMethod === 'rrf' && rrfConfig) {
    rrfConfig.style.display = 'block';
  } else if (fusionMethod === 'weighted' && weightedConfig) {
    weightedConfig.style.display = 'block';
  } else if (fusionMethod === 'cascade' && cascadeConfig) {
    cascadeConfig.style.display = 'block';
  }
}

/**
 * 处理新建集合
 * @param {HTMLElement} modal
 */
async function handleNewCollection(modal) {
  const name = prompt('请输入集合名称:');
  if (!name) return;
  
  hideMessage(modal);
  const id = `collection_${Date.now()}`;
  
  // ⭐ 修复：使用全局默认分块配置创建新集合
  const charConfig = getConfigForCurrentCharacter();
  let loreConfig = loadLoreConfig(charConfig);
  const collection = createEmptyCollection(id, name, '', loreConfig.defaultChunkConfig);
  
  try {
    loreConfig = addCollection(loreConfig, collection);
    const updatedConfig = saveLoreConfig(charConfig, loreConfig);
    
    // 等待保存完成
    const saved = await saveConfigForCurrentCharacter(updatedConfig);
    
    if (!saved) {
      throw new Error('保存角色卡失败');
    }
    
    // 刷新界面
    await loadLoreManagerData(modal);
    showMessage(modal, `集合 "${name}" 创建成功！`, 'success');
  } catch (err) {
    console.error('[RAG] 创建集合失败:', err);
    showMessage(modal, `创建失败: ${err.message}`, 'error');
  }
}

/**
 * 处理编辑集合
 * @param {HTMLElement} modal
 * @param {string} collectionId
 */
function handleEditCollection(modal, collectionId) {
  openDocumentEditor(collectionId, () => {
    loadLoreManagerData(modal);
  });
}

/**
 * 处理向量化集合
 * @param {HTMLElement} modal
 * @param {string} collectionId
 */
async function handleVectorizeCollection(modal, collectionId) {
  const charConfig = getConfigForCurrentCharacter();
  const loreConfig = loadLoreConfig(charConfig);
  const collection = loreConfig.collections.find(c => c.id === collectionId);
  
  if (!collection) {
    showMessage(modal, '集合不存在', 'error');
    return;
  }
  
  if (!collection.documents || collection.documents.length === 0) {
    showMessage(modal, '集合中没有文档，请先添加文档', 'warning');
    return;
  }
  
  if (!confirm(`确定要向量化集合"${collection.name}"吗？\n这可能需要几分钟时间。`)) {
    return;
  }
  
  hideMessage(modal);
  
  // ⭐ 修复问题1：立即创建并显示进度模态窗口，不等待任何异步操作
  const progressModal = createVectorizationProgressModal(collection.name);
  document.body.appendChild(progressModal);
  
  // 使用 setTimeout 确保 DOM 更新后再开始向量化
  setTimeout(async () => {
    try {
      // 从UI读取当前分块配置
      const currentChunkConfig = collectChunkConfigFromUI(modal);
      console.log('[RAG LoreManager] 向量化使用当前UI配置:', currentChunkConfig);
      
      // 将当前UI配置应用到集合（仅用于本次向量化，不持久化）
      const collectionWithCurrentConfig = {
        ...collection,
        chunkConfig: currentChunkConfig
      };
      
      // 进度回调函数
      const onProgress = (progress) => {
        updateVectorizationProgress(progressModal, progress);
      };
      
      // 使用带有当前UI配置的集合进行向量化
      const updatedCollection = await vectorizeCollection(
        collectionWithCurrentConfig,
        loreConfig.vectorization,
        loreConfig.retrievalConfig,
        onProgress
      );
    
      let updatedLoreConfig = updateCollection(loreConfig, collectionId, updatedCollection);
      const updatedConfig = saveLoreConfig(charConfig, updatedLoreConfig);
      await saveConfigForCurrentCharacter(updatedConfig);
      
      progressModal.remove();
      loadLoreManagerData(modal);
      showMessage(modal, `集合 "${collection.name}" 向量化完成！`, 'success');
    } catch (err) {
      progressModal.remove();
      showMessage(modal, `向量化失败: ${err.message}`, 'error', 5000);
    }
  }, 100); // 延迟100ms确保UI更新
}

/**
 * 处理删除集合
 * @param {HTMLElement} modal
 * @param {string} collectionId
 */
function handleDeleteCollection(modal, collectionId) {
  if (!confirm('确定要删除此集合吗？此操作不可恢复。')) {
    return;
  }
  
  hideMessage(modal);
  
  try {
    const charConfig = getConfigForCurrentCharacter();
    let loreConfig = loadLoreConfig(charConfig);
    loreConfig = deleteCollection(loreConfig, collectionId);
    const updatedConfig = saveLoreConfig(charConfig, loreConfig);
    saveConfigForCurrentCharacter(updatedConfig);
    
    loadLoreManagerData(modal);
    showMessage(modal, '集合已删除', 'success');
  } catch (err) {
    showMessage(modal, `删除失败: ${err.message}`, 'error');
  }
}

/**
 * 处理保存配置
 * @param {HTMLElement} modal
 */
async function handleSaveConfig(modal) {
  hideMessage(modal);
  
  try {
    const charConfig = getConfigForCurrentCharacter();
    let loreConfig = loadLoreConfig(charConfig);
    
    // 读取分块策略配置
    const chunkConfig = collectChunkConfigFromUI(modal);
    
    console.log('[RAG LoreManager] 保存全局默认分块配置:', chunkConfig);
    
    // ⭐ 修复：保存为全局默认配置，不再批量修改所有集合
    // 新建集合时会自动使用这个全局默认配置
    loreConfig.defaultChunkConfig = {
      strategy: chunkConfig.strategy,
      fixed: { ...chunkConfig.fixed },
      semantic: { ...chunkConfig.semantic },
      sentence: { ...chunkConfig.sentence },
      custom: { ...chunkConfig.custom }
    };
    
    // 读取检索模式
    const mode = modal.querySelector('#ce-rag-mode')?.value || 'hybrid';
    
    // 读取向量检索配置
    const vectorTopK = parseInt(modal.querySelector('#ce-rag-vector-topk')?.value || '10');
    const vectorThreshold = parseFloat(modal.querySelector('#ce-rag-vector-threshold')?.value || '0.6');
    
    // 读取关键字检索配置
    const keywordTopK = parseInt(modal.querySelector('#ce-rag-keyword-topk')?.value || '10');
    const keywordAlgorithm = modal.querySelector('#ce-rag-keyword-algorithm')?.value || 'bm25';
    const bm25K1 = parseFloat(modal.querySelector('#ce-rag-bm25-k1')?.value || '1.5');
    const bm25B = parseFloat(modal.querySelector('#ce-rag-bm25-b')?.value || '0.75');
    
    // 读取融合策略配置
    const fusionMethod = modal.querySelector('#ce-rag-fusion-method')?.value || 'rrf';
    const rrfK = parseInt(modal.querySelector('#ce-rag-rrf-k')?.value || '60');
    const vectorWeight = parseFloat(modal.querySelector('#ce-rag-vector-weight')?.value || '0.6');
    const keywordWeight = parseFloat(modal.querySelector('#ce-rag-keyword-weight')?.value || '0.4');
    const cascadePrimary = modal.querySelector('#ce-rag-cascade-primary')?.value || 'keyword';
    const cascadeMin = parseInt(modal.querySelector('#ce-rag-cascade-min')?.value || '3');
    
    // 读取最终输出配置
    const finalTopK = parseInt(modal.querySelector('#ce-rag-final-topk')?.value || '5');
    const tokenBudget = parseInt(modal.querySelector('#ce-rag-token-budget')?.value || '2000');
    
    // 更新检索配置
    loreConfig.retrievalConfig = {
      mode,
      vectorSearch: {
        topK: vectorTopK,
        similarityThreshold: vectorThreshold
      },
      keywordSearch: {
        topK: keywordTopK,
        algorithm: keywordAlgorithm,
        bm25: {
          k1: bm25K1,
          b: bm25B
        },
        tokenization: loreConfig.retrievalConfig?.keywordSearch?.tokenization || {
          language: 'zh',
          stopWords: ['的', '了', '在', '是', '和', '有', '这', '个', '我', '你', '他', '她', '它'],
          stemming: false
        }
      },
      fusion: {
        method: fusionMethod,
        rrf: {
          k: rrfK
        },
        weighted: {
          vectorWeight,
          keywordWeight
        },
        cascade: {
          primaryMethod: cascadePrimary,
          fallbackMethod: cascadePrimary === 'keyword' ? 'vector' : 'keyword',
          minPrimaryResults: cascadeMin
        }
      },
      finalTopK,
      tokenBudget,
      rerankEnabled: false
    };
    
    const updatedConfig = saveLoreConfig(charConfig, loreConfig);
    await saveConfigForCurrentCharacter(updatedConfig);
    
    showMessage(modal, '配置已保存！新建集合将使用此分块配置。', 'success');
  } catch (err) {
    showMessage(modal, `保存失败: ${err.message}`, 'error');
  }
}

/**
 * 从UI收集分块配置
 * @param {HTMLElement} modal
 * @returns {Object} 分块配置对象
 */
function collectChunkConfigFromUI(modal) {
  const strategy = modal.querySelector('#ce-rag-chunk-strategy')?.value || 'fixed';
  
  // ⭐ 添加日志：显示从UI读取的原始值
  const chunkSizeValue = modal.querySelector('#ce-rag-chunk-size')?.value;
  const overlapValue = modal.querySelector('#ce-rag-chunk-overlap')?.value;
  console.log('[RAG LoreManager] 从UI读取分块大小:', chunkSizeValue, '重叠:', overlapValue);
  
  const chunkConfig = {
    strategy: strategy,
    fixed: {
      chunkSize: parseInt(chunkSizeValue || '512'),
      overlap: parseInt(overlapValue || '50')
    },
    semantic: {
      minChunkSize: parseInt(modal.querySelector('#ce-rag-semantic-min')?.value || '200'),
      maxChunkSize: parseInt(modal.querySelector('#ce-rag-semantic-max')?.value || '800'),
      splitBy: modal.querySelector('#ce-rag-semantic-split')?.value || 'paragraph'
    },
    sentence: {
      sentencesPerChunk: parseInt(modal.querySelector('#ce-rag-sentence-per-chunk')?.value || '3'),
      overlap: parseInt(modal.querySelector('#ce-rag-sentence-overlap')?.value || '1')
    },
    custom: {
      delimiter: modal.querySelector('#ce-rag-custom-delimiter')?.value || '---CHUNK---',
      preserveDelimiter: modal.querySelector('#ce-rag-custom-preserve')?.checked || false
    }
  };
  
  console.log('[RAG LoreManager] 收集到的完整分块配置:', chunkConfig);
  return chunkConfig;
}

/**
 * 处理下载模型
 * @param {HTMLElement} modal
 */
async function handleDownloadModel(modal) {
  const modelUrlInput = modal.querySelector('#ce-rag-model-url');
  const modelUrl = modelUrlInput?.value?.trim();
  
  if (!modelUrl) {
    showMessage(modal, '请输入HuggingFace模型链接', 'warning');
    return;
  }
  
  const infoDiv = modal.querySelector('#ce-rag-model-info');
  hideMessage(modal);
  
  // 创建加载提示弹窗
  let loadingModal = null;
  
  try {
    // 显示验证状态（带加载动画）
    loadingModal = createModelLoadingModal('正在验证模型...', '', true, false);
    document.body.appendChild(loadingModal);
    
    // 解析URL提取modelId
    const { parseHuggingFaceUrl, validateHuggingFaceModel, modelCacheManager } = await import('../core/vectorization/model-manager.js');
    const parsed = parseHuggingFaceUrl(modelUrl);
    
    if (!parsed) {
      loadingModal.remove();
      showMessage(modal, '无效的HuggingFace链接格式。支持格式: https://huggingface.co/Xenova/all-MiniLM-L6-v2 或 Xenova/all-MiniLM-L6-v2', 'error');
      return;
    }
    
    const modelId = parsed.modelId;
    console.log(`[RAG] 解析URL: ${modelUrl} -> modelId: ${modelId}`);
    
    // 更新弹窗显示模型ID
    let modalTitle = loadingModal.querySelector('.ce-modal-title span:last-child');
    if (modalTitle) modalTitle.textContent = '正在验证模型...';
    
    // 验证模型
    const result = await validateHuggingFaceModel(modelId);
    
    if (!result.valid) {
      loadingModal.remove();
      showMessage(modal, `模型验证失败: ${result.error}`, 'error');
      return;
    }
    
    const modelInfo = result.modelInfo;
    
    // 移除旧弹窗，创建带进度条的新弹窗
    loadingModal.remove();
    loadingModal = createModelLoadingModal('正在下载模型...', `${modelInfo.modelId} (约 ${getModelSizeEstimate(modelInfo.modelId)})`, true, true);
    document.body.appendChild(loadingModal);
    
    // 显示下载进度（带加载动画）
    if (infoDiv) {
      infoDiv.style.display = 'block';
      infoDiv.innerHTML = `
        <div style="text-align: center;">
          <div style="margin-bottom: 8px;">正在下载模型: ${modelInfo.modelId} (约 ${getModelSizeEstimate(modelInfo.modelId)})</div>
          <div id="ce-rag-download-progress" style="font-size: 0.9em; color: var(--SmartThemeQuoteColor, #999);">
            <div class="ce-loading-indicator" style="display: inline-flex; margin-bottom: 8px;">
              <div class="ce-loading-spinner ce-loading-spinner-small"></div>
              <span>准备下载...</span>
            </div>
          </div>
        </div>
      `;
    }
    
    // 下载模型（更新弹窗进度）
    await modelCacheManager.loadModel(modelInfo.modelId, (progress) => {
      // 更新主界面的进度显示
      const progressDiv = modal.querySelector('#ce-rag-download-progress');
      if (progressDiv) {
        const percent = progress.percent || 0;
        const status = progress.status || 'loading';
        const file = progress.file || '';
        const totalFiles = progress.totalFiles || 0;
        const completedFiles = progress.completedFiles || 0;
        
        const statusText = status === 'done' ? '完成' : status === 'loading' ? '下载中' : '准备中';
        progressDiv.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <div class="ce-loading-spinner ce-loading-spinner-small"></div>
            <span>${statusText}</span>
          </div>
          <div style="margin-bottom: 4px;">
            <strong>整体进度: ${percent}%</strong>
            ${totalFiles > 0 ? ` (${completedFiles}/${totalFiles} 文件)` : ''}
          </div>
          <div style="width: 100%; height: 8px; background: var(--black50a, rgba(0,0,0,0.5)); border-radius: 4px; overflow: hidden; margin-bottom: 8px;">
            <div class="ce-progress-bar-animated" style="width: ${percent}%; height: 100%; background: linear-gradient(90deg, var(--SmartThemeBlurTintColor, #4a9eff), var(--green, #4caf50)); transition: width 0.3s ease;"></div>
          </div>
          ${file ? `<div style="font-size: 0.85em; color: var(--SmartThemeQuoteColor, #999);">当前文件: ${file}</div>` : ''}
        `;
      }
      
      // 更新弹窗进度条
      const progressBar = loadingModal?.querySelector('#ce-model-loading-progress-bar');
      const percentageEl = loadingModal?.querySelector('#ce-model-loading-percentage');
      const fileEl = loadingModal?.querySelector('#ce-model-loading-file');
      const completedEl = loadingModal?.querySelector('#ce-model-loading-completed');
      const totalEl = loadingModal?.querySelector('#ce-model-loading-total');
      
      if (progressBar && percentageEl) {
        const percent = progress.percent || 0;
        progressBar.style.width = `${percent}%`;
        percentageEl.textContent = `${percent}%`;
      }
      
      if (fileEl) {
        fileEl.textContent = progress.file || '准备中...';
      }
      
      if (completedEl && totalEl) {
        completedEl.textContent = progress.completedFiles || 0;
        totalEl.textContent = progress.totalFiles || 0;
      }
    });
    
    // 保存模型配置
    const charConfig = getConfigForCurrentCharacter();
    let loreConfig = loadLoreConfig(charConfig);
    
    if (!loreConfig.vectorization) {
      loreConfig.vectorization = { method: 'local' };
    }
    
    loreConfig.vectorization.localModel = {
      modelId: modelInfo.modelId,
      modelUrl: modelInfo.url,
      dimensions: modelInfo.dimensions || 384,
      cached: true,
      cacheKey: `ce-model-${modelInfo.modelId.replace('/', '-')}`,
      cacheVersion: '1.0'
    };
    
    const updatedConfig = saveLoreConfig(charConfig, loreConfig);
    await saveConfigForCurrentCharacter(updatedConfig);
    
    // 关闭加载弹窗
    loadingModal.remove();
    
    // 隐藏进度，刷新列表
    if (infoDiv) infoDiv.style.display = 'none';
    await loadLoreManagerData(modal);
    
    showMessage(modal, `模型 ${modelInfo.modelId} 下载成功！`, 'success');
    
  } catch (err) {
    console.error('[RAG] 模型下载失败:', err);
    if (loadingModal) loadingModal.remove();
    showMessage(modal, `模型下载失败: ${err.message}`, 'error', 5000);
    if (infoDiv) infoDiv.style.display = 'none';
  }
}

/**
 * 处理使用已缓存模型
 * @param {HTMLElement} modal
 * @param {string} modelId
 */
async function handleUseCachedModel(modal, modelId) {
  hideMessage(modal);
  
  // 创建加载提示弹窗（带加载动画）
  const loadingModal = createModelLoadingModal('正在切换模型...', modelId, true);
  document.body.appendChild(loadingModal);
  
  try {
    const charConfig = getConfigForCurrentCharacter();
    let loreConfig = loadLoreConfig(charConfig);
    
    // 获取模型信息
    const { validateHuggingFaceModel } = await import('../core/vectorization/model-manager.js');
    const result = await validateHuggingFaceModel(modelId);
    
    if (!result.valid) {
      loadingModal.remove();
      showMessage(modal, `无法获取模型信息: ${result.error}`, 'error');
      return;
    }
    
    const modelInfo = result.modelInfo;
    
    // 更新配置
    if (!loreConfig.vectorization) {
      loreConfig.vectorization = { method: 'local' };
    }
    
    loreConfig.vectorization.localModel = {
      modelId: modelInfo.modelId,
      modelUrl: modelInfo.url,
      dimensions: modelInfo.dimensions || 384,
      cached: true,
      cacheKey: `ce-model-${modelInfo.modelId.replace('/', '-')}`,
      cacheVersion: '1.0'
    };
    
    const updatedConfig = saveLoreConfig(charConfig, loreConfig);
    await saveConfigForCurrentCharacter(updatedConfig);
    
    // 关闭加载弹窗
    loadingModal.remove();
    
    // 刷新界面
    await loadLoreManagerData(modal);
    
    showMessage(modal, `已切换到模型: ${modelId}`, 'success');
  } catch (err) {
    console.error('[RAG] 切换模型失败:', err);
    loadingModal.remove();
    showMessage(modal, `切换失败: ${err.message}`, 'error');
  }
}

/**
 * 处理删除已缓存模型
 * @param {HTMLElement} modal
 * @param {string} modelId
 */
async function handleDeleteCachedModel(modal, modelId) {
  if (!confirm(`确定要删除模型 ${modelId} 吗？\n删除后需要重新下载才能使用。`)) {
    return;
  }
  
  hideMessage(modal);
  
  // 创建加载提示弹窗（带加载动画）
  const loadingModal = createModelLoadingModal('正在删除模型...', modelId, true);
  document.body.appendChild(loadingModal);
  
  try {
    const { modelCacheManager } = await import('../core/vectorization/model-manager.js');
    await modelCacheManager.clearModelCache(modelId);
    
    // 如果删除的是当前使用的模型，清除配置
    const charConfig = getConfigForCurrentCharacter();
    let loreConfig = loadLoreConfig(charConfig);
    
    if (loreConfig.vectorization?.localModel?.modelId === modelId) {
      loreConfig.vectorization.localModel = null;
      const updatedConfig = saveLoreConfig(charConfig, loreConfig);
      await saveConfigForCurrentCharacter(updatedConfig);
    }
    
    // 关闭加载弹窗
    loadingModal.remove();
    
    // 刷新界面
    await loadLoreManagerData(modal);
    
    showMessage(modal, `模型 ${modelId} 已删除`, 'success');
  } catch (err) {
    console.error('[RAG] 删除模型失败:', err);
    loadingModal.remove();
    showMessage(modal, `删除失败: ${err.message}`, 'error');
  }
}

/**
 * 获取模型大小估算
 * @param {string} modelId
 * @returns {string}
 */
function getModelSizeEstimate(modelId) {
  if (modelId.includes('all-MiniLM-L6-v2')) return '23 MB';
  if (modelId.includes('paraphrase-multilingual-MiniLM-L12-v2')) return '50 MB';
  if (modelId.includes('multilingual-e5-small')) return '118 MB';
  return '未知';
}

/**
 * 创建向量化进度模态窗口
 * @param {string} collectionName - 集合名称
 * @returns {HTMLElement}
 */
function createVectorizationProgressModal(collectionName) {
  const backdrop = document.createElement('div');
  backdrop.className = 'ce-modal-backdrop';
  backdrop.setAttribute('data-ce-vectorization-progress', '');
  backdrop.style.display = 'flex';
  backdrop.style.zIndex = '10001'; // 确保在主模态窗口之上
  
  backdrop.innerHTML = `
    <div class="ce-modal ce-modal-small">
      <div class="ce-modal-header">
        <div class="ce-modal-title">
          <span>⚙️</span>
          <span>正在向量化</span>
        </div>
      </div>
      
      <div class="ce-modal-body">
        <div style="margin-bottom: 15px;">
          <div style="font-weight: 500; margin-bottom: 8px;">集合: ${collectionName}</div>
          <div id="ce-vectorization-status" style="color: var(--SmartThemeQuoteColor, #999); font-size: 0.9em; display: flex; align-items: center; gap: 8px;">
            <div class="ce-loading-spinner ce-loading-spinner-small"></div>
            <span>准备中...</span>
          </div>
        </div>
        
        <div style="margin-bottom: 15px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 0.9em;">
            <span>进度</span>
            <span id="ce-vectorization-percentage">0%</span>
          </div>
          <div style="width: 100%; height: 20px; background: var(--black50a, rgba(0,0,0,0.5)); border-radius: 10px; overflow: hidden;">
            <div id="ce-vectorization-progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, var(--SmartThemeBlurTintColor, #4a9eff), var(--green, #4caf50)); transition: width 0.3s ease;"></div>
          </div>
        </div>
        
        <div id="ce-vectorization-details" style="font-size: 0.85em; color: var(--SmartThemeQuoteColor, #999); line-height: 1.6;">
          <div>已处理: <span id="ce-vectorization-current">0</span> / <span id="ce-vectorization-total">0</span> 个片段</div>
          <div>当前文档: <span id="ce-vectorization-current-doc">-</span></div>
          <div>预计剩余: <span id="ce-vectorization-eta">计算中...</span></div>
        </div>
      </div>
      
      <div class="ce-modal-footer">
        <button class="ce-btn ce-btn-secondary ce-btn-small" data-action="cancel-vectorization">取消</button>
      </div>
    </div>
  `;
  
  // 绑定取消按钮
  backdrop.querySelector('[data-action="cancel-vectorization"]')?.addEventListener('click', () => {
    if (confirm('确定要取消向量化吗？')) {
      cancelVectorization();
      backdrop.remove();
    }
  });
  
  return backdrop;
}

/**
 * 更新向量化进度
 * @param {HTMLElement} modal - 进度模态窗口
 * @param {Object} progress - 进度信息
 */
function updateVectorizationProgress(modal, progress) {
  if (!modal) return;
  
  // 更新状态文本（带加载动画）
  const statusEl = modal.querySelector('#ce-vectorization-status');
  if (statusEl) {
    let statusText = '';
    let showSpinner = true;
    
    if (progress.modelLoadProgress !== undefined) {
      statusText = `正在加载模型... ${progress.modelLoadProgress}%`;
    } else if (progress.percentage >= 100) {
      statusText = '向量化完成！';
      showSpinner = false;
    } else {
      statusText = '正在向量化文档...';
    }
    
    statusEl.innerHTML = `
      ${showSpinner ? '<div class="ce-loading-spinner ce-loading-spinner-small"></div>' : '✓'}
      <span>${statusText}</span>
    `;
  }
  
  // 更新进度条
  const progressBar = modal.querySelector('#ce-vectorization-progress-bar');
  const percentageEl = modal.querySelector('#ce-vectorization-percentage');
  if (progressBar && percentageEl) {
    const percentage = progress.percentage || 0;
    progressBar.style.width = `${percentage}%`;
    percentageEl.textContent = `${percentage}%`;
  }
  
  // 更新详细信息
  const currentEl = modal.querySelector('#ce-vectorization-current');
  const totalEl = modal.querySelector('#ce-vectorization-total');
  const currentDocEl = modal.querySelector('#ce-vectorization-current-doc');
  const etaEl = modal.querySelector('#ce-vectorization-eta');
  
  if (currentEl) currentEl.textContent = progress.current || 0;
  if (totalEl) totalEl.textContent = progress.total || 0;
  if (currentDocEl) currentDocEl.textContent = progress.currentDoc || '-';
  
  if (etaEl) {
    if (progress.estimatedTimeRemaining !== null && progress.estimatedTimeRemaining !== undefined) {
      const minutes = Math.floor(progress.estimatedTimeRemaining / 60);
      const seconds = progress.estimatedTimeRemaining % 60;
      if (minutes > 0) {
        etaEl.textContent = `约 ${minutes} 分 ${seconds} 秒`;
      } else {
        etaEl.textContent = `约 ${seconds} 秒`;
      }
    } else {
      etaEl.textContent = '计算中...';
    }
  }
}

/**
 * 创建模型加载提示弹窗
 * @param {string} title - 弹窗标题
 * @param {string} modelId - 模型ID
 * @param {boolean} showSpinner - 是否显示加载动画
 * @param {boolean} showProgress - 是否显示进度条
 * @returns {HTMLElement}
 */
function createModelLoadingModal(title, modelId, showSpinner = true, showProgress = false) {
  const backdrop = document.createElement('div');
  backdrop.className = 'ce-modal-backdrop';
  backdrop.setAttribute('data-ce-model-loading', '');
  backdrop.style.display = 'flex';
  backdrop.style.zIndex = '10001'; // 确保在主模态窗口之上
  
  backdrop.innerHTML = `
    <div class="ce-modal ce-modal-small">
      <div class="ce-modal-header">
        <div class="ce-modal-title">
          <span>⚙️</span>
          <span>${title}</span>
        </div>
      </div>
      
      <div class="ce-modal-body">
        <div style="padding: 20px;">
          ${showSpinner ? '<div style="display: flex; justify-content: center; margin-bottom: 16px;"><div class="ce-loading-spinner ce-loading-spinner-large"></div></div>' : ''}
          <div style="font-weight: 500; margin-bottom: 12px; text-align: center;">${modelId}</div>
          
          ${showProgress ? `
            <div style="margin-bottom: 15px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 0.9em;">
                <span>下载进度</span>
                <span id="ce-model-loading-percentage">0%</span>
              </div>
              <div style="width: 100%; height: 20px; background: var(--black50a, rgba(0,0,0,0.5)); border-radius: 10px; overflow: hidden;">
                <div id="ce-model-loading-progress-bar" class="ce-progress-bar-animated" style="width: 0%; height: 100%; background: linear-gradient(90deg, var(--SmartThemeBlurTintColor, #4a9eff), var(--green, #4caf50)); transition: width 0.3s ease;"></div>
              </div>
            </div>
            
            <div id="ce-model-loading-details" style="font-size: 0.85em; color: var(--SmartThemeQuoteColor, #999); line-height: 1.6;">
              <div>当前文件: <span id="ce-model-loading-file">准备中...</span></div>
              <div>已完成: <span id="ce-model-loading-completed">0</span> / <span id="ce-model-loading-total">0</span> 个文件</div>
            </div>
          ` : `
            <div style="color: var(--SmartThemeQuoteColor, #999); font-size: 0.9em; text-align: center;">
              ${showSpinner ? '<div style="display: flex; align-items: center; justify-content: center; gap: 6px; margin-bottom: 8px;"><div class="ce-loading-dots"><div class="ce-loading-dot"></div><div class="ce-loading-dot"></div><div class="ce-loading-dot"></div></div></div>' : ''}
              <div>请稍候</div>
            </div>
          `}
        </div>
      </div>
    </div>
  `;
  
  // 添加动画样式
  if (!document.querySelector('#ce-loading-animation-style')) {
    const style = document.createElement('style');
    style.id = 'ce-loading-animation-style';
    style.textContent = `
      @keyframes loading-pulse {
        0%, 100% { opacity: 0.4; }
        50% { opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }
  
  return backdrop;
}