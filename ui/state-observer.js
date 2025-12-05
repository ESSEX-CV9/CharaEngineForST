// 角色引擎：参数 / 状态观察器 + 解析输出查看器
// - 只读当前角色卡中的配置（通过 card-storage）
// - 结合当前对话 EngineState，展示当前楼层的数值与短期情绪/场景/cast
// - 支持在 UI 中做"临时参数覆盖"来观察提示组合效果（模拟），但不写回存档
// - 新增：时间线视图，可查看任意楼层的解析输出和状态变化
// - 自动刷新：监听 ST 事件，在切换聊天/角色/分支/滑动时自动刷新

import { getConfigForCurrentCharacter, getCurrentCharacterName } from "../integration/card-storage.js";
import { rebuildEngineStateUpTo, getChangeSetForIndex } from "../integration/chat-state-storage.js";
import { getChat } from "../integration/st-context.js";
import { buildPromptBundles } from "../core/prompt-slots.js";
import { buildNormalizedEntities } from "../core/entities.js";
import { parseVariablePath } from "../core/variables.js";
import { eventSource, event_types } from "../../../../../script.js";

/**
 * 简单日志
 * @param  {...any} args
 */
function logDebug(...args) {
  // eslint-disable-next-line no-console
  console.debug("[CharacterEngine][StateObserver]", ...args);
}

let observerModalRoot = null;
let currentFloorIndex = -1; // 当前查看的楼层索引
let isSidebarMode = true; // 默认为侧边栏模式
let dragState = null; // 拖动状态
let resizeState = null; // 缩放状态
let eventListenersRegistered = false; // 标记事件监听器是否已注册

/**
 * 对外入口：打开参数/状态观察器
 */
export function openCeStateObserverPanel() {
  ensureObserverModal();
  registerStEventListeners(); // 注册 ST 事件监听器
  refreshObserverFromCurrentState();
  observerModalRoot.style.display = "flex";
}

/**
 * 关闭观察器
 */
function closeCeStateObserverPanel() {
  if (observerModalRoot) {
    observerModalRoot.style.display = "none";
  }
  // 注意：不取消注册事件监听器，保持后台监听以便下次打开时能立即显示最新状态
}

/**
 * 创建观察器弹窗 DOM
 */
function ensureObserverModal() {
  if (observerModalRoot && document.body.contains(observerModalRoot)) {
    return;
  }

  observerModalRoot = document.createElement("div");
  observerModalRoot.className = "ce-modal-backdrop ce-modal-backdrop-sidebar";
  observerModalRoot.dataset.ceStateObserverRoot = "true";

  observerModalRoot.innerHTML = `
    <div class="ce-modal ce-modal-large ce-modal-sidebar">
      <div class="ce-modal-header ce-draggable-handle">
        <div class="ce-modal-title">
          <span class="ce-drag-indicator">⋮⋮</span>
          角色引擎：状态观察器 & 解析输出查看器
        </div>
        <div class="ce-modal-header-actions">
          <button class="ce-modal-action-btn" data-action="toggleSidebar" type="button" title="切换侧边栏模式">
            <span class="ce-sidebar-icon">◧</span>
          </button>
          <button class="ce-modal-close" type="button" title="关闭">×</button>
        </div>
      </div>
      <div class="ce-floor-selector">
        <label>选择楼层：</label>
        <button class="ce-btn ce-btn-small" data-action="prevFloor" title="上一楼层">◀</button>
        <input type="number" id="ce-floor-input" min="0" value="0" style="width:80px;text-align:center;"/>
        <span id="ce-floor-total">/ 0</span>
        <button class="ce-btn ce-btn-small" data-action="nextFloor" title="下一楼层">▶</button>
        <button class="ce-btn ce-btn-small" data-action="latestFloor" title="跳转到最新">最新</button>
        <label style="margin-left:20px;">
          <input type="checkbox" id="ce-auto-refresh" checked/>
          自动刷新到最新
        </label>
      </div>
      <div class="ce-modal-tabs">
        <button class="ce-tab-btn ce-tab-btn-active" data-tab="timeline">时间线视图</button>
        <button class="ce-tab-btn" data-tab="engine">EngineState 概览</button>
        <button class="ce-tab-btn" data-tab="promptPreview">提示组合预览</button>
      </div>
      <div class="ce-modal-body">
        <div class="ce-tab-panel" data-tab-panel="timeline"></div>
        <div class="ce-tab-panel" data-tab-panel="engine" style="display:none;"></div>
        <div class="ce-tab-panel" data-tab-panel="promptPreview" style="display:none;"></div>
      </div>
      <div class="ce-modal-footer">
        <button class="ce-btn ce-btn-secondary" data-action="refresh">刷新当前楼层</button>
        <button class="ce-btn ce-btn-secondary" data-action="close">关闭</button>
      </div>
      <!-- 缩放手柄 -->
      <div class="ce-resize-handle ce-resize-handle-se" data-resize="se"></div>
      <div class="ce-resize-handle ce-resize-handle-e" data-resize="e"></div>
      <div class="ce-resize-handle ce-resize-handle-s" data-resize="s"></div>
    </div>
  `;

  document.body.appendChild(observerModalRoot);
  wireObserverModalEvents(observerModalRoot);
}

/**
 * 绑定观察器弹窗事件
 * @param {HTMLElement} root
 */
function wireObserverModalEvents(root) {
  const closeBtn = root.querySelector(".ce-modal-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => closeCeStateObserverPanel());
  }

  // 侧边栏切换按钮
  const toggleSidebarBtn = root.querySelector('[data-action="toggleSidebar"]');
  if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener("click", () => toggleSidebarMode());
  }

  // 不再点击背景关闭（因为背景透明了）
  // root.addEventListener("click", (ev) => {
  //   if (ev.target === root) {
  //     closeCeStateObserverPanel();
  //   }
  // });

  // 初始化拖动和缩放功能
  initDragAndResize(root);

  const tabButtons = root.querySelectorAll(".ce-tab-btn");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      switchTab(root, tab);
    });
  });

  // 楼层选择器事件
  const floorInput = root.querySelector("#ce-floor-input");
  const prevBtn = root.querySelector('[data-action="prevFloor"]');
  const nextBtn = root.querySelector('[data-action="nextFloor"]');
  const latestBtn = root.querySelector('[data-action="latestFloor"]');

  if (floorInput) {
    floorInput.addEventListener("change", () => {
      const index = parseInt(floorInput.value, 10);
      if (!isNaN(index)) {
        jumpToFloor(index);
      }
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (currentFloorIndex > 0) {
        jumpToFloor(currentFloorIndex - 1);
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      const chat = getChat() || [];
      if (currentFloorIndex < chat.length - 1) {
        jumpToFloor(currentFloorIndex + 1);
      }
    });
  }

  if (latestBtn) {
    latestBtn.addEventListener("click", () => {
      const chat = getChat() || [];
      if (chat.length > 0) {
        jumpToFloor(chat.length - 1);
      }
    });
  }

  const footer = root.querySelector(".ce-modal-footer");
  if (footer) {
    footer.addEventListener("click", (ev) => {
      const target = ev.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.dataset.action;
      if (!action) return;

      if (action === "refresh") {
        refreshObserverFromCurrentState();
      } else if (action === "close") {
        closeCeStateObserverPanel();
      }
    });
  }
}

/**
 * Tab 切换
 * @param {HTMLElement} root
 * @param {string} tab
 */
function switchTab(root, tab) {
  const tabButtons = root.querySelectorAll(".ce-tab-btn");
  tabButtons.forEach((btn) => {
    if (btn.dataset.tab === tab) {
      btn.classList.add("ce-tab-btn-active");
    } else {
      btn.classList.remove("ce-tab-btn-active");
    }
  });

  const panels = root.querySelectorAll(".ce-tab-panel");
  panels.forEach((panel) => {
    if (panel.dataset.tabPanel === tab) {
      panel.style.display = "";
    } else {
      panel.style.display = "none";
    }
  });
}

/**
 * 跳转到指定楼层
 * @param {number} index
 */
function jumpToFloor(index) {
  const chat = getChat() || [];
  if (index < 0 || index >= chat.length) {
    return;
  }
  currentFloorIndex = index;
  refreshObserverFromCurrentState();
}

/**
 * 刷新三个面板的内容：EngineState 概览 / 参数视角 / 提示预览
 */
function refreshObserverFromCurrentState() {
  const chat = getChat() || [];
  
  // 如果启用自动刷新，跳转到最新楼层
  const autoRefreshCheckbox = observerModalRoot?.querySelector("#ce-auto-refresh");
  if (autoRefreshCheckbox?.checked && currentFloorIndex < 0) {
    currentFloorIndex = chat.length > 0 ? chat.length - 1 : 0;
  }
  
  // 确保 currentFloorIndex 有效
  if (currentFloorIndex < 0 || currentFloorIndex >= chat.length) {
    currentFloorIndex = chat.length > 0 ? chat.length - 1 : 0;
  }

  const engineState = rebuildEngineStateUpTo(currentFloorIndex);
  const charConfig = getConfigForCurrentCharacter();
  const currentCharacterName = getCurrentCharacterName();

  logDebug("当前楼层：", currentFloorIndex);
  logDebug("当前 EngineState：", engineState);
  logDebug("当前角色配置：", charConfig);
  logDebug("当前角色名：", currentCharacterName);

  // 更新楼层选择器显示
  updateFloorSelector(currentFloorIndex, chat.length);

  // 渲染各个面板
  renderTimelineView(currentFloorIndex, chat, charConfig, engineState, currentCharacterName);
  renderEngineOverview(engineState, charConfig, currentCharacterName);
  renderPromptPreview(charConfig, engineState, currentCharacterName);
}

/**
 * 更新楼层选择器的显示
 * @param {number} currentIndex
 * @param {number} totalCount
 */
function updateFloorSelector(currentIndex, totalCount) {
  if (!observerModalRoot) return;
  
  const floorInput = observerModalRoot.querySelector("#ce-floor-input");
  const floorTotal = observerModalRoot.querySelector("#ce-floor-total");
  
  if (floorInput) {
    floorInput.value = currentIndex;
    floorInput.max = Math.max(0, totalCount - 1);
  }
  
  if (floorTotal) {
    floorTotal.textContent = `/ ${Math.max(0, totalCount - 1)}`;
  }
}


/* ==========================
 * Panel 0: 时间线视图（新增）
 * ========================== */

/**
 * 渲染时间线视图：显示当前楼层的完整数据流
 * @param {number} floorIndex
 * @param {Array} chat
 * @param {import("../integration/card-storage.js").CeCharacterConfig} charConfig
 * @param {any} engineState
 * @param {string} currentCharacterName
 */
function renderTimelineView(floorIndex, chat, charConfig, engineState, currentCharacterName) {
  if (!observerModalRoot) return;
  const panel = observerModalRoot.querySelector('[data-tab-panel="timeline"]');
  if (!panel) return;

  const msg = chat[floorIndex];
  if (!msg) {
    panel.innerHTML = `
      <div class="ce-section-header">
        <span>时间线视图 - 楼层 ${floorIndex}</span>
      </div>
      <div class="ce-hint">该楼层不存在</div>
    `;
    return;
  }

  const isUser = msg.is_user;
  const content = msg.mes || "";
  const changeSet = getChangeSetForIndex(floorIndex);
  
  // 获取前一楼层的状态（用于对比）
  const prevState = floorIndex > 0 ? rebuildEngineStateUpTo(floorIndex - 1) : null;

  panel.innerHTML = `
    <div class="ce-section-header">
      <span>时间线视图 - 楼层 ${floorIndex} ${isUser ? '(用户)' : '(AI)'}</span>
    </div>
    
    <div class="ce-timeline-container">
      <!-- 参数状态（置顶） -->
      ${renderParametersSection(charConfig, engineState, currentCharacterName)}

      <!-- 消息内容 -->
      <div class="ce-timeline-section">
        <div class="ce-timeline-section-title">${isUser ? '用户输入' : 'AI 回复'}</div>
        <div class="ce-timeline-content">
          <pre style="white-space:pre-wrap;font-size:0.9rem;margin:0;">${escapeHtml(content)}</pre>
        </div>
      </div>

      <!-- 解析输出 -->
      ${renderParseOutput(changeSet, isUser)}

      <!-- Cast & 场景信息 -->
      ${renderCastAndSceneSection(engineState, changeSet)}

      <!-- 状态变化摘要 -->
      ${renderStateChanges(prevState, engineState, changeSet)}
    </div>
  `;
}

/**
 * 渲染解析输出部分
 * @param {any} changeSet
 * @param {boolean} isUser
 */
function renderParseOutput(changeSet, isUser) {
  if (!changeSet) {
    return `
      <div class="ce-timeline-section">
        <div class="ce-timeline-section-title">解析模型输出</div>
        <div class="ce-timeline-content ce-hint">
          ${isUser ? '用户消息无解析输出' : '该楼层无解析输出（可能是重新生成/滑动/继续等操作）'}
        </div>
      </div>
    `;
  }

  const sections = [];
  
  // 优先显示原始文本（如果存在）
  if (changeSet.rawText) {
    sections.push(`
      <div class="ce-parse-subsection">
        <div class="ce-parse-subsection-title">📄 解析模型原始输出</div>
        <pre style="white-space:pre-wrap;font-size:0.85rem;margin:4px 0;padding:8px;background:#f5f5f5;border-radius:4px;max-height:300px;overflow:auto;">${escapeHtml(changeSet.rawText)}</pre>
      </div>
    `);
  }
  
  // 显示解析方法和警告（如果存在）
  if (changeSet.parseMethod || (changeSet.warnings && changeSet.warnings.length > 0)) {
    const infoParts = [];
    if (changeSet.parseMethod) {
      infoParts.push(`<strong>解析方法：</strong>${escapeHtml(changeSet.parseMethod)}`);
    }
    if (changeSet.warnings && changeSet.warnings.length > 0) {
      infoParts.push(`<strong>警告：</strong>${escapeHtml(changeSet.warnings.join('; '))}`);
    }
    if (changeSet.debugInfo && Object.keys(changeSet.debugInfo).length > 0) {
      infoParts.push(`<strong>调试信息：</strong>${escapeHtml(JSON.stringify(changeSet.debugInfo))}`);
    }
    
    sections.push(`
      <div class="ce-parse-subsection">
        <div class="ce-parse-subsection-title">ℹ️ 解析信息</div>
        <div style="padding:8px;font-size:0.9rem;">
          ${infoParts.join('<br/>')}
        </div>
      </div>
    `);
  }

  // CE_UpdateState
  if (changeSet.stateDelta && changeSet.stateDelta.variables) {
    const vars = changeSet.stateDelta.variables;
    sections.push(`
      <div class="ce-parse-subsection">
        <div class="ce-parse-subsection-title">CE_UpdateState (${vars.length} 个变量操作)</div>
        <table class="ce-table ce-table-compact">
          <thead>
            <tr>
              <th>路径</th>
              <th>作用域</th>
              <th>操作</th>
              <th>值/符号</th>
              <th>原因</th>
            </tr>
          </thead>
          <tbody>
            ${vars.map(v => `
              <tr>
                <td>${escapeHtml(v.path || v.key || '')}</td>
                <td>${escapeHtml(v.scope || '')}</td>
                <td>${escapeHtml(v.op || '')}</td>
                <td>${escapeHtml(v.op === 'symbolic' ? (v.symbol || '') : JSON.stringify(v.value))}</td>
                <td>${escapeHtml(v.meta?.reason || '')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `);
  }

  // CE_UpdateScene
  if (changeSet.sceneDelta) {
    const scene = changeSet.sceneDelta;
    const parts = [];
    if (scene.locationHint) {
      parts.push(`<div><strong>地点：</strong>${escapeHtml(scene.locationHint)}</div>`);
    }
    if (scene.sceneTags) {
      if (scene.sceneTags.add?.length) {
        parts.push(`<div><strong>添加标签：</strong>${escapeHtml(scene.sceneTags.add.join(', '))}</div>`);
      }
      if (scene.sceneTags.remove?.length) {
        parts.push(`<div><strong>移除标签：</strong>${escapeHtml(scene.sceneTags.remove.join(', '))}</div>`);
      }
    }
    if (scene.castIntent) {
      if (scene.castIntent.enter?.length) {
        parts.push(`<div><strong>进场：</strong>${escapeHtml(scene.castIntent.enter.map(e => e.name).join(', '))}</div>`);
      }
      if (scene.castIntent.leave?.length) {
        parts.push(`<div><strong>离场：</strong>${escapeHtml(scene.castIntent.leave.map(e => e.name).join(', '))}</div>`);
      }
    }
    
    if (parts.length > 0) {
      sections.push(`
        <div class="ce-parse-subsection">
          <div class="ce-parse-subsection-title">CE_UpdateScene</div>
          <div style="padding:8px;">
            ${parts.join('')}
          </div>
        </div>
      `);
    }
  }

  // WorldContextIntent
  if (changeSet.worldIntent) {
    const queries = changeSet.worldIntent.Queries || changeSet.worldIntent.queries || [];
    if (queries.length > 0) {
      sections.push(`
        <div class="ce-parse-subsection">
          <div class="ce-parse-subsection-title">WorldContextIntent (${queries.length} 个查询)</div>
          <table class="ce-table ce-table-compact">
            <thead>
              <tr>
                <th>查询</th>
                <th>集合</th>
                <th>重要性</th>
              </tr>
            </thead>
            <tbody>
              ${queries.map(q => `
                <tr>
                  <td>${escapeHtml(q.query || '')}</td>
                  <td>${escapeHtml((q.collections || []).join(', '))}</td>
                  <td>${escapeHtml(q.importance || '')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `);
    }
  }

  // 原始 JSON
  sections.push(`
    <div class="ce-parse-subsection">
      <div class="ce-parse-subsection-title">原始 ChangeSet JSON</div>
      <pre style="white-space:pre-wrap;font-size:0.75rem;margin:4px 0;max-height:200px;overflow:auto;">${escapeHtml(JSON.stringify(changeSet, null, 2))}</pre>
    </div>
  `);

  return `
    <div class="ce-timeline-section">
      <div class="ce-timeline-section-title">解析模型输出</div>
      <div class="ce-timeline-content">
        ${sections.join('')}
      </div>
    </div>
  `;
}

/**
 * 渲染状态变化部分
 * @param {any} prevState
 * @param {any} currentState
 * @param {any} changeSet
 */
function renderStateChanges(prevState, currentState, changeSet) {
  const parts = [];

  // 短期情绪/意图变化（支持多角色嵌套结构）
  const prevCharBucket = prevState?.variables?.character || {};
  const currCharBucket = currentState?.variables?.character || {};
  
  // 获取所有涉及的角色名（前后状态的并集）
  const allCharNames = new Set([
    ...Object.keys(prevCharBucket),
    ...Object.keys(currCharBucket)
  ]);
  
  const shortTermChanges = [];
  for (const charName of allCharNames) {
    const prevChar = prevCharBucket[charName] || {};
    const currChar = currCharBucket[charName] || {};
    
    const prevEmotion = prevChar['短期情绪'] || prevChar['short_term_emotion'];
    const currEmotion = currChar['短期情绪'] || currChar['short_term_emotion'];
    const prevIntent = prevChar['短期意图'] || prevChar['short_term_intent'];
    const currIntent = currChar['短期意图'] || currChar['short_term_intent'];
    
    if (prevEmotion !== currEmotion || prevIntent !== currIntent) {
      shortTermChanges.push(`
        <div><strong>${escapeHtml(charName)}:</strong></div>
        <div style="margin-left:1em;">情绪：${escapeHtml(String(prevEmotion || '无'))} → ${escapeHtml(String(currEmotion || '无'))}</div>
        <div style="margin-left:1em;">意图：${escapeHtml(String(prevIntent || '无'))} → ${escapeHtml(String(currIntent || '无'))}</div>
      `);
    }
  }
  
  if (shortTermChanges.length > 0) {
    parts.push(`
      <div class="ce-state-change-item">
        <strong>短期状态变化：</strong>
        ${shortTermChanges.join('')}
      </div>
    `);
  }

  // 场景变化
  const prevLocation = prevState?.scene?.locationHint;
  const currLocation = currentState?.scene?.locationHint;
  const prevTags = prevState?.scene?.sceneTags || [];
  const currTags = currentState?.scene?.sceneTags || [];

  if (prevLocation !== currLocation || JSON.stringify(prevTags) !== JSON.stringify(currTags)) {
    parts.push(`
      <div class="ce-state-change-item">
        <strong>场景变化：</strong>
        <div>地点：${escapeHtml(String(prevLocation || '无'))} → ${escapeHtml(String(currLocation || '无'))}</div>
        <div>标签：${escapeHtml(prevTags.join(', ') || '无')} → ${escapeHtml(currTags.join(', ') || '无')}</div>
      </div>
    `);
  }

  // Cast 变化
  const prevFocus = prevState?.cast?.focus || [];
  const currFocus = currentState?.cast?.focus || [];
  
  if (JSON.stringify(prevFocus) !== JSON.stringify(currFocus)) {
    parts.push(`
      <div class="ce-state-change-item">
        <strong>Cast 变化：</strong>
        <div>Focus：${escapeHtml(prevFocus.join(', ') || '无')} → ${escapeHtml(currFocus.join(', ') || '无')}</div>
      </div>
    `);
  }

  if (parts.length === 0) {
    parts.push(`<div class="ce-hint">本楼层无明显状态变化</div>`);
  }

  return `
    <div class="ce-timeline-section">
      <div class="ce-timeline-section-title">状态变化摘要</div>
      <div class="ce-timeline-content">
        ${parts.join('')}
      </div>
    </div>
  `;
}

/**
 * 渲染参数状态部分（时间线视图顶部）
 * @param {import("../integration/card-storage.js").CeCharacterConfig} charConfig
 * @param {any} engineState
 * @param {string} currentCharacterName
 */
function renderParametersSection(charConfig, engineState, currentCharacterName) {
  const params = charConfig.parameters || [];
  if (!params.length) {
    return `
      <div class="ce-timeline-section">
        <div class="ce-timeline-section-title">📊 当前楼层参数状态</div>
        <div class="ce-timeline-content ce-hint">当前角色卡未定义任何参数</div>
      </div>
    `;
  }

  // 收集所有实体的参数值
  const vars = engineState?.variables || {};
  const rows = [];
  
  // 获取角色卡配置以检查禁用状态
  const options = charConfig.options || {};
  const enableShortTermEmotion = !options.disableShortTermEmotion;
  const enableShortTermIntent = !options.disableShortTermIntent;
  
  // 遍历参数定义
  for (const p of params) {
    // 检查是否应该跳过被禁用的短期情绪/意图参数
    const name = (p.name || "").toLowerCase();
    const id = (p.id || "").toLowerCase();
    
    const isShortTermEmotion = id === "short_term_emotion" || name.includes("短期情绪");
    const isShortTermIntent = id === "short_term_intent" || name.includes("短期意图");
    
    // 如果是短期情绪/意图参数且被禁用，跳过
    if (isShortTermEmotion && !enableShortTermEmotion) {
      continue;
    }
    if (isShortTermIntent && !enableShortTermIntent) {
      continue;
    }
    
    const scope = p.scope || "character";
    const bucket = vars[scope];
    
    if (!bucket || typeof bucket !== "object") {
      // 如果桶不存在，显示未找到
      rows.push(`
        <tr>
          <td style="color:#999;">-</td>
          <td style="font-weight:500;">${escapeHtml(p.name || "")}</td>
          <td style="color:#999;">(未找到对应变量)</td>
        </tr>
      `);
      continue;
    }
    
    // 如果是 character 或 relationship scope，遍历所有实体
    if (scope === "character" || scope === "relationship") {
      let foundAny = false;
      
      // 获取所有绑定了此参数的实体（从 normalizedEntities）
      const normalizedEntities = buildNormalizedEntities(
        charConfig.entities || [],
        engineState?.entitiesRuntime,
        null,
        null,
        charConfig.parameters || []
      );
      
      const entitiesWithParam = normalizedEntities.filter(e =>
        e.type === "character" &&
        Array.isArray(e.parameterNames) &&
        e.parameterNames.some(pName => pName === p.name || pName === p.id)
      );
      
      // 遍历绑定了此参数的实体
      for (const entity of entitiesWithParam) {
        const entityName = entity.name;
        const entityBucket = bucket[entityName];
        
        // 检查这个实体是否有这个参数的值（同时检查 name 和 id）
        const value = entityBucket?.[p.name] ?? entityBucket?.[p.id];
        
        foundAny = true;
        const valueStr = formatParamValue(value);
        rows.push(`
          <tr>
            <td style="font-weight:500;">${escapeHtml(entityName)}</td>
            <td>${escapeHtml(p.name || "")}</td>
            <td>${escapeHtml(valueStr)}</td>
          </tr>
        `);
      }
      
      // 如果没有找到任何绑定了此参数的实体，显示未绑定
      if (!foundAny) {
        rows.push(`
          <tr>
            <td style="color:#999;">-</td>
            <td style="font-weight:500;">${escapeHtml(p.name || "")}</td>
            <td style="color:#999;">(无实体绑定此参数)</td>
          </tr>
        `);
      }
    } else {
      // scene 或 global scope，直接查找
      const value = bucket[p.name] ?? bucket[p.id];
      const valueStr = formatParamValue(value);
      rows.push(`
        <tr>
          <td style="color:#999;">-</td>
          <td style="font-weight:500;">${escapeHtml(p.name || "")}</td>
          <td>${escapeHtml(valueStr)}</td>
        </tr>
      `);
    }
  }

  return `
    <div class="ce-timeline-section">
      <div class="ce-timeline-section-title">📊 当前楼层参数状态</div>
      <div class="ce-timeline-content">
        <table class="ce-table ce-table-compact" style="width:100%;">
          <thead>
            <tr>
              <th style="width:25%;">实体</th>
              <th style="width:25%;">参数名</th>
              <th style="width:50%;">当前值</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * 渲染 Cast & 场景信息部分
 * @param {any} engineState
 * @param {any} changeSet
 */
function renderCastAndSceneSection(engineState, changeSet) {
  const scene = engineState?.scene || {};
  const cast = engineState?.cast || {};
  const sceneDelta = changeSet?.sceneDelta;

  const parts = [];

  // 场景信息
  const location = scene.locationHint || "未设置";
  const tags = scene.sceneTags || [];
  
  parts.push(`
    <div class="ce-state-change-item">
      <strong>场景地点：</strong>${escapeHtml(location)}
    </div>
  `);
  
  if (tags.length > 0) {
    parts.push(`
      <div class="ce-state-change-item">
        <strong>场景标签：</strong>${escapeHtml(tags.join(', '))}
      </div>
    `);
  }

  // Cast 信息
  const focus = cast.focus || [];
  const supporting = cast.presentSupporting || [];
  const offstage = cast.offstageRelated || [];

  if (focus.length > 0) {
    parts.push(`
      <div class="ce-state-change-item">
        <strong>Focus 角色：</strong>${escapeHtml(focus.join(', '))}
      </div>
    `);
  }

  if (supporting.length > 0) {
    parts.push(`
      <div class="ce-state-change-item">
        <strong>Supporting 角色：</strong>${escapeHtml(supporting.join(', '))}
      </div>
    `);
  }

  if (offstage.length > 0) {
    parts.push(`
      <div class="ce-state-change-item">
        <strong>Offstage 相关：</strong>${escapeHtml(offstage.join(', '))}
      </div>
    `);
  }

  // Cast 变化（如果有）
  if (sceneDelta?.castIntent) {
    const enter = sceneDelta.castIntent.enter || [];
    const leave = sceneDelta.castIntent.leave || [];
    
    if (enter.length > 0) {
      parts.push(`
        <div class="ce-state-change-item">
          <strong>进场角色：</strong>${escapeHtml(enter.map(e => e.name).join(', '))}
        </div>
      `);
    }
    
    if (leave.length > 0) {
      parts.push(`
        <div class="ce-state-change-item">
          <strong>离场角色：</strong>${escapeHtml(leave.map(e => e.name).join(', '))}
        </div>
      `);
    }
  }

  if (parts.length === 0) {
    parts.push(`<div class="ce-hint">本楼层无场景或 Cast 信息</div>`);
  }

  return `
    <div class="ce-timeline-section">
      <div class="ce-timeline-section-title">Cast & 场景信息</div>
      <div class="ce-timeline-content">
        ${parts.join('')}
      </div>
    </div>
  `;
}

/* ==========================
 * Panel 1: EngineState 概览
 * ========================== */

/**
 * @param {any} engineState
 * @param {import("../integration/card-storage.js").CeCharacterConfig} charConfig
 * @param {string} currentCharacterName
 */
function renderEngineOverview(engineState, charConfig, currentCharacterName) {
  if (!observerModalRoot) return;
  const panel = observerModalRoot.querySelector('[data-tab-panel="engine"]');
  if (!panel) return;

  const scene = engineState?.scene || {};
  const cast = engineState?.cast || {};
  const vars = engineState?.variables || {};

  const shortTermStates = resolveShortTermForOverview(charConfig, engineState);

  // 构建短期情绪/意图的 HTML（支持多角色）
  const shortTermHtml = shortTermStates.length > 0
    ? shortTermStates.map(state => `
        <div class="ce-debug-panel-kv">
          <div class="ce-debug-panel-kv-key">${escapeHtml(state.name)}</div>
          <div class="ce-debug-panel-kv-value">
            情绪: ${escapeHtml(state.emotion != null ? String(state.emotion) : "(无)")}<br/>
            意图: ${escapeHtml(state.intent != null ? String(state.intent) : "(无)")}
          </div>
        </div>
      `).join('')
    : `<div class="ce-debug-panel-kv">
         <div class="ce-debug-panel-kv-value" style="color:#999;">Focus 层无角色或未设置短期情绪/意图</div>
       </div>`;

  panel.innerHTML = `
    <div class="ce-section-header">
      <span>运行时 EngineState 概览（只读）</span>
    </div>
    <div class="ce-hint">
      这里展示的是当前对话楼层重建后的内部状态快照，包括（基于参数系统推断的）短期情绪/意图、场景标签、cast 层级以及原始变量桶。
      这些数值由 CE_UpdateState / CE_UpdateScene 驱动，作者无需直接编辑。
    </div>

    <div class="ce-debug-panel" style="margin-top:8px;max-height:260px;">
      <div class="ce-debug-panel-section">
        <div class="ce-debug-panel-section-title">短期情绪 / 意图（Focus 层角色）</div>
        ${shortTermHtml}
      </div>

      <div class="ce-debug-panel-section">
        <div class="ce-debug-panel-section-title">场景</div>
        <div class="ce-debug-panel-kv">
          <div class="ce-debug-panel-kv-key">locationHint</div>
          <div class="ce-debug-panel-kv-value">${escapeHtml(scene.locationHint || "")}</div>
        </div>
        <div class="ce-debug-panel-kv">
          <div class="ce-debug-panel-kv-key">sceneTags</div>
          <div class="ce-debug-panel-kv-value">${escapeHtml((scene.sceneTags || []).join(", "))}</div>
        </div>
      </div>

      <div class="ce-debug-panel-section">
        <div class="ce-debug-panel-section-title">cast 层级</div>
        <div class="ce-debug-panel-kv">
          <div class="ce-debug-panel-kv-key">focus</div>
          <div class="ce-debug-panel-kv-value">${escapeHtml((cast.focus || []).join(", "))}</div>
        </div>
        <div class="ce-debug-panel-kv">
          <div class="ce-debug-panel-kv-key">presentSupporting</div>
          <div class="ce-debug-panel-kv-value">${escapeHtml((cast.presentSupporting || []).join(", "))}</div>
        </div>
        <div class="ce-debug-panel-kv">
          <div class="ce-debug-panel-kv-key">offstageRelated</div>
          <div class="ce-debug-panel-kv-value">${escapeHtml((cast.offstageRelated || []).join(", "))}</div>
        </div>
      </div>

      <div class="ce-debug-panel-section">
        <div class="ce-debug-panel-section-title">变量桶（原始视图）</div>
        <pre style="white-space:pre-wrap;font-size:0.8rem;margin:4px 0;">
${escapeHtml(JSON.stringify(vars, null, 2))}
        </pre>
      </div>
    </div>
  `;
}

/**
 * 创建一个基于路径的参数值查找函数（与 prompt-builder.js 保持一致）
 * @param {import("../core/variables.js").CeParameterDefinition[]} parameters
 * @param {any} engineState
 * @returns {(path: string) => any}
 */
function createPathBasedValueGetter(parameters, engineState) {
  return (path) => {
    const trimmedPath = String(path || "").trim();
    if (!trimmedPath) return undefined;

    const vars = engineState?.variables || {};
    const parsed = parseVariablePath(trimmedPath);
    const { subjectName, parameterName, targetName } = parsed;
    
    if (!parameterName) return undefined;

    const paramDef = parameters.find(p =>
      p && (p.name === parameterName || p.id === parameterName)
    );
    
    if (!paramDef) return undefined;

    const scope = paramDef.scope || "character";
    const bucket = vars[scope];
    
    if (!bucket || typeof bucket !== "object") {
      return undefined;
    }

    if (scope === "character" || scope === "relationship") {
      if (!subjectName) return undefined;
      
      const subjectBucket = bucket[subjectName];
      if (!subjectBucket || typeof subjectBucket !== "object") {
        return undefined;
      }
      
      const value = subjectBucket[parameterName] ?? subjectBucket[paramDef.id];
      
      if (scope === "relationship" && targetName && typeof value === "object") {
        return value[targetName];
      }
      
      return value;
    } else if (scope === "scene" || scope === "global") {
      return bucket[parameterName] ?? bucket[paramDef.id];
    }
    
    return undefined;
  };
}

/**
 * 基于参数定义与 EngineState.variables，获取所有 Focus 层角色的短期情绪/短期意图值。
 * 完全重写以支持多角色 Cast 设计。
 *
 * @param {import("../integration/card-storage.js").CeCharacterConfig} charConfig
 * @param {any} engineState
 * @returns {Array<{name: string, emotion: any, intent: any}>}
 */
function resolveShortTermForOverview(charConfig, engineState) {
  const params = (charConfig && Array.isArray(charConfig.parameters)) ? charConfig.parameters : [];
  const getValueByPath = createPathBasedValueGetter(params, engineState);

  const emotionParam =
    params.find(p => p && (p.id === "short_term_emotion" || p.name === "短期情绪")) || null;
  const intentParam =
    params.find(p => p && (p.id === "short_term_intent" || p.name === "短期意图")) || null;

  // 获取 Focus 层的所有角色
  const focusCharacters = engineState?.cast?.focus || [];
  
  const results = [];
  
  for (const characterName of focusCharacters) {
    let emotion = undefined;
    let intent = undefined;
    
    if (emotionParam) {
      const emotionPath = `${characterName}.${emotionParam.name || emotionParam.id}`;
      emotion = getValueByPath(emotionPath);
    }
    if (intentParam) {
      const intentPath = `${characterName}.${intentParam.name || intentParam.id}`;
      intent = getValueByPath(intentPath);
    }
    
    results.push({
      name: characterName,
      emotion,
      intent
    });
  }

  return results;
}

function formatParamValue(val) {
  if (val === undefined) return "(未找到对应变量)";
  if (val === null) return "null";
  if (typeof val === "number" || typeof val === "boolean" || typeof val === "string") {
    return String(val);
  }
  return JSON.stringify(val);
}

/* ==========================
 * Panel 2: 提示组合预览（模拟）
 * ========================== */

/**
 * 使用当前 EngineState + 角色卡提示配置，构造一次提示组合预览。
 * 这里不调用 LLM，而是生成与拦截器中相同格式的 Character_n / Location_n 注入块，
 * 方便作者验证当前楼层实际会注入给主对话模型的提示内容。
 *
 * @param {import("../integration/card-storage.js").CeCharacterConfig} charConfig
 * @param {any} engineState
 * @param {string} currentCharacterName
 */
function renderPromptPreview(charConfig, engineState, currentCharacterName) {
  if (!observerModalRoot) return;
  const panel = observerModalRoot.querySelector('[data-tab-panel="promptPreview"]');
  if (!panel) return;

  const prompts = charConfig.prompts || [];
  const parameters = charConfig.parameters || [];
  const promptTypes = charConfig.promptTypes || [];

  if (!prompts.length) {
    panel.innerHTML = `
      <div class="ce-section-header">
        <span>提示组合预览（Character_n / Location_n 注入块）</span>
      </div>
      <div class="ce-small-hint">
        当前角色卡未定义任何提示条目。
      </div>
    `;
    return;
  }

  // 使用统一的路径式参数查找
  const getValueByPath = createPathBasedValueGetter(parameters, engineState);

  // 提示类型说明映射：promptTypeName(name) -> description
  /** @type {Map<string, string>} */
  const promptTypeDescMap = new Map();
  for (const t of promptTypes) {
    if (!t || typeof t.name !== "string") continue;
    const name = t.name.trim();
    if (!name) continue;
    const desc = typeof t.description === "string" ? t.description.trim() : "";
    if (desc) {
      promptTypeDescMap.set(name, desc);
    }
  }

  // 1) 构造 ownerName → promptTypeName → 文本 的 bundle
  const bundles = buildPromptBundles(prompts, getValueByPath);
  const ownerNames = Object.keys(bundles);

  if (!ownerNames.length) {
    panel.innerHTML = `
      <div class="ce-section-header">
        <span>提示组合预览（Character_n / Location_n 注入块）</span>
      </div>
      <div class="ce-small-hint">
        当前状态下，没有任何提示条目命中。
      </div>
    `;
    return;
  }

  // 2) 合成实体视图：角色卡实体 + 运行时实体 + ownerName 自动补实体
  const runtimeEntitiesMap =
    engineState && engineState.entitiesRuntime && typeof engineState.entitiesRuntime === "object"
      ? engineState.entitiesRuntime
      : null;

  const normalizedEntities = buildNormalizedEntities(
    charConfig.entities || [],
    runtimeEntitiesMap,
    ownerNames
  );

  /** @type {Map<string, import("../core/entities.js").CeEntityDefinition>} */
  const entitiesByName = new Map();
  for (const e of normalizedEntities) {
    if (!e || !e.name) continue;
    entitiesByName.set(e.name, e);
  }

  // 3) 选取本轮需要注入的角色与地点实体（尽量与拦截器逻辑保持一致）

  const cast = engineState?.cast || {};
  const focusNames = Array.isArray(cast.focus) ? cast.focus : [];
  const supportingNames = Array.isArray(cast.presentSupporting) ? cast.presentSupporting : [];

  /** @type {string[]} */
  const activeCharacterNames = [];
  const pushCharacter = (rawName) => {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name || activeCharacterNames.includes(name)) return;
    const ent = entitiesByName.get(name);
    if (!ent || ent.type !== "character") return;
    activeCharacterNames.push(name);
  };

  focusNames.forEach(pushCharacter);
  supportingNames.forEach(pushCharacter);

  // 若 cast 中没有任何角色，则兜底为所有拥有提示的角色实体
  if (!activeCharacterNames.length) {
    for (const name of ownerNames) {
      const ent = entitiesByName.get(name);
      if (ent && ent.type === "character") {
        activeCharacterNames.push(name);
      }
    }
  }

  /** @type {string[]} */
  const activeLocationNames = [];
  const pushLocation = (rawName) => {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name || activeLocationNames.includes(name)) return;
    const ent = entitiesByName.get(name);
    if (!ent || ent.type !== "location") return;
    activeLocationNames.push(name);
  };

  // 主场景地点（如果有对应实体）
  const locationHint = engineState?.scene?.locationHint || "";
  if (typeof locationHint === "string" && locationHint.trim()) {
    pushLocation(locationHint);
  }

  // 根据角色的常见地点补充地点实体
  for (const charName of activeCharacterNames) {
    const ent = entitiesByName.get(charName);
    if (!ent || ent.type !== "character" || !Array.isArray(ent.locations)) continue;
    ent.locations.forEach(pushLocation);
  }

  // 若仍然没有地点实体，则兜底为所有拥有提示的地点实体
  if (!activeLocationNames.length) {
    for (const name of ownerNames) {
      const ent = entitiesByName.get(name);
      if (ent && ent.type === "location") {
        activeLocationNames.push(name);
      }
    }
  }

  // 4) 生成 Character_n / Location_n 注入块文本
  const lines = [];
  lines.push(
    "【Character Engine 提示块预览】以下内容为当前楼层将注入给主对话模型的 Character_n / Location_n 提示块预览。"
  );
  lines.push("");

  // 4.1 角色块
  let charIndex = 1;
  for (const name of activeCharacterNames) {
    const ent = entitiesByName.get(name);
    const bundle = bundles[name];
    const baseinfo = ent?.baseinfo || "";
    const typeMap = bundle?.byPromptType || {};

    lines.push(`<Character_${charIndex}>`);
    lines.push(`  character: ${name}`);
    lines.push(`  baseinfo: ${baseinfo ? baseinfo : ""}`);
    lines.push("  advanceinfo:");
    for (const [typeName, text] of Object.entries(typeMap)) {
      if (!text) continue;
      const raw = String(text || "");
      const desc = promptTypeDescMap.get(typeName) || "";
      const combined = desc ? `${desc}\n\n${raw}` : raw;
      lines.push(`    ${typeName}: |`);
      lines.push(indentBlock(combined, "      "));
    }
    lines.push(`</Character_${charIndex}>`);
    lines.push("");
    charIndex += 1;
  }

  // 4.2 地点块
  let locIndex = 1;
  for (const name of activeLocationNames) {
    const ent = entitiesByName.get(name);
    const bundle = bundles[name];
    const baseinfo = ent?.baseinfo || "";
    const typeMap = bundle?.byPromptType || {};

    lines.push(`<Location_${locIndex}>`);
    lines.push(`  Location: ${name}`);
    lines.push(`  baseinfo: ${baseinfo ? baseinfo : ""}`);
    lines.push("  advanceinfo:");
    for (const [typeName, text] of Object.entries(typeMap)) {
      if (!text) continue;
      const raw = String(text || "");
      const desc = promptTypeDescMap.get(typeName) || "";
      const combined = desc ? `${desc}\n\n${raw}` : raw;
      lines.push(`    ${typeName}: |`);
      lines.push(indentBlock(combined, "      "));
    }
    lines.push(`</Location_${locIndex}>`);
    lines.push("");
    locIndex += 1;
  }

  const previewText = lines.join("\n");

  panel.innerHTML = `
    <div class="ce-section-header">
      <span>提示组合预览（Character_n / Location_n 注入块）</span>
    </div>
    <div class="ce-small-hint">
      此处展示的是在当前 EngineState + 角色卡配置下，角色引擎实际会注入给主对话模型的提示块文本。
      你可以用它来验证实体配置、参数规则和提示条目是否按预期组合。
    </div>
    <div style="margin-top:6px;max-height:320px;overflow:auto;">
      <pre style="white-space:pre-wrap;font-size:0.8rem;margin:0;">${escapeHtml(previewText)}</pre>
    </div>
  `;
}

/* =====================
 * 工具函数
 * ===================== */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 缩进多行文本块（与 index.js 中的 indentBlock 语义保持一致，仅用于预览输出美观）
 * @param {string} text
 * @param {string} prefix
 */
function indentBlock(text, prefix) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

/**
 * 切换侧边栏模式（左侧边栏）
 */
function toggleSidebarMode() {
  if (!observerModalRoot) return;
  
  isSidebarMode = !isSidebarMode;
  const modal = observerModalRoot.querySelector(".ce-modal");
  
  if (isSidebarMode) {
    // 切换到左侧边栏模式
    modal.classList.add("ce-modal-sidebar");
    modal.classList.remove("ce-modal-draggable");
    observerModalRoot.classList.add("ce-modal-backdrop-sidebar");
  } else {
    // 切换回浮动模式
    modal.classList.remove("ce-modal-sidebar");
    modal.classList.add("ce-modal-draggable");
    observerModalRoot.classList.remove("ce-modal-backdrop-sidebar");
  }
  
  // 更新图标：◧ = 左侧边栏，◨ = 浮动窗口
  const icon = observerModalRoot.querySelector(".ce-sidebar-icon");
  if (icon) {
    icon.textContent = isSidebarMode ? "◧" : "◨";
  }
}

/**
 * 初始化拖动和缩放功能
 * @param {HTMLElement} root
 */
function initDragAndResize(root) {
  const modal = root.querySelector(".ce-modal");
  const header = root.querySelector(".ce-draggable-handle");
  
  if (!modal || !header) return;

  // 拖动功能
  header.addEventListener("mousedown", (e) => {
    if (isSidebarMode) return; // 侧边栏模式不允许拖动
    if (e.target.closest(".ce-modal-action-btn") || e.target.closest(".ce-modal-close")) {
      return; // 点击按钮时不触发拖动
    }
    
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      modalLeft: modal.offsetLeft,
      modalTop: modal.offsetTop
    };
    
    modal.style.cursor = "move";
    e.preventDefault();
  });

  // 缩放功能
  const resizeHandles = modal.querySelectorAll(".ce-resize-handle");
  resizeHandles.forEach(handle => {
    handle.addEventListener("mousedown", (e) => {
      if (isSidebarMode) return; // 侧边栏模式不允许缩放
      
      const direction = handle.dataset.resize;
      resizeState = {
        startX: e.clientX,
        startY: e.clientY,
        startWidth: modal.offsetWidth,
        startHeight: modal.offsetHeight,
        startLeft: modal.offsetLeft,
        startTop: modal.offsetTop,
        direction
      };
      
      e.preventDefault();
      e.stopPropagation();
    });
  });

  // 全局鼠标移动事件
  document.addEventListener("mousemove", (e) => {
    // 处理拖动
    if (dragState) {
      const deltaX = e.clientX - dragState.startX;
      const deltaY = e.clientY - dragState.startY;
      
      modal.style.left = `${dragState.modalLeft + deltaX}px`;
      modal.style.top = `${dragState.modalTop + deltaY}px`;
      modal.style.right = "auto";
      modal.style.bottom = "auto";
      modal.style.transform = "none";
    }
    
    // 处理缩放
    if (resizeState) {
      const deltaX = e.clientX - resizeState.startX;
      const deltaY = e.clientY - resizeState.startY;
      
      const minWidth = 400;
      const minHeight = 300;
      
      if (resizeState.direction.includes("e")) {
        const newWidth = Math.max(minWidth, resizeState.startWidth + deltaX);
        modal.style.width = `${newWidth}px`;
      }
      
      if (resizeState.direction.includes("s")) {
        const newHeight = Math.max(minHeight, resizeState.startHeight + deltaY);
        modal.style.height = `${newHeight}px`;
        modal.style.maxHeight = "none";
      }
    }
  });

  // 全局鼠标释放事件
  document.addEventListener("mouseup", () => {
    if (dragState) {
      modal.style.cursor = "";
      dragState = null;
    }
    if (resizeState) {
      resizeState = null;
    }
  });
}

/**
 * 注册 SillyTavern 事件监听器，实现自动刷新
 */
function registerStEventListeners() {
  if (eventListenersRegistered) {
    return; // 避免重复注册
  }

  if (!eventSource || !event_types) {
    logDebug("无法注册事件监听器：eventSource 或 event_types 不可用");
    return;
  }

  // 监听消息接收事件（AI 回复后）
  eventSource.on(event_types.MESSAGE_RECEIVED, () => {
    if (observerModalRoot && observerModalRoot.style.display !== "none") {
      const autoRefreshCheckbox = observerModalRoot.querySelector("#ce-auto-refresh");
      if (autoRefreshCheckbox?.checked) {
        logDebug("检测到 MESSAGE_RECEIVED 事件，自动刷新到最新楼层");
        const chat = getChat() || [];
        if (chat.length > 0) {
          jumpToFloor(chat.length - 1);
        }
      }
    }
  });

  // 监听聊天切换事件
  eventSource.on(event_types.CHAT_CHANGED, () => {
    if (observerModalRoot && observerModalRoot.style.display !== "none") {
      logDebug("检测到 CHAT_CHANGED 事件，刷新观察器");
      currentFloorIndex = -1; // 重置楼层索引
      refreshObserverFromCurrentState();
    }
  });

  // 监听角色切换事件
  eventSource.on(event_types.CHARACTER_SELECTED, () => {
    if (observerModalRoot && observerModalRoot.style.display !== "none") {
      logDebug("检测到 CHARACTER_SELECTED 事件，刷新观察器");
      currentFloorIndex = -1; // 重置楼层索引
      refreshObserverFromCurrentState();
    }
  });

  // 监听消息删除事件
  eventSource.on(event_types.MESSAGE_DELETED, () => {
    if (observerModalRoot && observerModalRoot.style.display !== "none") {
      logDebug("检测到 MESSAGE_DELETED 事件，刷新观察器");
      const chat = getChat() || [];
      // 如果当前楼层已被删除，跳转到最新楼层
      if (currentFloorIndex >= chat.length) {
        currentFloorIndex = Math.max(0, chat.length - 1);
      }
      refreshObserverFromCurrentState();
    }
  });

  // 监听消息编辑事件
  eventSource.on(event_types.MESSAGE_EDITED, () => {
    if (observerModalRoot && observerModalRoot.style.display !== "none") {
      logDebug("检测到 MESSAGE_EDITED 事件，刷新观察器");
      refreshObserverFromCurrentState();
    }
  });

  // 监听滑动事件（swipe）
  eventSource.on(event_types.MESSAGE_SWIPED, () => {
    if (observerModalRoot && observerModalRoot.style.display !== "none") {
      logDebug("检测到 MESSAGE_SWIPED 事件，刷新观察器");
      refreshObserverFromCurrentState();
    }
  });

  // 监听重新生成事件
  eventSource.on(event_types.GENERATION_STARTED, () => {
    if (observerModalRoot && observerModalRoot.style.display !== "none") {
      logDebug("检测到 GENERATION_STARTED 事件");
      // 生成开始时不刷新，等待 MESSAGE_RECEIVED
    }
  });

  eventListenersRegistered = true;
  logDebug("SillyTavern 事件监听器已注册");
}
