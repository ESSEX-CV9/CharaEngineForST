// 独立集合管理器UI
// 提供独立的集合管理界面，与世界观设定管理器数据互通

import { loadLoreConfig, saveLoreConfig, getLoreCollections, addCollection, updateCollection, deleteCollection, createEmptyCollection } from '../integration/lore-storage.js';
import { getConfigForCurrentCharacter, saveConfigForCurrentCharacter } from '../../integration/card-storage.js';
import { openDocumentEditor } from './document-editor.js';

/**
 * 打开独立集合管理器
 */
export function openCollectionManager() {
  console.log('[RAG CollectionManager] 打开独立集合管理器');
  
  // 创建模态窗口
  const modal = createCollectionManagerModal();
  document.body.appendChild(modal);
  
  // 加载数据
  loadCollectionManagerData(modal);
  
  // 绑定事件
  bindCollectionManagerEvents(modal);
}

/**
 * 创建独立集合管理器模态窗口
 * @returns {HTMLElement}
 */
function createCollectionManagerModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'ce-modal-backdrop';
  backdrop.setAttribute('data-ce-collection-manager', '');
  backdrop.style.display = 'flex';
  
  backdrop.innerHTML = `
    <div class="ce-modal ce-modal-large">
      <div class="ce-modal-header">
        <div class="ce-modal-title">
          <i class="fa-solid fa-books"></i>
          <span>集合管理器</span>
        </div>
        <button class="ce-modal-close" data-action="close" title="关闭">&times;</button>
      </div>
      
      <div class="ce-modal-body">
        <!-- 顶部操作栏 -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
          <div style="color: var(--SmartThemeQuoteColor, #999); font-size: 0.9em;">
            管理所有RAG集合，与世界观设定管理器数据同步
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="ce-btn ce-btn-small" data-action="new-collection">
              <i class="fa-solid fa-plus"></i> 新建集合
            </button>
            <button class="ce-btn ce-btn-small ce-btn-secondary" data-action="import-collections">
              <i class="fa-solid fa-file-import"></i> 导入集合
            </button>
            <button class="ce-btn ce-btn-small ce-btn-secondary" data-action="refresh">
              <i class="fa-solid fa-rotate"></i> 刷新
            </button>
          </div>
        </div>
        
        <!-- 主布局：左列(统计+列表) + 右列(操作面板) -->
        <div style="display: flex; gap: 15px;">
          <!-- 左列：统计信息 + 集合列表 -->
          <div style="flex: 1; display: flex; flex-direction: column; gap: 15px;">
            <!-- 统计信息 (一行四个，很矮) -->
            <div id="ce-collection-stats" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
              <!-- 统计卡片将在这里动态生成 -->
            </div>
            
            <!-- 集合列表 -->
            <div>
              <div style="font-weight: 600; font-size: 1em; margin-bottom: 10px; color: var(--SmartThemeBodyColor, #ddd);">集合列表</div>
              <div id="ce-collections-list" style="display: flex; flex-direction: column; gap: 12px;">
                <div style="text-align: center; padding: 40px; color: var(--SmartThemeQuoteColor, #999);">
                  <div class="ce-loading-indicator" style="display: inline-flex; margin-bottom: 8px;">
                    <div class="ce-loading-spinner"></div>
                    <span>加载中...</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <!-- 右列：向量化操作面板 (窄高) -->
          <div id="ce-vectorization-panel" style="width: 260px; display: flex; flex-direction: column; gap: 10px; padding: 15px; background: var(--black30a, rgba(0,0,0,0.3)); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 8px;">
            <div style="font-weight: 600; font-size: 1em; margin-bottom: 5px; color: var(--SmartThemeBodyColor, #ddd);"><i class="fa-solid fa-bolt"></i> 快速操作</div>
            
            <!-- 模型选择 -->
            <div>
              <label style="display: block; margin-bottom: 6px; font-size: 0.9em; font-weight: 500;">模型选择:</label>
              <select id="ce-quick-model-select" style="width: 100%; padding: 8px; background: var(--black50a, rgba(0,0,0,0.5)); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 4px; color: var(--SmartThemeBodyColor, #ddd); font-size: 0.9em;">
                <option value="Xenova/all-MiniLM-L6-v2">all-MiniLM-L6-v2 (384维)</option>
                <option value="Xenova/paraphrase-multilingual-MiniLM-L12-v2">paraphrase-multilingual (384维)</option>
                <option value="Xenova/multilingual-e5-small">multilingual-e5-small (384维)</option>
              </select>
            </div>
            
            <!-- 分块策略 -->
            <div>
              <label style="display: block; margin-bottom: 6px; font-size: 0.9em; font-weight: 500;">分块策略:</label>
              <select id="ce-quick-chunk-strategy" style="width: 100%; padding: 8px; background: var(--black50a, rgba(0,0,0,0.5)); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 4px; color: var(--SmartThemeBodyColor, #ddd); font-size: 0.9em;">
                <option value="fixed">固定长度 (512字符)</option>
                <option value="semantic">语义分块</option>
                <option value="sentence">句子分块</option>
                <option value="custom">自定义分块</option>
              </select>
            </div>
            
            <!-- 操作按钮 -->
            <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px;">
              <button class="ce-btn ce-btn-small" data-action="quick-download-model" style="width: 100%; justify-content: center;">
                <i class="fa-solid fa-download"></i> 下载模型
              </button>
              <button class="ce-btn ce-btn-small" data-action="quick-vectorize-selected" style="width: 100%; justify-content: center;">
                <i class="fa-solid fa-wand-magic-sparkles"></i> 向量化选中
              </button>
              <button class="ce-btn ce-btn-small ce-btn-secondary" data-action="quick-export-selected" style="width: 100%; justify-content: center;">
                <i class="fa-solid fa-file-export"></i> 导出选中
              </button>
            </div>
            
            <!-- 提示信息 -->
            <div style="margin-top: 10px; padding: 8px; background: var(--black50a, rgba(0,0,0,0.5)); border-radius: 4px; font-size: 0.8em; color: var(--SmartThemeQuoteColor, #999); line-height: 1.4;">
              <i class="fa-solid fa-lightbulb"></i> 勾选集合后可批量操作
            </div>
          </div>
        </div>
      </div>
      
      <div class="ce-modal-footer">
        <button class="ce-btn ce-btn-secondary" data-action="close">关闭</button>
      </div>
    </div>
  `;
  
  return backdrop;
}

/**
 * 加载集合管理器数据
 * @param {HTMLElement} modal
 */
function loadCollectionManagerData(modal) {
  const charConfig = getConfigForCurrentCharacter();
  const loreConfig = loadLoreConfig(charConfig);
  
  // 渲染统计信息
  renderCollectionStats(modal, loreConfig);
  
  // 渲染集合列表
  renderCollectionsList(modal, loreConfig);
}

/**
 * 渲染集合统计信息
 * @param {HTMLElement} modal
 * @param {Object} loreConfig
 */
function renderCollectionStats(modal, loreConfig) {
  const statsContainer = modal.querySelector('#ce-collection-stats');
  const collections = getLoreCollections(loreConfig);
  
  // 计算统计数据
  const totalCollections = collections.length;
  const totalDocuments = collections.reduce((sum, c) => sum + (c.documents?.length || 0), 0);
  const totalChunks = collections.reduce((sum, c) => sum + (c.vectorStore?.chunks?.length || 0), 0);
  const vectorizedCollections = collections.filter(c => c.vectorStore?.chunks?.length > 0).length;
  
  statsContainer.innerHTML = `
    <div style="padding: 8px 10px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 4px; border-left: 3px solid var(--SmartThemeBlurTintColor, #4a9eff); display: flex; align-items: center; justify-content: space-between;">
      <div style="font-size: 0.75em; color: var(--SmartThemeQuoteColor, #999);">集合总数</div>
      <div style="font-size: 1.3em; font-weight: 600;">${totalCollections}</div>
    </div>
    
    <div style="padding: 8px 10px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 4px; border-left: 3px solid var(--green, #4caf50); display: flex; align-items: center; justify-content: space-between;">
      <div style="font-size: 0.75em; color: var(--SmartThemeQuoteColor, #999);">已向量化</div>
      <div style="font-size: 1.3em; font-weight: 600;">${vectorizedCollections}</div>
    </div>
    
    <div style="padding: 8px 10px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 4px; border-left: 3px solid var(--orange, #ff9800); display: flex; align-items: center; justify-content: space-between;">
      <div style="font-size: 0.75em; color: var(--SmartThemeQuoteColor, #999);">文档总数</div>
      <div style="font-size: 1.3em; font-weight: 600;">${totalDocuments}</div>
    </div>
    
    <div style="padding: 8px 10px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 4px; border-left: 3px solid var(--purple, #9c27b0); display: flex; align-items: center; justify-content: space-between;">
      <div style="font-size: 0.75em; color: var(--SmartThemeQuoteColor, #999);">片段总数</div>
      <div style="font-size: 1.3em; font-weight: 600;">${totalChunks}</div>
    </div>
  `;
}

/**
 * 渲染集合列表
 * @param {HTMLElement} modal
 * @param {Object} loreConfig
 */
function renderCollectionsList(modal, loreConfig) {
  const listContainer = modal.querySelector('#ce-collections-list');
  const collections = getLoreCollections(loreConfig);
  
  if (collections.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 60px 20px;">
        <div style="font-size: 3em; margin-bottom: 16px; opacity: 0.3;"><i class="fa-solid fa-books"></i></div>
        <div style="font-size: 1.1em; color: var(--SmartThemeQuoteColor, #999); margin-bottom: 8px;">暂无集合</div>
        <div style="font-size: 0.9em; color: var(--SmartThemeQuoteColor, #999); font-style: italic;">点击"新建集合"开始创建您的第一个RAG集合</div>
      </div>
    `;
    return;
  }
  
  listContainer.innerHTML = collections.map(collection => {
    const docCount = collection.documents?.length || 0;
    const chunkCount = collection.vectorStore?.chunks?.length || 0;
    const isVectorized = chunkCount > 0;
    
    // 计算集合大小（估算）
    const estimatedSize = estimateCollectionSize(collection);
    
    // 状态徽章
    const statusBadge = isVectorized
      ? '<span class="ce-collapsible-badge" style="background: var(--green, #4caf50);"><i class="fa-solid fa-check"></i> 已向量化</span>'
      : '<span class="ce-collapsible-badge" style="background: var(--orange, #ff9800);"><i class="fa-solid fa-triangle-exclamation"></i> 未向量化</span>';
    
    // 分块策略显示
    const chunkStrategy = collection.chunkConfig?.strategy || 'fixed';
    const strategyNames = {
      fixed: '固定长度',
      semantic: '语义分块',
      sentence: '句子分块',
      custom: '自定义'
    };
    const strategyName = strategyNames[chunkStrategy] || chunkStrategy;
    
    return `
      <div class="ce-collection-card" data-collection-id="${collection.id}">
        <div class="ce-collection-card-header">
          <!-- 复选框 -->
          <div style="display: flex; align-items: center; margin-right: 12px;">
            <input type="checkbox" class="ce-collection-checkbox" data-collection-id="${collection.id}" style="width: 18px; height: 18px; cursor: pointer;">
          </div>
          
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
              <h3 style="margin: 0; font-size: 1.2em;">${collection.name || collection.id}</h3>
              ${statusBadge}
            </div>
            ${collection.description ? `<div style="color: var(--SmartThemeQuoteColor, #999); font-size: 0.9em; font-style: italic; margin-bottom: 8px;">${collection.description}</div>` : ''}
            <div style="display: flex; gap: 20px; font-size: 0.9em; color: var(--SmartThemeQuoteColor, #999);">
              <span>📄 ${docCount} 个文档</span>
              <span>🧩 ${chunkCount} 个片段</span>
              <span>📏 ${strategyName}</span>
              <span>💾 ${estimatedSize}</span>
            </div>
          </div>
          <div style="display: flex; gap: 8px; align-items: flex-start;">
            <button class="ce-btn ce-btn-small" data-action="edit-collection" data-collection-id="${collection.id}" title="编辑文档">
              <span>✏️</span> 编辑
            </button>
            <button class="ce-btn ce-btn-small ce-btn-secondary" data-action="view-details" data-collection-id="${collection.id}" title="查看详情">
              <span>👁️</span> 详情
            </button>
            <button class="ce-btn ce-btn-small ce-btn-danger" data-action="delete-collection" data-collection-id="${collection.id}" title="删除集合">
              <span>🗑️</span> 删除
            </button>
          </div>
        </div>
        
        <!-- 可展开的详细信息 -->
        <div class="ce-collection-card-details" id="details-${collection.id}" style="display: none; margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--SmartThemeBorderColor, #444);">
          ${renderCollectionDetails(collection)}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 渲染集合详细信息
 * @param {Object} collection
 * @returns {string}
 */
function renderCollectionDetails(collection) {
  const docs = collection.documents || [];
  const vectorStore = collection.vectorStore;
  const chunkConfig = collection.chunkConfig || {};
  
  let html = '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">';
  
  // 左列：文档列表
  html += '<div>';
  html += '<h4 style="margin: 0 0 10px 0; font-size: 1em; color: var(--SmartThemeBodyColor, #ddd);">📄 文档列表</h4>';
  if (docs.length === 0) {
    html += '<div style="color: var(--SmartThemeQuoteColor, #999); font-style: italic;">暂无文档</div>';
  } else {
    html += '<div style="display: flex; flex-direction: column; gap: 6px;">';
    docs.forEach(doc => {
      const wordCount = doc.content?.length || 0;
      html += `
        <div style="padding: 8px; background: var(--black50a, rgba(0,0,0,0.5)); border-radius: 4px; font-size: 0.9em;">
          <div style="font-weight: 500;">${doc.title || doc.id}</div>
          <div style="color: var(--SmartThemeQuoteColor, #999); font-size: 0.85em;">${wordCount} 字符</div>
        </div>
      `;
    });
    html += '</div>';
  }
  html += '</div>';
  
  // 右列：配置信息
  html += '<div>';
  html += '<h4 style="margin: 0 0 10px 0; font-size: 1em; color: var(--SmartThemeBodyColor, #ddd);">⚙️ 配置信息</h4>';
  html += '<div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.9em;">';
  
  // 分块策略
  const strategy = chunkConfig.strategy || 'fixed';
  const strategyNames = {
    fixed: '固定长度分块',
    semantic: '语义分块',
    sentence: '句子分块',
    custom: '自定义分块'
  };
  html += `<div><strong>分块策略:</strong> ${strategyNames[strategy] || strategy}</div>`;
  
  // 策略参数
  if (strategy === 'fixed' && chunkConfig.fixed) {
    html += `<div><strong>块大小:</strong> ${chunkConfig.fixed.chunkSize} 字符</div>`;
    html += `<div><strong>重叠:</strong> ${chunkConfig.fixed.overlap} 字符</div>`;
  } else if (strategy === 'semantic' && chunkConfig.semantic) {
    html += `<div><strong>最小大小:</strong> ${chunkConfig.semantic.minChunkSize} 字符</div>`;
    html += `<div><strong>最大大小:</strong> ${chunkConfig.semantic.maxChunkSize} 字符</div>`;
    html += `<div><strong>分割方式:</strong> ${chunkConfig.semantic.splitBy}</div>`;
  } else if (strategy === 'sentence' && chunkConfig.sentence) {
    html += `<div><strong>每块句子数:</strong> ${chunkConfig.sentence.sentencesPerChunk}</div>`;
    html += `<div><strong>重叠句子数:</strong> ${chunkConfig.sentence.overlap}</div>`;
  } else if (strategy === 'custom' && chunkConfig.custom) {
    html += `<div><strong>分隔符:</strong> ${chunkConfig.custom.delimiter}</div>`;
    html += `<div><strong>保留分隔符:</strong> ${chunkConfig.custom.preserveDelimiter ? '是' : '否'}</div>`;
  }
  
  // 向量化信息
  if (vectorStore && vectorStore.meta) {
    html += '<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--SmartThemeBorderColor, #444);">';
    html += '<div style="font-weight: 500; margin-bottom: 6px;">向量化信息:</div>';
    html += `<div><strong>模型:</strong> ${vectorStore.modelId || '未知'}</div>`;
    html += `<div><strong>维度:</strong> ${vectorStore.dimensions || '未知'}</div>`;
    html += `<div><strong>向量化时间:</strong> ${new Date(vectorStore.meta.vectorizedAt).toLocaleString('zh-CN')}</div>`;
    html += '</div>';
  }
  
  html += '</div>';
  html += '</div>';
  
  html += '</div>';
  
  return html;
}

/**
 * 估算集合大小
 * @param {Object} collection
 * @returns {string}
 */
function estimateCollectionSize(collection) {
  let totalSize = 0;
  
  // 文档大小
  if (collection.documents) {
    collection.documents.forEach(doc => {
      if (doc.content) {
        totalSize += doc.content.length * 2; // UTF-16
      }
    });
  }
  
  // 向量存储大小
  if (collection.vectorStore?.chunks) {
    const chunkCount = collection.vectorStore.chunks.length;
    const dimensions = collection.vectorStore.dimensions || 384;
    totalSize += chunkCount * dimensions * 4; // Float32
    
    // 分块文本
    collection.vectorStore.chunks.forEach(chunk => {
      if (chunk.text) {
        totalSize += chunk.text.length * 2;
      }
    });
  }
  
  // 格式化大小
  if (totalSize < 1024) {
    return `${totalSize} B`;
  } else if (totalSize < 1024 * 1024) {
    return `${(totalSize / 1024).toFixed(1)} KB`;
  } else {
    return `${(totalSize / (1024 * 1024)).toFixed(1)} MB`;
  }
}

/**
 * 绑定事件
 * @param {HTMLElement} modal
 */
function bindCollectionManagerEvents(modal) {
  // 关闭按钮
  modal.querySelectorAll('[data-action="close"]').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.remove();
    });
  });
  
  // 点击背景关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
  
  // 新建集合
  modal.querySelector('[data-action="new-collection"]')?.addEventListener('click', () => {
    handleNewCollection(modal);
  });
  
  // 导入集合
  modal.querySelector('[data-action="import-collections"]')?.addEventListener('click', () => {
    handleImportCollections(modal);
  });
  
  // 刷新
  modal.querySelector('[data-action="refresh"]')?.addEventListener('click', () => {
    loadCollectionManagerData(modal);
  });
  
  // 集合操作（使用事件委托）
  modal.querySelector('#ce-collections-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    
    const action = btn.dataset.action;
    const collectionId = btn.dataset.collectionId;
    
    if (action === 'edit-collection') {
      handleEditCollection(modal, collectionId);
    } else if (action === 'view-details') {
      handleViewDetails(modal, collectionId);
    } else if (action === 'delete-collection') {
      handleDeleteCollection(modal, collectionId);
    }
  });
  
  // 快速操作按钮
  modal.querySelector('[data-action="quick-download-model"]')?.addEventListener('click', () => {
    handleQuickDownloadModel(modal);
  });
  
  modal.querySelector('[data-action="quick-vectorize-selected"]')?.addEventListener('click', () => {
    handleQuickVectorizeSelected(modal);
  });
  
  modal.querySelector('[data-action="quick-export-selected"]')?.addEventListener('click', () => {
    handleQuickExportSelected(modal);
  });
}

/**
 * 处理新建集合
 * @param {HTMLElement} modal
 */
async function handleNewCollection(modal) {
  const name = await showPrompt('请输入集合名称:');
  if (!name) return;
  
  const description = await showPrompt('请输入集合描述（可选）:') || '';
  
  const id = `collection_${Date.now()}`;
  
  try {
    const charConfig = getConfigForCurrentCharacter();
    let loreConfig = loadLoreConfig(charConfig);
    
    // 使用全局默认分块配置创建新集合
    const collection = createEmptyCollection(id, name, description, loreConfig.defaultChunkConfig);
    
    loreConfig = addCollection(loreConfig, collection);
    const updatedConfig = saveLoreConfig(charConfig, loreConfig);
    
    const saved = await saveConfigForCurrentCharacter(updatedConfig);
    
    if (!saved) {
      throw new Error('保存角色卡失败');
    }
    
    // 刷新界面
    loadCollectionManagerData(modal);
    showNotification('success', `集合 "${name}" 创建成功！`);
  } catch (err) {
    console.error('[CollectionManager] 创建集合失败:', err);
    showNotification('error', `创建失败: ${err.message}`);
  }
}

/**
 * 处理编辑集合
 * @param {HTMLElement} modal
 * @param {string} collectionId
 */
function handleEditCollection(modal, collectionId) {
  openDocumentEditor(collectionId, () => {
    loadCollectionManagerData(modal);
  });
}

/**
 * 处理查看详情
 * @param {HTMLElement} modal
 * @param {string} collectionId
 */
function handleViewDetails(modal, collectionId) {
  const detailsDiv = modal.querySelector(`#details-${collectionId}`);
  if (!detailsDiv) return;
  
  const isHidden = detailsDiv.style.display === 'none';
  detailsDiv.style.display = isHidden ? 'block' : 'none';
}

/**
 * 处理删除集合
 * @param {HTMLElement} modal
 * @param {string} collectionId
 */
async function handleDeleteCollection(modal, collectionId) {
  const charConfig = getConfigForCurrentCharacter();
  const loreConfig = loadLoreConfig(charConfig);
  const collection = loreConfig.collections.find(c => c.id === collectionId);
  
  if (!collection) {
    showNotification('error', '集合不存在');
    return;
  }
  
  if (!(await showConfirm(`确定要删除集合"${collection.name}"吗？\n此操作不可恢复。`))) {
    return;
  }
  
  try {
    const updatedLoreConfig = deleteCollection(loreConfig, collectionId);
    const updatedConfig = saveLoreConfig(charConfig, updatedLoreConfig);
    await saveConfigForCurrentCharacter(updatedConfig);
    
    loadCollectionManagerData(modal);
    showNotification('success', '集合已删除');
  } catch (err) {
    console.error('[CollectionManager] 删除集合失败:', err);
    showNotification('error', `删除失败: ${err.message}`);
  }
}

/**
 * 获取选中的集合ID列表
 * @param {HTMLElement} modal
 * @returns {string[]}
 */
function getSelectedCollectionIds(modal) {
  const checkboxes = modal.querySelectorAll('.ce-collection-checkbox:checked');
  return Array.from(checkboxes).map(cb => cb.dataset.collectionId);
}

/**
 * 处理快速下载模型
 * @param {HTMLElement} modal
 */
async function handleQuickDownloadModel(modal) {
  const modelSelect = modal.querySelector('#ce-quick-model-select');
  const modelId = modelSelect?.value;
  
  if (!modelId) {
    showNotification('warning', '请选择模型');
    return;
  }
  
  showNotification('info', `开始下载模型: ${modelId}...`);
  
  try {
    const { modelCacheManager } = await import('../core/vectorization/model-manager.js');
    
    // 检查是否已缓存
    const cached = await modelCacheManager.isModelCached(modelId);
    if (cached) {
      showNotification('info', '模型已存在，无需重复下载');
      return;
    }
    
    // 下载模型
    await modelCacheManager.loadModel(modelId, (progress) => {
      console.log(`[CollectionManager] 模型下载进度: ${progress.percent}%`);
    });
    
    showNotification('success', `模型 ${modelId} 下载成功！`);
  } catch (err) {
    console.error('[CollectionManager] 模型下载失败:', err);
    showNotification('error', `模型下载失败: ${err.message}`);
  }
}

/**
 * 处理快速向量化选中集合
 * @param {HTMLElement} modal
 */
async function handleQuickVectorizeSelected(modal) {
  const selectedIds = getSelectedCollectionIds(modal);
  
  if (selectedIds.length === 0) {
    showNotification('warning', '请先勾选要向量化的集合');
    return;
  }
  
  const modelSelect = modal.querySelector('#ce-quick-model-select');
  const chunkStrategySelect = modal.querySelector('#ce-quick-chunk-strategy');
  const modelId = modelSelect?.value;
  const chunkStrategy = chunkStrategySelect?.value;
  
  if (!(await showConfirm(`确定要向量化选中的 ${selectedIds.length} 个集合吗？\n模型: ${modelId}\n分块策略: ${chunkStrategy}`))) {
    return;
  }
  
  showNotification('info', `开始向量化 ${selectedIds.length} 个集合...`);
  
  try {
    const { vectorizeCollection } = await import('../core/vectorization/local-vectorizer.js');
    const charConfig = getConfigForCurrentCharacter();
    let loreConfig = loadLoreConfig(charConfig);
    
    let successCount = 0;
    let failCount = 0;
    
    for (const collectionId of selectedIds) {
      try {
        const collection = loreConfig.collections.find(c => c.id === collectionId);
        if (!collection) continue;
        
        if (!collection.documents || collection.documents.length === 0) {
          console.warn(`[CollectionManager] 集合 ${collection.name} 没有文档，跳过`);
          failCount++;
          continue;
        }
        
        // 使用选中的分块策略更新集合配置
        const updatedCollection = {
          ...collection,
          chunkConfig: {
            ...collection.chunkConfig,
            strategy: chunkStrategy
          }
        };
        
        const vectorizedCollection = await vectorizeCollection(
          updatedCollection,
          { modelId, dimensions: 384 },
          loreConfig.retrievalConfig
        );
        
        loreConfig = updateCollection(loreConfig, collectionId, vectorizedCollection);
        successCount++;
        
        showNotification('info', `已完成: ${collection.name} (${successCount}/${selectedIds.length})`);
      } catch (err) {
        console.error(`[CollectionManager] 向量化集合失败:`, err);
        failCount++;
      }
    }
    
    // 保存配置
    const updatedConfig = saveLoreConfig(charConfig, loreConfig);
    await saveConfigForCurrentCharacter(updatedConfig);
    
    // 刷新界面
    loadCollectionManagerData(modal);
    
    showNotification('success', `批量向量化完成！成功: ${successCount}, 失败: ${failCount}`);
  } catch (err) {
    console.error('[CollectionManager] 批量向量化失败:', err);
    showNotification('error', `批量向量化失败: ${err.message}`);
  }
}

/**
 * 处理快速导出选中集合
 * @param {HTMLElement} modal
 */
function handleQuickExportSelected(modal) {
  const selectedIds = getSelectedCollectionIds(modal);
  
  if (selectedIds.length === 0) {
    showNotification('warning', '请先勾选要导出的集合');
    return;
  }
  
  try {
    const charConfig = getConfigForCurrentCharacter();
    const loreConfig = loadLoreConfig(charConfig);
    
    const selectedCollections = selectedIds.map(id =>
      loreConfig.collections.find(c => c.id === id)
    ).filter(Boolean);
    
    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      exportedBy: 'CharacterEngine RAG Collection Manager',
      collections: selectedCollections
    };
    
    // 创建下载链接
    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `rag_collections_export_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showNotification('success', `已导出 ${selectedCollections.length} 个集合`);
  } catch (err) {
    console.error('[CollectionManager] 导出失败:', err);
    showNotification('error', `导出失败: ${err.message}`);
  }
}

/**
 * 处理导入集合
 * @param {HTMLElement} modal
 */
async function handleImportCollections(modal) {
  // 创建文件选择器
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json';
  fileInput.style.display = 'none';
  
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      // 读取文件内容
      const text = await file.text();
      const importData = JSON.parse(text);
      
      // 验证导入数据格式
      if (!importData.collections || !Array.isArray(importData.collections)) {
        throw new Error('无效的导入文件格式：缺少 collections 数组');
      }
      
      if (importData.collections.length === 0) {
        showNotification('warning', '导入文件中没有集合');
        return;
      }
      
      // 显示导入预览和选项
      const importResult = await showImportDialog(modal, importData);
      
      if (!importResult) {
        // 用户取消导入
        return;
      }
      
      const { selectedCollections, conflictResolution } = importResult;
      
      // 执行导入
      const charConfig = getConfigForCurrentCharacter();
      let loreConfig = loadLoreConfig(charConfig);
      
      let importedCount = 0;
      let skippedCount = 0;
      let replacedCount = 0;
      
      for (const collection of selectedCollections) {
        const existingIndex = loreConfig.collections.findIndex(c => c.id === collection.id);
        
        if (existingIndex !== -1) {
          // 集合ID已存在
          if (conflictResolution === 'skip') {
            skippedCount++;
            continue;
          } else if (conflictResolution === 'replace') {
            // 替换现有集合
            loreConfig.collections[existingIndex] = collection;
            replacedCount++;
          } else if (conflictResolution === 'rename') {
            // 重命名导入的集合
            const newId = `${collection.id}_imported_${Date.now()}`;
            const newCollection = {
              ...collection,
              id: newId,
              name: `${collection.name} (导入)`
            };
            loreConfig.collections.push(newCollection);
            importedCount++;
          }
        } else {
          // 新集合，直接添加
          loreConfig.collections.push(collection);
          importedCount++;
        }
      }
      
      // 保存配置
      const updatedConfig = saveLoreConfig(charConfig, loreConfig);
      await saveConfigForCurrentCharacter(updatedConfig);
      
      // 刷新界面
      loadCollectionManagerData(modal);
      
      // 显示结果
      let resultMessage = `导入完成！`;
      if (importedCount > 0) resultMessage += ` 新增: ${importedCount}`;
      if (replacedCount > 0) resultMessage += ` 替换: ${replacedCount}`;
      if (skippedCount > 0) resultMessage += ` 跳过: ${skippedCount}`;
      
      showNotification('success', resultMessage);
      
    } catch (err) {
      console.error('[CollectionManager] 导入失败:', err);
      showNotification('error', `导入失败: ${err.message}`);
    } finally {
      // 清理文件选择器
      document.body.removeChild(fileInput);
    }
  });
  
  // 触发文件选择
  document.body.appendChild(fileInput);
  fileInput.click();
}

/**
 * 显示导入对话框
 * @param {HTMLElement} parentModal
 * @param {Object} importData
 * @returns {Promise<Object|null>} 返回 {selectedCollections, conflictResolution} 或 null
 */
function showImportDialog(parentModal, importData) {
  return new Promise((resolve) => {
    const collections = importData.collections;
    const charConfig = getConfigForCurrentCharacter();
    const loreConfig = loadLoreConfig(charConfig);
    
    // 检测冲突
    const conflicts = collections.filter(c =>
      loreConfig.collections.some(existing => existing.id === c.id)
    );
    
    const hasConflicts = conflicts.length > 0;
    
    // 创建导入对话框
    const dialog = document.createElement('div');
    dialog.className = 'ce-modal-backdrop';
    dialog.style.display = 'flex';
    dialog.style.zIndex = '10002'; // 在主模态窗口之上
    
    dialog.innerHTML = `
      <div class="ce-modal ce-modal-medium">
        <div class="ce-modal-header">
          <div class="ce-modal-title">
            <i class="fa-solid fa-file-import"></i>
            <span>导入集合</span>
          </div>
          <button class="ce-modal-close" data-action="cancel-import">&times;</button>
        </div>
        
        <div class="ce-modal-body">
          <div style="margin-bottom: 15px;">
            <div style="font-weight: 500; margin-bottom: 8px;">导入信息:</div>
            <div style="padding: 10px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 4px; font-size: 0.9em;">
              <div>文件版本: ${importData.version || '未知'}</div>
              <div>导出时间: ${importData.exportDate ? new Date(importData.exportDate).toLocaleString('zh-CN') : '未知'}</div>
              <div>集合数量: ${collections.length}</div>
            </div>
          </div>
          
          ${hasConflicts ? `
            <div style="margin-bottom: 15px; padding: 12px; background: var(--orange, #ff9800)22; border: 1px solid var(--orange, #ff9800); border-radius: 4px;">
              <div style="font-weight: 500; margin-bottom: 8px; color: var(--orange, #ff9800);">
                <i class="fa-solid fa-triangle-exclamation"></i> 检测到 ${conflicts.length} 个ID冲突
              </div>
              <div style="font-size: 0.9em; margin-bottom: 10px;">
                以下集合的ID已存在:
              </div>
              <div style="max-height: 100px; overflow-y: auto; font-size: 0.85em; padding: 8px; background: var(--black50a, rgba(0,0,0,0.5)); border-radius: 4px;">
                ${conflicts.map(c => `<div>• ${c.name || c.id}</div>`).join('')}
              </div>
              <div style="margin-top: 10px;">
                <label style="display: block; margin-bottom: 6px; font-weight: 500;">冲突处理方式:</label>
                <select id="ce-import-conflict-resolution" style="width: 100%; padding: 8px; background: var(--black50a, rgba(0,0,0,0.5)); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 4px; color: var(--SmartThemeBodyColor, #ddd);">
                  <option value="skip">跳过冲突的集合</option>
                  <option value="replace">替换现有集合</option>
                  <option value="rename">重命名导入的集合</option>
                </select>
              </div>
            </div>
          ` : ''}
          
          <div style="margin-bottom: 15px;">
            <div style="font-weight: 500; margin-bottom: 8px;">选择要导入的集合:</div>
            <div style="max-height: 300px; overflow-y: auto; border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 4px; padding: 10px; background: var(--black30a, rgba(0,0,0,0.3));">
              <div style="margin-bottom: 10px;">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                  <input type="checkbox" id="ce-import-select-all" checked style="width: 18px; height: 18px;">
                  <span style="font-weight: 500;">全选 / 取消全选</span>
                </label>
              </div>
              <div style="border-top: 1px solid var(--SmartThemeBorderColor, #444); padding-top: 10px;">
                ${collections.map((c, i) => {
                  const isConflict = conflicts.some(conflict => conflict.id === c.id);
                  const docCount = c.documents?.length || 0;
                  const chunkCount = c.vectorStore?.chunks?.length || 0;
                  const conflictBadge = isConflict ? '<span style="color: var(--orange, #ff9800); font-size: 0.85em;"> ⚠️ 冲突</span>' : '';
                  
                  return `
                    <label style="display: flex; align-items: start; gap: 8px; padding: 8px; margin-bottom: 6px; background: var(--black50a, rgba(0,0,0,0.5)); border-radius: 4px; cursor: pointer;">
                      <input type="checkbox" class="ce-import-collection-checkbox" data-index="${i}" checked style="width: 18px; height: 18px; margin-top: 2px;">
                      <div style="flex: 1;">
                        <div style="font-weight: 500;">${c.name || c.id}${conflictBadge}</div>
                        <div style="font-size: 0.85em; color: var(--SmartThemeQuoteColor, #999);">
                          ${docCount} 个文档 | ${chunkCount} 个片段
                          ${c.description ? `<br><span style="font-style: italic;">${c.description}</span>` : ''}
                        </div>
                      </div>
                    </label>
                  `;
                }).join('')}
              </div>
            </div>
          </div>
        </div>
        
        <div class="ce-modal-footer">
          <button class="ce-btn" data-action="confirm-import">导入</button>
          <button class="ce-btn ce-btn-secondary" data-action="cancel-import">取消</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // 全选/取消全选
    const selectAllCheckbox = dialog.querySelector('#ce-import-select-all');
    const collectionCheckboxes = dialog.querySelectorAll('.ce-import-collection-checkbox');
    
    selectAllCheckbox?.addEventListener('change', (e) => {
      collectionCheckboxes.forEach(cb => {
        cb.checked = e.target.checked;
      });
    });
    
    // 确认导入
    dialog.querySelector('[data-action="confirm-import"]')?.addEventListener('click', () => {
      const selectedIndices = Array.from(collectionCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => parseInt(cb.dataset.index));
      
      if (selectedIndices.length === 0) {
        showAlert('请至少选择一个集合');
        return;
      }
      
      const selectedCollections = selectedIndices.map(i => collections[i]);
      const conflictResolution = dialog.querySelector('#ce-import-conflict-resolution')?.value || 'skip';
      
      dialog.remove();
      resolve({ selectedCollections, conflictResolution });
    });
    
    // 取消导入
    dialog.querySelectorAll('[data-action="cancel-import"]').forEach(btn => {
      btn.addEventListener('click', () => {
        dialog.remove();
        resolve(null);
      });
    });
    
    // 点击背景取消
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        dialog.remove();
        resolve(null);
      }
    });
  });
}

/**
 * 显示通知
 * @param {string} type - 'success' | 'error' | 'info' | 'warning'
 * @param {string} message
 */
function showNotification(type, message) {
  // 使用SillyTavern的通知系统
  if (window.toastr) {
    window.toastr[type](message);
  } else {
    // 降级到alert
    showAlert(message);
  }
}