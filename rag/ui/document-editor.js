// 文档编辑器UI
// 用于编辑集合中的文档

import { getCollectionById, updateCollection } from '../integration/lore-storage.js';
import { getConfigForCurrentCharacter, saveConfigForCurrentCharacter } from '../../integration/card-storage.js';
import { previewChunking, suggestChunkPositions, insertDelimitersAtPositions } from '../core/vectorization/chunker.js';

/**
 * 打开文档编辑器
 * @param {string} collectionId - 集合ID
 * @param {Function} onSave - 保存回调
 */
export function openDocumentEditor(collectionId, onSave) {
  console.log(`[RAG DocumentEditor] 打开文档编辑器: ${collectionId}`);
  
  const charConfig = getConfigForCurrentCharacter();
  const loreConfig = charConfig.loreConfig;
  
  if (!loreConfig) {
    alert('未找到 loreConfig 配置');
    return;
  }
  
  const collection = getCollectionById(loreConfig, collectionId);
  if (!collection) {
    alert('未找到指定的集合');
    return;
  }
  
  const modal = createDocumentEditorModal(collection);
  document.body.appendChild(modal);
  
  bindDocumentEditorEvents(modal, collection, onSave);
}

/**
 * 创建文档编辑器模态窗口
 * @param {Object} collection - 集合对象
 * @returns {HTMLElement}
 */
function createDocumentEditorModal(collection) {
  const backdrop = document.createElement('div');
  backdrop.className = 'ce-modal-backdrop';
  backdrop.setAttribute('data-ce-doc-editor-root', '');
  backdrop.style.display = 'flex';
  
  backdrop.innerHTML = `
    <div class="ce-modal ce-modal-large">
      <div class="ce-modal-header">
        <div class="ce-modal-title">
          <span>📝</span>
          <span>编辑文档 - ${collection.name || collection.id}</span>
        </div>
        <button class="ce-modal-close" data-action="close" title="关闭">&times;</button>
      </div>
      
      <div class="ce-modal-body">
        <div class="ce-section-header">
          <span>文档列表</span>
          <div style="display: flex; gap: 8px;">
            <button class="ce-btn ce-btn-small" data-action="add-document">
              <span>➕</span> 新建文档
            </button>
            <button class="ce-btn ce-btn-small ce-btn-secondary" data-action="import-file">
              <span>📁</span> 导入文件
            </button>
            <button class="ce-btn ce-btn-small ce-btn-secondary" data-action="preview-chunking">
              <span>👁️</span> 预览分块
            </button>
          </div>
        </div>
        
        <div id="ce-doc-list" style="margin-top: 10px;">
          <!-- 文档列表将在这里渲染 -->
        </div>
      </div>
      
      <div class="ce-modal-footer">
        <button class="ce-btn" data-action="save">保存</button>
        <button class="ce-btn ce-btn-secondary" data-action="close">关闭</button>
      </div>
    </div>
  `;
  
  return backdrop;
}

/**
 * 渲染文档列表
 * @param {HTMLElement} modal
 * @param {Object} collection
 */
function renderDocumentList(modal, collection) {
  const listContainer = modal.querySelector('#ce-doc-list');
  const documents = collection.documents || [];
  
  if (documents.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--SmartThemeQuoteColor, #999); font-style: italic;">
        暂无文档，点击"新建文档"或"导入文件"开始
      </div>
    `;
    return;
  }
  
  listContainer.innerHTML = documents.map((doc, index) => {
    const wordCount = doc.content?.length || 0;
    const tags = doc.metadata?.tags || [];
    
    return `
      <div class="ce-collapsible-card" data-doc-index="${index}">
        <div class="ce-collapsible-card-header" style="cursor: pointer;" data-action="toggle-doc" data-doc-index="${index}">
          <span class="ce-collapsible-toggle">▶</span>
          <div class="ce-collapsible-header-content">
            <span class="ce-collapsible-title">${doc.title || `文档 ${index + 1}`}</span>
            <span class="ce-collapsible-badge">${wordCount} 字</span>
            ${tags.length > 0 ? `<span class="ce-collapsible-hint">${tags.join(', ')}</span>` : ''}
          </div>
          <div style="display: flex; gap: 6px;" onclick="event.stopPropagation();">
            <button class="ce-btn ce-btn-small ce-btn-secondary" data-action="delete-doc" data-doc-index="${index}" title="删除">🗑️</button>
          </div>
        </div>
        <div class="ce-collapsible-card-content" style="display: none;">
          <div class="ce-collapsible-body-content">
            <div class="ce-form-row">
              <label>
                <span class="ce-form-label">标题:</span>
                <input type="text" data-doc-field="title" data-doc-index="${index}" value="${doc.title || ''}" placeholder="文档标题">
              </label>
            </div>
            
            <div class="ce-form-row">
              <label>
                <span class="ce-form-label">标签 (逗号分隔):</span>
                <input type="text" data-doc-field="tags" data-doc-index="${index}" value="${tags.join(', ')}" placeholder="例如: 世界观, 设定">
              </label>
            </div>
            
            <div class="ce-form-row">
              <label>
                <span class="ce-form-label">内容:</span>
                <textarea data-doc-field="content" data-doc-index="${index}" rows="10" placeholder="文档内容...">${doc.content || ''}</textarea>
              </label>
            </div>
            
            <div class="ce-form-row" style="display: flex; gap: 8px; margin-top: 10px;">
              <button class="ce-btn ce-btn-small ce-btn-secondary" data-action="preview-doc-chunks" data-doc-index="${index}">
                <span>👁️</span> 预览此文档分块
              </button>
              <button class="ce-btn ce-btn-small ce-btn-secondary" data-action="suggest-chunks" data-doc-index="${index}">
                <span>💡</span> 智能建议分块位置
              </button>
              <button class="ce-btn ce-btn-small ce-btn-secondary" data-action="insert-delimiters" data-doc-index="${index}">
                <span>✂️</span> 插入分隔符
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 绑定文档编辑器事件
 * @param {HTMLElement} modal
 * @param {Object} collection
 * @param {Function} onSave
 */
function bindDocumentEditorEvents(modal, collection, onSave) {
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
  
  // 新建文档
  modal.querySelector('[data-action="add-document"]')?.addEventListener('click', () => {
    handleAddDocument(modal, collection);
  });
  
  // 导入文件
  modal.querySelector('[data-action="import-file"]')?.addEventListener('click', () => {
    handleImportFile(modal, collection);
  });
  
  // 预览分块
  modal.querySelector('[data-action="preview-chunking"]')?.addEventListener('click', () => {
    handlePreviewChunking(modal, collection);
  });
  
  // 保存
  modal.querySelector('[data-action="save"]')?.addEventListener('click', async () => {
    await handleSaveDocuments(modal, collection, onSave);
  });
  
  // 使用事件委托处理文档操作
  modal.querySelector('#ce-doc-list')?.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    
    const action = target.dataset.action;
    const docIndex = target.dataset.docIndex;
    
    if (action === 'toggle-doc') {
      handleToggleDocument(modal, docIndex);
    } else if (action === 'delete-doc') {
      handleDeleteDocument(modal, collection, docIndex);
    } else if (action === 'preview-doc-chunks') {
      handlePreviewDocChunks(modal, collection, docIndex);
    } else if (action === 'suggest-chunks') {
      handleSuggestChunks(modal, collection, docIndex);
    } else if (action === 'insert-delimiters') {
      handleInsertDelimiters(modal, collection, docIndex);
    }
  });
  
  // 初始渲染
  renderDocumentList(modal, collection);
}

/**
 * 切换文档展开/折叠
 * @param {HTMLElement} modal
 * @param {string} docIndex
 */
function handleToggleDocument(modal, docIndex) {
  const card = modal.querySelector(`[data-doc-index="${docIndex}"].ce-collapsible-card`);
  if (!card) return;
  
  const content = card.querySelector('.ce-collapsible-card-content');
  const toggle = card.querySelector('.ce-collapsible-toggle');
  
  if (content.style.display === 'none') {
    content.style.display = 'block';
    toggle.textContent = '▼';
  } else {
    content.style.display = 'none';
    toggle.textContent = '▶';
  }
}

/**
 * 添加新文档
 * @param {HTMLElement} modal
 * @param {Object} collection
 */
function handleAddDocument(modal, collection) {
  const title = prompt('请输入文档标题:');
  if (!title) return;
  
  const newDoc = {
    id: `doc_${Date.now()}`,
    title: title,
    content: '',
    metadata: {
      type: 'custom',
      tags: [],
      lastModified: new Date().toISOString(),
      wordCount: 0
    }
  };
  
  if (!collection.documents) {
    collection.documents = [];
  }
  collection.documents.push(newDoc);
  
  renderDocumentList(modal, collection);
}

/**
 * 删除文档
 * @param {HTMLElement} modal
 * @param {Object} collection
 * @param {string} docIndex
 */
function handleDeleteDocument(modal, collection, docIndex) {
  const index = parseInt(docIndex);
  if (isNaN(index) || index < 0 || index >= collection.documents.length) {
    return;
  }
  
  const doc = collection.documents[index];
  if (!confirm(`确定要删除文档"${doc.title || '未命名'}"吗？`)) {
    return;
  }
  
  collection.documents.splice(index, 1);
  renderDocumentList(modal, collection);
}

/**
 * 导入文件
 * @param {HTMLElement} modal
 * @param {Object} collection
 */
function handleImportFile(modal, collection) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt,.md,.json';
  input.multiple = true;
  
  input.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    for (const file of files) {
      try {
        const content = await readFileAsText(file);
        const doc = {
          id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          title: file.name.replace(/\.[^/.]+$/, ''),
          content: content,
          metadata: {
            type: 'imported',
            tags: [],
            lastModified: new Date().toISOString(),
            wordCount: content.length
          }
        };
        
        if (!collection.documents) {
          collection.documents = [];
        }
        collection.documents.push(doc);
      } catch (err) {
        console.error(`导入文件失败: ${file.name}`, err);
        alert(`导入文件失败: ${file.name}\n${err.message}`);
      }
    }
    
    renderDocumentList(modal, collection);
  });
  
  input.click();
}

/**
 * 读取文件为文本
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'UTF-8');
  });
}

/**
 * 保存文档
 * @param {HTMLElement} modal
 * @param {Object} collection
 * @param {Function} onSave
 */
async function handleSaveDocuments(modal, collection, onSave) {
  try {
    // 从UI收集文档数据
    const documents = collectDocumentsFromUI(modal, collection);
    collection.documents = documents;
    
    // 更新集合
    const charConfig = getConfigForCurrentCharacter();
    let loreConfig = charConfig.loreConfig;
    loreConfig = updateCollection(loreConfig, collection.id, collection);
    
    // 保存到角色卡
    const updatedConfig = { ...charConfig, loreConfig };
    await saveConfigForCurrentCharacter(updatedConfig);
    
    alert('文档已保存！');
    
    if (onSave) {
      onSave();
    }
    
    modal.remove();
  } catch (err) {
    console.error('[RAG DocumentEditor] 保存失败:', err);
    alert(`保存失败: ${err.message}`);
  }
}

/**
 * 从UI收集文档数据
 * @param {HTMLElement} modal
 * @param {Object} collection
 * @returns {Array}
 */
function collectDocumentsFromUI(modal, collection) {
  const documents = [];
  const cards = modal.querySelectorAll('.ce-collapsible-card[data-doc-index]');
  
  cards.forEach((card, index) => {
    const titleInput = card.querySelector('[data-doc-field="title"]');
    const tagsInput = card.querySelector('[data-doc-field="tags"]');
    const contentInput = card.querySelector('[data-doc-field="content"]');
    
    const title = titleInput?.value.trim() || `文档 ${index + 1}`;
    const tagsStr = tagsInput?.value.trim() || '';
    const content = contentInput?.value || '';
    const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(t => t) : [];
    
    // 获取原始文档ID，如果存在的话
    const originalDoc = collection.documents[index];
    const docId = originalDoc?.id || `doc_${Date.now()}_${index}`;
    
    documents.push({
      id: docId,
      title: title,
      content: content,
      metadata: {
        type: originalDoc?.metadata?.type || 'custom',
        tags: tags,
        lastModified: new Date().toISOString(),
        wordCount: content.length
      }
    });
  });
  
  return documents;
}

/**
 * 处理预览分块（所有文档）
 * @param {HTMLElement} modal
 * @param {Object} collection
 */
async function handlePreviewChunking(modal, collection) {
  const charConfig = getConfigForCurrentCharacter();
  const loreConfig = charConfig.loreConfig;
  const chunkConfig = collection.chunkConfig || loreConfig.collections?.[0]?.chunkConfig || {
    strategy: 'fixed',
    fixed: { chunkSize: 512, overlap: 50 }
  };
  
  // 收集所有文档内容
  const documents = collectDocumentsFromUI(modal, collection);
  
  if (documents.length === 0) {
    alert('没有文档可预览');
    return;
  }
  
  // 创建预览模态窗口
  const previewModal = createChunkPreviewModal(documents, chunkConfig);
  document.body.appendChild(previewModal);
}

/**
 * 处理预览单个文档分块
 * @param {HTMLElement} modal
 * @param {Object} collection
 * @param {string} docIndex
 */
async function handlePreviewDocChunks(modal, collection, docIndex) {
  const index = parseInt(docIndex);
  const card = modal.querySelector(`[data-doc-index="${index}"]`);
  if (!card) return;
  
  const contentInput = card.querySelector('[data-doc-field="content"]');
  const content = contentInput?.value || '';
  
  if (!content.trim()) {
    alert('文档内容为空');
    return;
  }
  
  const charConfig = getConfigForCurrentCharacter();
  const loreConfig = charConfig.loreConfig;
  const chunkConfig = collection.chunkConfig || loreConfig.collections?.[0]?.chunkConfig || {
    strategy: 'fixed',
    fixed: { chunkSize: 512, overlap: 50 }
  };
  
  // 预览分块
  const preview = previewChunking(content, chunkConfig);
  
  // 显示预览结果
  const previewModal = createSingleDocChunkPreviewModal(preview, chunkConfig);
  document.body.appendChild(previewModal);
}

/**
 * 处理智能建议分块位置
 * @param {HTMLElement} modal
 * @param {Object} collection
 * @param {string} docIndex
 */
async function handleSuggestChunks(modal, collection, docIndex) {
  const index = parseInt(docIndex);
  const card = modal.querySelector(`[data-doc-index="${index}"]`);
  if (!card) return;
  
  const contentInput = card.querySelector('[data-doc-field="content"]');
  const content = contentInput?.value || '';
  
  if (!content.trim()) {
    alert('文档内容为空');
    return;
  }
  
  // 获取建议的分块位置
  const suggestions = suggestChunkPositions(content);
  
  if (suggestions.length === 0) {
    alert('未找到合适的分块位置');
    return;
  }
  
  // 显示建议
  const suggestionModal = createChunkSuggestionModal(suggestions, content, (selectedPositions) => {
    // 用户选择后的回调
    if (selectedPositions.length > 0) {
      const delimiter = '---CHUNK---';
      const newContent = insertDelimitersAtPositions(content, selectedPositions, delimiter);
      contentInput.value = newContent;
      alert(`已在 ${selectedPositions.length} 个位置插入分隔符`);
    }
  });
  document.body.appendChild(suggestionModal);
}

/**
 * 处理插入分隔符
 * @param {HTMLElement} modal
 * @param {Object} collection
 * @param {string} docIndex
 */
async function handleInsertDelimiters(modal, collection, docIndex) {
  const index = parseInt(docIndex);
  const card = modal.querySelector(`[data-doc-index="${index}"]`);
  if (!card) return;
  
  const contentInput = card.querySelector('[data-doc-field="content"]');
  const content = contentInput?.value || '';
  
  if (!content.trim()) {
    alert('文档内容为空');
    return;
  }
  
  const delimiter = prompt('请输入分隔符:', '---CHUNK---');
  if (!delimiter) return;
  
  // 获取光标位置或在末尾插入
  const cursorPos = contentInput.selectionStart || content.length;
  const newContent = content.substring(0, cursorPos) + '\n' + delimiter + '\n' + content.substring(cursorPos);
  contentInput.value = newContent;
  
  alert('分隔符已插入');
}

/**
 * 创建分块预览模态窗口
 * @param {Array} documents
 * @param {Object} chunkConfig
 * @returns {HTMLElement}
 */
function createChunkPreviewModal(documents, chunkConfig) {
  const backdrop = document.createElement('div');
  backdrop.className = 'ce-modal-backdrop';
  backdrop.style.display = 'flex';
  backdrop.style.zIndex = '10001';
  
  let totalChunks = 0;
  let totalChars = 0;
  const docPreviews = documents.map(doc => {
    const preview = previewChunking(doc.content, chunkConfig);
    totalChunks += preview.chunkCount;
    totalChars += preview.totalChars;
    return { doc, preview };
  });
  
  backdrop.innerHTML = `
    <div class="ce-modal ce-modal-large">
      <div class="ce-modal-header">
        <div class="ce-modal-title">
          <span>👁️</span>
          <span>分块预览</span>
        </div>
        <button class="ce-modal-close" data-action="close-preview">&times;</button>
      </div>
      
      <div class="ce-modal-body">
        <div style="margin-bottom: 15px; padding: 12px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 6px;">
          <div style="font-weight: 500; margin-bottom: 8px;">分块策略: ${getStrategyName(chunkConfig.strategy)}</div>
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; font-size: 0.9em;">
            <div>总文档数: <strong>${documents.length}</strong></div>
            <div>总片段数: <strong>${totalChunks}</strong></div>
            <div>总字符数: <strong>${totalChars}</strong></div>
            <div>平均片段大小: <strong>${totalChunks > 0 ? Math.round(totalChars / totalChunks) : 0}</strong> 字符</div>
          </div>
        </div>
        
        <div style="max-height: 500px; overflow-y: auto;">
          ${docPreviews.map(({ doc, preview }) => `
            <div style="margin-bottom: 15px; padding: 12px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 6px;">
              <div style="font-weight: 500; margin-bottom: 8px;">${doc.title}</div>
              <div style="font-size: 0.9em; color: var(--SmartThemeQuoteColor, #999); margin-bottom: 8px;">
                ${preview.chunkCount} 个片段 | ${preview.totalChars} 字符 |
                平均 ${preview.avgChunkLength} 字符/片段 |
                范围 ${preview.minChunkLength}-${preview.maxChunkLength} 字符
              </div>
              ${preview.warningCount > 0 ? `
                <div style="padding: 8px; background: var(--orange, #ff9800)22; border: 1px solid var(--orange, #ff9800); border-radius: 4px; font-size: 0.85em; margin-bottom: 8px;">
                  <strong>⚠ ${preview.warningCount} 个警告</strong>
                </div>
              ` : ''}
              <div style="font-size: 0.85em;">
                <div style="font-weight: 500; margin-bottom: 4px;">前3个片段预览:</div>
                ${preview.preview.map((chunk, i) => `
                  <div style="margin-bottom: 6px; padding: 6px; background: var(--black50a, rgba(0,0,0,0.5)); border-radius: 4px;">
                    <div style="color: var(--SmartThemeQuoteColor, #999); margin-bottom: 2px;">
                      片段 ${i + 1} (${chunk.length} 字符)
                      ${chunk.warnings ? `<span style="color: var(--orange, #ff9800);"> ⚠ ${chunk.warnings.join(', ')}</span>` : ''}
                    </div>
                    <div style="font-family: monospace; white-space: pre-wrap;">${chunk.text}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <div class="ce-modal-footer">
        <button class="ce-btn ce-btn-secondary" data-action="close-preview">关闭</button>
      </div>
    </div>
  `;
  
  backdrop.querySelector('[data-action="close-preview"]')?.addEventListener('click', () => {
    backdrop.remove();
  });
  
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      backdrop.remove();
    }
  });
  
  return backdrop;
}

/**
 * 创建单文档分块预览模态窗口
 * @param {Object} preview
 * @param {Object} chunkConfig
 * @returns {HTMLElement}
 */
function createSingleDocChunkPreviewModal(preview, chunkConfig) {
  const backdrop = document.createElement('div');
  backdrop.className = 'ce-modal-backdrop';
  backdrop.style.display = 'flex';
  backdrop.style.zIndex = '10001';
  
  backdrop.innerHTML = `
    <div class="ce-modal">
      <div class="ce-modal-header">
        <div class="ce-modal-title">
          <span>👁️</span>
          <span>文档分块预览</span>
        </div>
        <button class="ce-modal-close" data-action="close-preview">&times;</button>
      </div>
      
      <div class="ce-modal-body">
        <div style="margin-bottom: 15px; padding: 12px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 6px;">
          <div style="font-weight: 500; margin-bottom: 8px;">分块策略: ${getStrategyName(chunkConfig.strategy)}</div>
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; font-size: 0.9em;">
            <div>片段数: <strong>${preview.chunkCount}</strong></div>
            <div>总字符: <strong>${preview.totalChars}</strong></div>
            <div>平均大小: <strong>${preview.avgChunkLength}</strong></div>
            <div>范围: <strong>${preview.minChunkLength}-${preview.maxChunkLength}</strong></div>
          </div>
          ${preview.warningCount > 0 ? `
            <div style="margin-top: 8px; padding: 8px; background: var(--orange, #ff9800)22; border: 1px solid var(--orange, #ff9800); border-radius: 4px; font-size: 0.85em;">
              <strong>⚠ ${preview.warningCount} 个警告</strong>
            </div>
          ` : ''}
        </div>
        
        <div style="font-size: 0.85em;">
          <div style="font-weight: 500; margin-bottom: 8px;">前3个片段预览:</div>
          ${preview.preview.map((chunk, i) => `
            <div style="margin-bottom: 8px; padding: 8px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 4px;">
              <div style="color: var(--SmartThemeQuoteColor, #999); margin-bottom: 4px;">
                片段 ${i + 1} (${chunk.length} 字符)
                ${chunk.warnings ? `<span style="color: var(--orange, #ff9800);"> ⚠ ${chunk.warnings.join(', ')}</span>` : ''}
              </div>
              <div style="font-family: monospace; white-space: pre-wrap; max-height: 150px; overflow-y: auto;">${chunk.text}</div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <div class="ce-modal-footer">
        <button class="ce-btn ce-btn-secondary" data-action="close-preview">关闭</button>
      </div>
    </div>
  `;
  
  backdrop.querySelector('[data-action="close-preview"]')?.addEventListener('click', () => {
    backdrop.remove();
  });
  
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      backdrop.remove();
    }
  });
  
  return backdrop;
}

/**
 * 创建分块建议模态窗口
 * @param {Array} suggestions
 * @param {string} content
 * @param {Function} onConfirm
 * @returns {HTMLElement}
 */
function createChunkSuggestionModal(suggestions, content, onConfirm) {
  const backdrop = document.createElement('div');
  backdrop.className = 'ce-modal-backdrop';
  backdrop.style.display = 'flex';
  backdrop.style.zIndex = '10001';
  
  backdrop.innerHTML = `
    <div class="ce-modal">
      <div class="ce-modal-header">
        <div class="ce-modal-title">
          <span>💡</span>
          <span>智能分块建议</span>
        </div>
        <button class="ce-modal-close" data-action="close-suggestion">&times;</button>
      </div>
      
      <div class="ce-modal-body">
        <div style="margin-bottom: 15px; font-size: 0.9em; color: var(--SmartThemeQuoteColor, #999);">
          找到 ${suggestions.length} 个建议的分块位置，请选择要插入分隔符的位置：
        </div>
        
        <div style="max-height: 400px; overflow-y: auto;">
          ${suggestions.map((sug, i) => `
            <div style="margin-bottom: 8px; padding: 8px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 4px;">
              <label style="display: flex; align-items: start; gap: 8px; cursor: pointer;">
                <input type="checkbox" class="chunk-suggestion-checkbox" data-position="${sug.position}" checked style="margin-top: 4px;">
                <div style="flex: 1;">
                  <div style="font-weight: 500; margin-bottom: 4px;">
                    第 ${sug.line} 行 - ${sug.type} (置信度: ${Math.round(sug.confidence * 100)}%)
                  </div>
                  <div style="font-size: 0.85em; color: var(--SmartThemeQuoteColor, #999); margin-bottom: 4px;">
                    ${sug.reason}
                  </div>
                  <div style="font-family: monospace; font-size: 0.8em; padding: 4px; background: var(--black50a, rgba(0,0,0,0.5)); border-radius: 2px;">
                    ${sug.preview}
                  </div>
                </div>
              </label>
            </div>
          `).join('')}
        </div>
      </div>
      
      <div class="ce-modal-footer">
        <button class="ce-btn" data-action="confirm-suggestions">插入选中的分隔符</button>
        <button class="ce-btn ce-btn-secondary" data-action="close-suggestion">取消</button>
      </div>
    </div>
  `;
  
  backdrop.querySelector('[data-action="close-suggestion"]')?.addEventListener('click', () => {
    backdrop.remove();
  });
  
  backdrop.querySelector('[data-action="confirm-suggestions"]')?.addEventListener('click', () => {
    const checkboxes = backdrop.querySelectorAll('.chunk-suggestion-checkbox:checked');
    const selectedPositions = Array.from(checkboxes).map(cb => parseInt(cb.dataset.position));
    backdrop.remove();
    onConfirm(selectedPositions);
  });
  
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      backdrop.remove();
    }
  });
  
  return backdrop;
}

/**
 * 获取策略名称
 * @param {string} strategy
 * @returns {string}
 */
function getStrategyName(strategy) {
  const names = {
    fixed: '固定长度分块',
    semantic: '语义分块',
    sentence: '句子分块',
    custom: '自定义分块'
  };
  return names[strategy] || strategy;
}