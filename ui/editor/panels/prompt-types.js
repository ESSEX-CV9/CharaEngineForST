// 提示类型面板

import { escapeHtml } from "../utils/dom.js";
import {
  createCollapsibleCard,
  toggleCollapse,
  DragSortManager,
  expandAll,
  collapseAll,
  collectCollapsedState,
  restoreCollapsedState
} from "../utils/collapsible-list.js";

/** @type {DragSortManager|null} */
let dragManager = null;

/** @type {Set<string>} */
let collapsedSet = new Set();

/**
 * 初始化提示类型面板 DOM 结构
 * @param {HTMLElement} panel
 */
export function initPromptTypesPanel(panel) {
  panel.innerHTML = `
    <div class="ce-section-header">
      <span>提示类型（作者自定义，如"语气""内心独白"）</span>
      <div style="display: flex; gap: 4px;">
        <button type="button" class="ce-btn ce-btn-small" data-ce-action="expand-all-types">全部展开</button>
        <button type="button" class="ce-btn ce-btn-small" data-ce-action="collapse-all-types">全部折叠</button>
        <button type="button" class="ce-btn ce-btn-small" data-ce-action="add-prompt-type">新增提示类型</button>
      </div>
    </div>
    <div class="ce-prompt-types-container" data-ce-container="promptTypes"></div>
  `;

  panel.addEventListener("click", onPromptTypePanelClick);

  // 初始化拖拽管理器
  const container = panel.querySelector('[data-ce-container="promptTypes"]');
  if (container) {
    dragManager = new DragSortManager(container);
    dragManager.enable();
  }
}

/**
 * 渲染提示类型数据
 * @param {HTMLElement} root
 * @param {Array} types
 */
export function renderPromptTypes(root, types) {
  const container = root.querySelector('[data-ce-container="promptTypes"]');
  if (!container) return;

  // 保存当前折叠状态
  const currentCollapsed = collectCollapsedState(container);
  if (currentCollapsed.size > 0) {
    collapsedSet = currentCollapsed;
  }

  container.innerHTML = "";

  (types || []).forEach((t, index) => {
    const rowId = `type-${index}`;
    const isCollapsed = collapsedSet.has(rowId) || collapsedSet.has(String(index));

    // 紧凑视图：只显示名称
    const headerContent = `
      <div class="ce-collapsible-header-content">
        <span class="ce-collapsible-title">${escapeHtml(t.name || "（未命名）")}</span>
        <button type="button" class="ce-btn ce-btn-small" data-ce-action="delete-prompt-type" title="删除">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;

    // 展开视图：第一行显示名称和ID，第二行显示说明，第三行显示优先级
    const priority = typeof t.priority === 'number' ? t.priority : 100;
    const bodyContent = `
      <div class="ce-collapsible-body-content">
        <div class="ce-form-row-multi">
          <label>
            <span class="ce-form-label">名称：</span>
            <input type="text" value="${escapeHtml(t.name || "")}" data-ce-field="name" placeholder="例如：语气" />
          </label>
          <label>
            <span class="ce-form-label">内部ID：</span>
            <input type="text" value="${escapeHtml(t.id || "")}" data-ce-field="id" placeholder="留空则自动生成"/>
          </label>
        </div>
        <div class="ce-form-row-multi">
          <label>
            <span class="ce-form-label">说明：</span>
            <input type="text" value="${escapeHtml(t.description || "")}" data-ce-field="description" placeholder="对该提示类型的说明"/>
          </label>
          <label>
            <span class="ce-form-label">优先级：</span>
            <input type="number" value="${priority}" data-ce-field="priority" min="0" max="9999" placeholder="0-9999，默认100" title="数值越小优先级越高，0最优先，9999最落后"/>
          </label>
        </div>
      </div>
    `;

    const card = createCollapsibleCard({
      rowId,
      headerContent,
      bodyContent,
      collapsed: isCollapsed,
      draggable: true
    });

    container.appendChild(card);
  });
}

/**
 * 从 UI 收集提示类型数据
 * @param {HTMLElement} root
 * @returns {Array}
 */
export function collectPromptTypes(root) {
  const container = root.querySelector('[data-ce-container="promptTypes"]');
  if (!container) return [];

  // 保存折叠状态
  collapsedSet = collectCollapsedState(container);

  const cards = container.querySelectorAll('.ce-collapsible-card');
  const list = [];

  cards.forEach((card) => {
    const nameEl = /** @type {HTMLInputElement|null} */ (card.querySelector('[data-ce-field="name"]'));
    if (!nameEl) return;
    const name = nameEl.value.trim();
    if (!name) return;

    const idEl = /** @type {HTMLInputElement|null} */ (card.querySelector('[data-ce-field="id"]'));
    const descEl = /** @type {HTMLInputElement|null} */ (card.querySelector('[data-ce-field="description"]'));
    const priorityEl = /** @type {HTMLInputElement|null} */ (card.querySelector('[data-ce-field="priority"]'));

    // 获取优先级，默认为 100
    let priority = 100;
    if (priorityEl) {
      const val = Number(priorityEl.value);
      if (!isNaN(val) && val >= 0 && val <= 9999) {
        priority = val;
      }
    }

    list.push({
      name,
      id: idEl?.value.trim() || "",
      description: descEl?.value.trim() || "",
      priority
    });
  });

  // 按优先级升序排序（数值越小优先级越高）
  list.sort((a, b) => a.priority - b.priority);

  return list;
}

/**
 * 提示类型面板点击事件处理
 * @param {MouseEvent} ev
 */
function onPromptTypePanelClick(ev) {
  const target = ev.target;
  if (!(target instanceof HTMLElement)) return;

  // 查找实际的操作按钮（可能点击的是图标）
  const actionBtn = target.closest('[data-ce-action]');
  const action = actionBtn?.dataset.ceAction;
  if (!action) return;

  const panel = target.closest('[data-tab-panel="promptTypes"]');
  if (!panel) return;

  if (action === "add-prompt-type") {
    addEmptyPromptTypeRow(panel);
  } else if (action === "delete-prompt-type") {
    const card = target.closest('.ce-collapsible-card');
    if (card && card.parentElement) {
      card.parentElement.removeChild(card);
    }
  } else if (action === "toggle-collapse") {
    const card = target.closest('.ce-collapsible-card');
    if (card) {
      toggleCollapse(card);
    }
  } else if (action === "expand-all-types") {
    const container = panel.querySelector('[data-ce-container="promptTypes"]');
    if (container) {
      expandAll(container);
      collapsedSet.clear();
    }
  } else if (action === "collapse-all-types") {
    const container = panel.querySelector('[data-ce-container="promptTypes"]');
    if (container) {
      collapseAll(container);
      // 收集所有卡片ID到折叠集合
      const cards = container.querySelectorAll('.ce-collapsible-card');
      cards.forEach((card, index) => {
        const rowId = card.dataset.rowId || String(index);
        collapsedSet.add(rowId);
      });
    }
  }
}

/**
 * 添加空的提示类型行
 * @param {HTMLElement} panel
 */
function addEmptyPromptTypeRow(panel) {
  const container = panel.querySelector('[data-ce-container="promptTypes"]');
  if (!container) return;

  const rowId = `type-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const headerContent = `
    <div class="ce-collapsible-header-content">
      <span class="ce-collapsible-title">（新提示类型）</span>
      <button type="button" class="ce-btn ce-btn-small" data-ce-action="delete-prompt-type" title="删除">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </div>
  `;

  const bodyContent = `
    <div class="ce-collapsible-body-content">
      <div class="ce-form-row-multi">
        <label>
          <span class="ce-form-label">名称：</span>
          <input type="text" data-ce-field="name" placeholder="例如：语气" />
        </label>
        <label>
          <span class="ce-form-label">内部ID：</span>
          <input type="text" data-ce-field="id" placeholder="留空则自动生成"/>
        </label>
      </div>
      <div class="ce-form-row-multi">
        <label>
          <span class="ce-form-label">说明：</span>
          <input type="text" data-ce-field="description" placeholder="对该提示类型的说明"/>
        </label>
        <label>
          <span class="ce-form-label">优先级：</span>
          <input type="number" value="100" data-ce-field="priority" min="0" max="9999" placeholder="0-9999，默认100" title="数值越小优先级越高，0最优先，9999最落后"/>
        </label>
      </div>
    </div>
  `;

  const card = createCollapsibleCard({
    rowId,
    headerContent,
    bodyContent,
    collapsed: false,
    draggable: true
  });

  container.appendChild(card);
}

/**
 * 获取折叠状态集合
 * @returns {Set<string>}
 */
export function getCollapsedSet() {
  return collapsedSet;
}

/**
 * 设置折叠状态集合
 * @param {Set<string>} set
 */
export function setCollapsedSet(set) {
  collapsedSet = set;
}