// 检索测试工具UI
// 用于测试RAG混合检索功能

import { loadLoreConfig, getLoreCollections } from '../integration/lore-storage.js';
import { getConfigForCurrentCharacter } from '../../integration/card-storage.js';
import { retrieveWorldContext } from '../integration/rag-retriever.js';

/**
 * 打开检索测试工具
 */
export function openRetrievalTester() {
  console.log('[RAG RetrievalTester] 打开检索测试工具');
  
  // 创建模态窗口
  const modal = createRetrievalTesterModal();
  document.body.appendChild(modal);
  
  // 加载数据
  loadRetrievalTesterData(modal);
  
  // 绑定事件
  bindRetrievalTesterEvents(modal);
}

/**
 * 创建检索测试工具模态窗口
 * @returns {HTMLElement}
 */
function createRetrievalTesterModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'ce-modal-backdrop';
  backdrop.setAttribute('data-ce-retrieval-tester', '');
  backdrop.style.display = 'flex';
  
  backdrop.innerHTML = `
    <div class="ce-modal ce-modal-large">
      <div class="ce-modal-header">
        <div class="ce-modal-title">
          <span>🔍</span>
          <span>RAG 检索测试器</span>
        </div>
        <button class="ce-modal-close" data-action="close" title="关闭">&times;</button>
      </div>
      
      <div class="ce-modal-body">
        <!-- 查询输入区域 -->
        <div class="ce-section-header">
          <span>测试查询</span>
        </div>
        <div style="margin-top: 10px;">
          <div class="ce-form-row">
            <label>
              <span class="ce-form-label">查询文本:</span>
              <textarea id="ce-test-query" rows="3" placeholder="输入要测试的查询文本，例如：龙门城市的治安条例"></textarea>
            </label>
          </div>
        </div>
        
        <!-- 检索配置区域 -->
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--SmartThemeBorderColor, #444);">
          <div class="ce-section-header">
            <span>检索配置</span>
            <button class="ce-btn ce-btn-small ce-btn-secondary" data-action="sync-config">
              <span>🔄</span> 同步设定管理器配置
            </button>
          </div>
          
          <!-- 检索模式选择 -->
          <div style="margin-top: 10px;">
            <label style="display: block; margin-bottom: 6px; font-weight: 500;">检索模式:</label>
            <select id="ce-test-mode" style="width: 100%; padding: 8px; background: var(--black50a, rgba(0,0,0,0.5)); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 4px; color: var(--SmartThemeBodyColor, #ddd);">
              <option value="hybrid">混合检索 (向量+关键字)</option>
              <option value="vector_only">仅向量检索</option>
              <option value="keyword_only">仅关键字检索</option>
            </select>
          </div>
          
          <!-- 向量检索配置 -->
          <div id="ce-test-vector-config" style="margin-top: 15px; padding: 12px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 6px;">
            <div style="font-weight: 500; margin-bottom: 10px; color: var(--SmartThemeBlurTintColor, #4a9eff);">向量检索配置</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div class="ce-form-row-horizontal">
                <label>
                  <span class="ce-form-label">TopK:</span>
                  <input type="number" id="ce-test-vector-topk" min="1" max="20" value="10">
                </label>
              </div>
              <div class="ce-form-row-horizontal">
                <label>
                  <span class="ce-form-label">相似度阈值:</span>
                  <input type="number" id="ce-test-vector-threshold" min="0" max="1" step="0.05" value="0.6">
                </label>
              </div>
            </div>
          </div>
          
          <!-- 关键字检索配置 -->
          <div id="ce-test-keyword-config" style="margin-top: 15px; padding: 12px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 6px;">
            <div style="font-weight: 500; margin-bottom: 10px; color: var(--green, #4caf50);">关键字检索配置</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
              <div class="ce-form-row-horizontal">
                <label>
                  <span class="ce-form-label">TopK:</span>
                  <input type="number" id="ce-test-keyword-topk" min="1" max="20" value="10">
                </label>
              </div>
              <div class="ce-form-row-horizontal">
                <label>
                  <span class="ce-form-label">算法:</span>
                  <select id="ce-test-keyword-algorithm" style="width: 100%; padding: 6px; background: var(--black50a, rgba(0,0,0,0.5)); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 4px; color: var(--SmartThemeBodyColor, #ddd);">
                    <option value="bm25">BM25</option>
                    <option value="tfidf">TF-IDF</option>
                  </select>
                </label>
              </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div class="ce-form-row-horizontal">
                <label>
                  <span class="ce-form-label">BM25 k1:</span>
                  <input type="number" id="ce-test-bm25-k1" min="0.5" max="3" step="0.1" value="1.5">
                </label>
              </div>
              <div class="ce-form-row-horizontal">
                <label>
                  <span class="ce-form-label">BM25 b:</span>
                  <input type="number" id="ce-test-bm25-b" min="0" max="1" step="0.05" value="0.75">
                </label>
              </div>
            </div>
          </div>
          
          <!-- 融合策略配置 -->
          <div id="ce-test-fusion-config" style="margin-top: 15px; padding: 12px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 6px;">
            <div style="font-weight: 500; margin-bottom: 10px; color: var(--orange, #ff9800);">融合策略</div>
            <div style="margin-bottom: 10px;">
              <label style="display: block; margin-bottom: 6px;">融合方法:</label>
              <select id="ce-test-fusion-method" style="width: 100%; padding: 8px; background: var(--black50a, rgba(0,0,0,0.5)); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 4px; color: var(--SmartThemeBodyColor, #ddd);">
                <option value="rrf">RRF - 基于排名融合</option>
                <option value="weighted">加权融合</option>
                <option value="cascade">级联策略</option>
              </select>
            </div>
            <div id="ce-test-fusion-params" style="font-size: 0.9em; color: var(--SmartThemeQuoteColor, #999);">
              <!-- 融合参数将在这里显示 -->
            </div>
          </div>
          
          <!-- 最终输出配置 -->
          <div style="margin-top: 15px; padding: 12px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 6px;">
            <div style="font-weight: 500; margin-bottom: 10px;">最终输出配置</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div class="ce-form-row-horizontal">
                <label>
                  <span class="ce-form-label">最终TopK:</span>
                  <input type="number" id="ce-test-final-topk" min="1" max="20" value="5">
                </label>
              </div>
              <div class="ce-form-row-horizontal">
                <label>
                  <span class="ce-form-label">Token预算:</span>
                  <input type="number" id="ce-test-token-budget" min="500" max="4000" step="100" value="2000">
                </label>
              </div>
            </div>
          </div>
        </div>
        
        <!-- 集合选择区域 -->
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--SmartThemeBorderColor, #444);">
          <div class="ce-section-header">
            <span>选择集合</span>
            <button class="ce-btn ce-btn-small ce-btn-secondary" data-action="select-all-collections">全选</button>
          </div>
          <div id="ce-test-collections" style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">
            <div style="text-align: center; padding: 20px; color: var(--SmartThemeQuoteColor, #999);">
              加载中...
            </div>
          </div>
        </div>
        
        <!-- 操作按钮 -->
        <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: center;">
          <button class="ce-btn" data-action="test-retrieval">
            <span>🔍</span> 开始检索
          </button>
          <button class="ce-btn ce-btn-secondary" data-action="clear-results">
            <span>🗑️</span> 清除结果
          </button>
        </div>
        
        <!-- 结果展示区域 -->
        <div id="ce-test-results-container" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--SmartThemeBorderColor, #444); display: none;">
          <div class="ce-section-header">
            <span>检索结果</span>
            <span id="ce-test-stats" style="font-size: 0.9em; color: var(--SmartThemeQuoteColor, #999);"></span>
          </div>
          
          <!-- 混合检索详细结果 -->
          <div id="ce-test-hybrid-details" style="display: none; margin-top: 15px;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; margin-bottom: 20px;">
              <!-- 向量检索结果 -->
              <div style="padding: 12px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 6px;">
                <div style="font-weight: 500; margin-bottom: 8px; color: var(--SmartThemeBlurTintColor, #4a9eff);">
                  🔵 向量检索结果
                </div>
                <div id="ce-test-vector-results" style="font-size: 0.9em; color: var(--SmartThemeQuoteColor, #999);">
                  <!-- 向量检索结果列表 -->
                </div>
              </div>
              
              <!-- 关键字检索结果 -->
              <div style="padding: 12px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 6px;">
                <div style="font-weight: 500; margin-bottom: 8px; color: var(--green, #4caf50);">
                  🟢 关键字检索结果
                </div>
                <div id="ce-test-keyword-results" style="font-size: 0.9em; color: var(--SmartThemeQuoteColor, #999);">
                  <!-- 关键字检索结果列表 -->
                </div>
              </div>
              
              <!-- 融合策略信息 -->
              <div style="padding: 12px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 6px;">
                <div style="font-weight: 500; margin-bottom: 8px; color: var(--orange, #ff9800);">
                  🟠 融合策略
                </div>
                <div id="ce-test-fusion-info" style="font-size: 0.9em; color: var(--SmartThemeQuoteColor, #999);">
                  <!-- 融合策略信息 -->
                </div>
              </div>
            </div>
          </div>
          
          <div id="ce-test-results" style="margin-top: 10px;">
            <!-- 最终结果将在这里显示 -->
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
 * 加载检索测试器数据
 * @param {HTMLElement} modal
 */
function loadRetrievalTesterData(modal) {
  const charConfig = getConfigForCurrentCharacter();
  const loreConfig = loadLoreConfig(charConfig);
  
  // 加载集合列表
  renderCollectionCheckboxes(modal, loreConfig);
  
  // 加载完整的检索配置
  loadFullRetrievalConfig(modal, loreConfig);
}

/**
 * 加载完整的检索配置
 * @param {HTMLElement} modal
 * @param {Object} loreConfig
 */
function loadFullRetrievalConfig(modal, loreConfig) {
  const config = loreConfig.retrievalConfig || {};
  
  // 检索模式
  const modeSelect = modal.querySelector('#ce-test-mode');
  if (modeSelect) modeSelect.value = config.mode || 'hybrid';
  
  // 向量检索配置
  const vectorTopKInput = modal.querySelector('#ce-test-vector-topk');
  const vectorThresholdInput = modal.querySelector('#ce-test-vector-threshold');
  if (vectorTopKInput) vectorTopKInput.value = config.vectorSearch?.topK || 10;
  if (vectorThresholdInput) vectorThresholdInput.value = config.vectorSearch?.similarityThreshold || 0.6;
  
  // 关键字检索配置
  const keywordTopKInput = modal.querySelector('#ce-test-keyword-topk');
  const keywordAlgorithmSelect = modal.querySelector('#ce-test-keyword-algorithm');
  const bm25K1Input = modal.querySelector('#ce-test-bm25-k1');
  const bm25BInput = modal.querySelector('#ce-test-bm25-b');
  if (keywordTopKInput) keywordTopKInput.value = config.keywordSearch?.topK || 10;
  if (keywordAlgorithmSelect) keywordAlgorithmSelect.value = config.keywordSearch?.algorithm || 'bm25';
  if (bm25K1Input) bm25K1Input.value = config.keywordSearch?.bm25?.k1 || 1.5;
  if (bm25BInput) bm25BInput.value = config.keywordSearch?.bm25?.b || 0.75;
  
  // 融合策略配置
  const fusionMethodSelect = modal.querySelector('#ce-test-fusion-method');
  if (fusionMethodSelect) fusionMethodSelect.value = config.fusion?.method || 'rrf';
  
  // 更新融合参数显示
  updateFusionParamsDisplay(modal, config.fusion);
  
  // 最终输出配置
  const finalTopKInput = modal.querySelector('#ce-test-final-topk');
  const tokenBudgetInput = modal.querySelector('#ce-test-token-budget');
  if (finalTopKInput) finalTopKInput.value = config.finalTopK || 5;
  if (tokenBudgetInput) tokenBudgetInput.value = config.tokenBudget || 2000;
  
  // 更新配置区域可见性
  updateTestConfigVisibility(modal);
}

/**
 * 更新融合参数显示
 * @param {HTMLElement} modal
 * @param {Object} fusionConfig
 */
function updateFusionParamsDisplay(modal, fusionConfig = {}) {
  const paramsDiv = modal.querySelector('#ce-test-fusion-params');
  if (!paramsDiv) return;
  
  const method = fusionConfig.method || 'rrf';
  
  let paramsHTML = '';
  if (method === 'rrf') {
    const k = fusionConfig.rrf?.k || 60;
    paramsHTML = `<div>RRF k常数: ${k}</div>`;
  } else if (method === 'weighted') {
    const vectorWeight = fusionConfig.weighted?.vectorWeight || 0.6;
    const keywordWeight = fusionConfig.weighted?.keywordWeight || 0.4;
    paramsHTML = `
      <div>向量权重: ${vectorWeight}</div>
      <div>关键字权重: ${keywordWeight}</div>
    `;
  } else if (method === 'cascade') {
    const primary = fusionConfig.cascade?.primaryMethod || 'keyword';
    const minResults = fusionConfig.cascade?.minPrimaryResults || 3;
    paramsHTML = `
      <div>主方法: ${primary === 'keyword' ? '关键字' : '向量'}</div>
      <div>最小结果数: ${minResults}</div>
    `;
  }
  
  paramsDiv.innerHTML = paramsHTML;
}

/**
 * 更新测试配置区域的可见性
 * @param {HTMLElement} modal
 */
function updateTestConfigVisibility(modal) {
  const mode = modal.querySelector('#ce-test-mode')?.value || 'hybrid';
  
  const vectorConfig = modal.querySelector('#ce-test-vector-config');
  const keywordConfig = modal.querySelector('#ce-test-keyword-config');
  const fusionConfig = modal.querySelector('#ce-test-fusion-config');
  
  if (mode === 'hybrid') {
    if (vectorConfig) vectorConfig.style.display = 'block';
    if (keywordConfig) keywordConfig.style.display = 'block';
    if (fusionConfig) fusionConfig.style.display = 'block';
  } else if (mode === 'vector_only') {
    if (vectorConfig) vectorConfig.style.display = 'block';
    if (keywordConfig) keywordConfig.style.display = 'none';
    if (fusionConfig) fusionConfig.style.display = 'none';
  } else if (mode === 'keyword_only') {
    if (vectorConfig) vectorConfig.style.display = 'none';
    if (keywordConfig) keywordConfig.style.display = 'block';
    if (fusionConfig) fusionConfig.style.display = 'none';
  }
}

/**
 * 渲染集合复选框列表
 * @param {HTMLElement} modal
 * @param {Object} loreConfig
 */
function renderCollectionCheckboxes(modal, loreConfig) {
  const container = modal.querySelector('#ce-test-collections');
  const collections = getLoreCollections(loreConfig);
  
  if (collections.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--SmartThemeQuoteColor, #999); font-style: italic;">
        暂无可用的集合，请先在世界观设定管理器中创建集合
      </div>
    `;
    return;
  }
  
  container.innerHTML = collections.map(collection => {
    const isVectorized = collection.vectorStore && collection.vectorStore.chunks && collection.vectorStore.chunks.length > 0;
    const chunkCount = isVectorized ? collection.vectorStore.chunks.length : 0;
    const statusBadge = isVectorized 
      ? `<span class="ce-collapsible-badge" style="background: var(--green, #4caf50);">${chunkCount} 个片段</span>`
      : `<span class="ce-collapsible-badge" style="background: var(--orange, #ff9800);">未向量化</span>`;
    
    return `
      <label style="display: flex; align-items: center; gap: 10px; padding: 10px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 6px; cursor: pointer;">
        <input type="checkbox" class="ce-collection-checkbox" data-collection-id="${collection.id}" ${isVectorized ? 'checked' : 'disabled'}>
        <span style="flex: 1;">${collection.name || collection.id}</span>
        ${statusBadge}
      </label>
    `;
  }).join('');
}

/**
 * 绑定事件
 * @param {HTMLElement} modal
 */
function bindRetrievalTesterEvents(modal) {
  // 同步配置按钮
  modal.querySelector('[data-action="sync-config"]')?.addEventListener('click', () => {
    const charConfig = getConfigForCurrentCharacter();
    const loreConfig = loadLoreConfig(charConfig);
    loadFullRetrievalConfig(modal, loreConfig);
    showAlert('已同步设定管理器的配置！');
  });
  
  // 检索模式切换
  modal.querySelector('#ce-test-mode')?.addEventListener('change', () => {
    updateTestConfigVisibility(modal);
  });
  
  // 融合方法切换
  modal.querySelector('#ce-test-fusion-method')?.addEventListener('change', () => {
    const charConfig = getConfigForCurrentCharacter();
    const loreConfig = loadLoreConfig(charConfig);
    updateFusionParamsDisplay(modal, loreConfig.retrievalConfig?.fusion);
  });
  
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
  
  // 全选集合
  modal.querySelector('[data-action="select-all-collections"]')?.addEventListener('click', () => {
    const checkboxes = modal.querySelectorAll('.ce-collection-checkbox:not(:disabled)');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
  });
  
  // 开始检索
  modal.querySelector('[data-action="test-retrieval"]')?.addEventListener('click', () => {
    handleTestRetrieval(modal);
  });
  
  // 清除结果
  modal.querySelector('[data-action="clear-results"]')?.addEventListener('click', () => {
    const resultsContainer = modal.querySelector('#ce-test-results-container');
    const resultsDiv = modal.querySelector('#ce-test-results');
    if (resultsContainer) resultsContainer.style.display = 'none';
    if (resultsDiv) resultsDiv.innerHTML = '';
  });
}

/**
 * 处理测试检索
 * @param {HTMLElement} modal
 */
async function handleTestRetrieval(modal) {
  const queryInput = modal.querySelector('#ce-test-query');
  const queryText = queryInput?.value.trim();
  
  if (!queryText) {
    showAlert('请输入查询文本');
    return;
  }
  
  // 获取选中的集合
  const selectedCollections = Array.from(modal.querySelectorAll('.ce-collection-checkbox:checked'))
    .map(cb => cb.dataset.collectionId);
  
  if (selectedCollections.length === 0) {
    showAlert('请至少选择一个已向量化的集合');
    return;
  }
  
  // 获取检索配置
  const mode = modal.querySelector('#ce-test-mode')?.value || 'hybrid';
  const finalTopK = parseInt(modal.querySelector('#ce-test-final-topk')?.value || '5');
  const tokenBudget = parseInt(modal.querySelector('#ce-test-token-budget')?.value || '2000');
  
  // 显示加载状态
  const resultsContainer = modal.querySelector('#ce-test-results-container');
  const resultsDiv = modal.querySelector('#ce-test-results');
  const hybridDetails = modal.querySelector('#ce-test-hybrid-details');
  
  if (resultsContainer) resultsContainer.style.display = 'block';
  if (hybridDetails) hybridDetails.style.display = 'none';
  if (resultsDiv) {
    resultsDiv.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--SmartThemeQuoteColor, #999);">
        <div style="margin-bottom: 10px;">🔍 正在检索...</div>
        <div style="font-size: 0.9em;">使用${mode === 'hybrid' ? '混合检索' : mode === 'vector_only' ? '向量检索' : '关键字检索'}模式</div>
      </div>
    `;
  }
  
  try {
    // 加载配置
    const charConfig = getConfigForCurrentCharacter();
    const loreConfig = loadLoreConfig(charConfig);
    
    // 构造查询意图
    const worldContextIntent = {
      queries: [{
        query: queryText,
        collections: selectedCollections,
        importance: 'must_have'
      }]
    };
    
    // 使用统一的检索接口
    const result = await retrieveWorldContext(worldContextIntent, loreConfig);
    
    // 显示结果
    displayHybridRetrievalResults(modal, result, queryText, mode);
    
  } catch (err) {
    console.error('[RAG RetrievalTester] 检索失败:', err);
    if (resultsDiv) {
      resultsDiv.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--red, #f44336);">
          <div style="margin-bottom: 10px;">❌ 检索失败</div>
          <div style="font-size: 0.9em;">${err.message}</div>
        </div>
      `;
    }
  }
}

/**
 * 显示混合检索结果
 * @param {HTMLElement} modal
 * @param {Object} result - 检索结果对象
 * @param {string} queryText
 * @param {string} mode - 检索模式
 */
function displayHybridRetrievalResults(modal, result, queryText, mode) {
  const resultsDiv = modal.querySelector('#ce-test-results');
  const statsDiv = modal.querySelector('#ce-test-stats');
  const hybridDetails = modal.querySelector('#ce-test-hybrid-details');
  const vectorResultsDiv = modal.querySelector('#ce-test-vector-results');
  const keywordResultsDiv = modal.querySelector('#ce-test-keyword-results');
  const fusionInfoDiv = modal.querySelector('#ce-test-fusion-info');
  
  if (!resultsDiv) return;
  
  // ⭐ 修复：使用正确的字段名
  const finalResults = result.results || [];
  const stats = result.stats || {};
  
  // 更新统计信息
  if (statsDiv) {
    const totalTokens = stats.totalTokens || 0;
    const avgSimilarity = stats.avgSimilarity || 0;
    const avgScore = (avgSimilarity * 100).toFixed(1);
    
    statsDiv.innerHTML = `共 ${finalResults.length} 个结果 | 约 ${totalTokens} tokens | 平均相似度 ${avgScore}%`;
  }
  
  // 显示混合检索详细信息
  if (mode === 'hybrid' && hybridDetails && stats.vectorResults && stats.keywordResults) {
    hybridDetails.style.display = 'block';
    
    // 向量检索结果
    if (vectorResultsDiv) {
      const vectorResults = stats.vectorResults.slice(0, 5);
      vectorResultsDiv.innerHTML = vectorResults.length > 0
        ? vectorResults.map((r, i) => {
            const chunkId = r.chunk?.id || 'unknown';
            const docTitle = r.chunk?.metadata?.docTitle || '未知文档';
            return `
              <div style="padding: 6px; margin-bottom: 4px; background: var(--black50a, rgba(0,0,0,0.5)); border-radius: 3px;">
                #${i + 1}: ${docTitle} (${(r.similarity * 100).toFixed(1)}%)
              </div>
            `;
          }).join('')
        : '<div style="color: var(--SmartThemeQuoteColor, #999);">无结果</div>';
    }
    
    // 关键字检索结果
    if (keywordResultsDiv) {
      const keywordResults = stats.keywordResults.slice(0, 5);
      keywordResultsDiv.innerHTML = keywordResults.length > 0
        ? keywordResults.map((r, i) => {
            const chunkId = r.chunk?.id || 'unknown';
            const docTitle = r.chunk?.metadata?.docTitle || '未知文档';
            const score = r.bm25Score || r.keywordScore || 0;
            return `
              <div style="padding: 6px; margin-bottom: 4px; background: var(--black50a, rgba(0,0,0,0.5)); border-radius: 3px;">
                #${i + 1}: ${docTitle} (BM25: ${score.toFixed(2)})
              </div>
            `;
          }).join('')
        : '<div style="color: var(--SmartThemeQuoteColor, #999);">无结果</div>';
    }
    
    // 融合策略信息
    if (fusionInfoDiv) {
      const fusionMethod = stats.fusionMethod || 'unknown';
      const fusionMethodNames = {
        rrf: 'RRF (Reciprocal Rank Fusion)',
        weighted: '加权融合',
        cascade: '级联策略'
      };
      
      fusionInfoDiv.innerHTML = `
        <div style="margin-bottom: 8px;"><strong>方法:</strong> ${fusionMethodNames[fusionMethod] || fusionMethod}</div>
        <div style="margin-bottom: 8px;"><strong>向量结果:</strong> ${stats.vectorResults?.length || 0} 个</div>
        <div style="margin-bottom: 8px;"><strong>关键字结果:</strong> ${stats.keywordResults?.length || 0} 个</div>
        <div><strong>融合后:</strong> ${finalResults.length} 个</div>
      `;
    }
  } else {
    if (hybridDetails) hybridDetails.style.display = 'none';
  }
  
  // 显示最终结果
  if (finalResults.length === 0) {
    resultsDiv.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--SmartThemeQuoteColor, #999); font-style: italic;">
        未找到相关内容，请尝试：
        <ul style="text-align: left; margin-top: 10px; padding-left: 40px;">
          <li>使用不同的检索模式</li>
          <li>增加返回结果数</li>
          <li>使用不同的查询文本</li>
          <li>检查集合是否已向量化且包含关键字索引</li>
        </ul>
      </div>
    `;
    return;
  }
  
  // 渲染结果列表
  resultsDiv.innerHTML = finalResults.map((result, index) => {
    // ⭐ 修复：正确获取chunk对象
    const chunk = result.chunk || result;
    const score = result.fusionScore || result.similarity || result.bm25Score || result.keywordScore || 0;
    const scorePercent = (score * 100).toFixed(1);
    const tokens = result.estimatedTokens || 0;
    const collectionName = result.collectionName || '未知集合';
    const docTitle = chunk.metadata?.docTitle || '未知文档';
    const text = chunk.text || '';
    
    // 高亮查询词
    const highlightedText = highlightQueryTerms(text, queryText);
    
    // 分数颜色
    const scoreColor = score >= 0.8 ? 'var(--green, #4caf50)'
      : score >= 0.6 ? 'var(--SmartThemeBlurTintColor, #4a9eff)'
      : 'var(--orange, #ff9800)';
    
    // 显示来源信息
    let sourceInfo = '';
    if (mode === 'hybrid') {
      const sources = [];
      if (result.vectorRank) sources.push(`向量#${result.vectorRank}`);
      if (result.keywordRank) sources.push(`关键字#${result.keywordRank}`);
      sourceInfo = sources.length > 0 ? ` | 来源: ${sources.join(' + ')}` : '';
    }
    
    return `
      <div class="ce-collapsible-card" style="margin-bottom: 10px;">
        <div class="ce-collapsible-card-header" style="cursor: pointer;" data-action="toggle-result" data-result-index="${index}">
          <span class="ce-collapsible-toggle">▶</span>
          <div class="ce-collapsible-header-content">
            <span class="ce-collapsible-title">#${index + 1} ${docTitle}</span>
            <span class="ce-collapsible-badge" style="background: ${scoreColor};">分数 ${scorePercent}%</span>
            <span class="ce-collapsible-hint">${collectionName} | ${tokens} tokens${sourceInfo}</span>
          </div>
        </div>
        <div class="ce-collapsible-card-content" style="display: none;">
          <div class="ce-collapsible-body-content">
            <div style="margin-bottom: 10px; padding: 10px; background: var(--black50a, rgba(0,0,0,0.5)); border-radius: 4px; font-size: 0.9em;">
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-bottom: 8px;">
                <div><strong>分数:</strong> ${scorePercent}%</div>
                <div><strong>Token数:</strong> ${tokens}</div>
                <div><strong>集合:</strong> ${collectionName}</div>
                <div><strong>文档:</strong> ${docTitle}</div>
              </div>
              ${result.truncated ? '<div style="color: var(--orange, #ff9800); font-size: 0.85em;">⚠️ 内容已截断以适应Token预算</div>' : ''}
            </div>
            <div style="padding: 15px; background: var(--black30a, rgba(0,0,0,0.3)); border-radius: 6px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word;">
              ${highlightedText}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  // 绑定折叠/展开事件
  resultsDiv.querySelectorAll('[data-action="toggle-result"]').forEach(header => {
    header.addEventListener('click', () => {
      const card = header.closest('.ce-collapsible-card');
      const content = card.querySelector('.ce-collapsible-card-content');
      const toggle = card.querySelector('.ce-collapsible-toggle');
      
      if (content.style.display === 'none') {
        content.style.display = 'block';
        toggle.textContent = '▼';
      } else {
        content.style.display = 'none';
        toggle.textContent = '▶';
      }
    });
  });
}

/**
 * 高亮查询词
 * @param {string} text
 * @param {string} query
 * @returns {string}
 */
function highlightQueryTerms(text, query) {
  if (!text || !query) return text;
  
  // 简单的高亮实现：将查询文本中的词分割并高亮
  const terms = query.split(/\s+/).filter(t => t.length > 1);
  let highlighted = text;
  
  terms.forEach(term => {
    const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
    highlighted = highlighted.replace(regex, '<mark style="background: var(--SmartThemeBlurTintColor, #4a9eff); color: var(--SmartThemeBodyColor, #fff); padding: 2px 4px; border-radius: 2px;">$1</mark>');
  });
  
  return highlighted;
}

/**
 * 转义正则表达式特殊字符
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}