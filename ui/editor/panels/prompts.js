// 提示条目面板（卡片式，包含分页、拖拽、折叠功能）

import { escapeHtml } from "../utils/dom.js";
import { parseConditions } from "../utils/validation.js";
import { formatConditions, buildParameterDefsByName } from "../utils/formatters.js";
import {
  createCollapsibleCard,
  toggleCollapse,
  DragSortManager,
  expandAll,
  collapseAll,
  collectCollapsedState,
  restoreCollapsedState
} from "../utils/collapsible-list.js";

// 分页相关状态
let promptPageSize = 25;
let promptCurrentPage = 1;

/** @type {DragSortManager|null} */
let dragManager = null;

/** @type {Set<string>} */
let collapsedSet = new Set();

/**
 * 初始化提示条目面板 DOM 结构
 * @param {HTMLElement} panel
 */
export function initPromptsPanel(panel) {
  panel.innerHTML = `
    <div class="ce-section-header">
      <span>提示条目（在参数条件满足时注入的文案）</span>
      <div style="display: flex; gap: 4px;">
        <button type="button" class="ce-btn ce-btn-small" data-ce-action="expand-all-prompts">全部展开</button>
        <button type="button" class="ce-btn ce-btn-small" data-ce-action="collapse-all-prompts">全部折叠</button>
        <button type="button" class="ce-btn ce-btn-small" data-ce-action="add-prompt-entry">新增提示条目</button>
      </div>
    </div>
    <div class="ce-prompts-pagination">
      <label>
        每页显示：
        <select data-ce-prompts-page-size>
          <option value="25" selected>25</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </label>
      <label>
        页码：
        <select data-ce-prompts-page-index></select>
      </label>
      <span class="ce-prompts-page-summary" data-ce-prompts-page-summary>共 0 条 / 0 页</span>
    </div>
    <div class="ce-prompts-toolbar">
      <label>归属实体（ownerName）：<input type="text" data-ce-filter-owner placeholder="例如：当前角色名"/></label>
      <button type="button" class="ce-btn ce-btn-small" data-ce-action="filter-prompts">筛选</button>
    </div>
    <div class="ce-prompts-container" data-ce-container="prompts"></div>
    <div class="ce-small-hint">参数条件格式示例：<code>好感度 >= 60</code>，支持多个条件。提示条目的整体排序决定了同一提示类型下文本的拼接顺序，支持拖拽上下调整。</div>
  `;

  panel.addEventListener("click", onPromptsPanelClick);
  panel.addEventListener("change", onPromptsPanelChange);
  panel.addEventListener("input", onPromptsPanelInput);

  // 初始化拖拽管理器
  const container = panel.querySelector('[data-ce-container="prompts"]');
  if (container) {
    dragManager = new DragSortManager(container);
    dragManager.enable();
  }

  // 绑定分页事件
  const paginationBar = panel.querySelector(".ce-prompts-pagination");
  if (paginationBar) {
    const sizeSelect = /** @type {HTMLSelectElement|null} */ (
      paginationBar.querySelector('[data-ce-prompts-page-size]')
    );
    const pageSelect = /** @type {HTMLSelectElement|null} */ (
      paginationBar.querySelector('[data-ce-prompts-page-index]')
    );

    if (sizeSelect) {
      sizeSelect.addEventListener("change", () => {
        const value = Number(sizeSelect.value) || 25;
        promptPageSize = value;
        promptCurrentPage = 1;
        refreshPromptPagination(panel);
      });
    }

    if (pageSelect) {
      pageSelect.addEventListener("change", () => {
        const value = Number(pageSelect.value) || 1;
        promptCurrentPage = value;
        refreshPromptPagination(panel);
      });
    }
  }
}

/**
 * 设置折叠状态集合
 * @param {Set<string>} set
 */
export function setCollapsedSet(set) {
  collapsedSet = set;
}

/**
 * 获取折叠状态集合
 * @returns {Set<string>}
 */
export function getCollapsedSet() {
  return collapsedSet;
}

/**
 * 更新所有提示条目卡片中的归属实体下拉菜单
 * @param {HTMLElement} root
 * @param {Function} getEntityNamesFn
 */
export function updateOwnerNameSelects(root, getEntityNamesFn) {
  const container = root.querySelector('[data-ce-container="prompts"]');
  if (!container) return;

  const entityNames = getEntityNamesFn();
  const cards = container.querySelectorAll('.ce-collapsible-card');

  cards.forEach((card) => {
    const select = /** @type {HTMLSelectElement|null} */ (
      card.querySelector('[data-ce-select="ownerName"]')
    );
    const input = /** @type {HTMLInputElement|null} */ (
      card.querySelector('[data-ce-field="ownerName"]')
    );
    
    if (!select || !input) return;

    const currentValue = input.value.trim();
    
    // 重建下拉选项
    const optionsHtml = entityNames
      .map((name) => {
        const selected = name === currentValue ? " selected" : "";
        return `<option value="${escapeHtml(name)}"${selected}>${escapeHtml(name)}</option>`;
      })
      .join("");
    
    select.innerHTML = `
      <option value="">（从已有记录选择）</option>
      ${optionsHtml}
    `;
  });
}

/**
 * 渲染提示条目数据
 * @param {HTMLElement} root
 * @param {Array} prompts
 * @param {Array} promptTypes
 * @param {Function} collectParametersFn
 * @param {Function} getEntityNamesFn
 */
export function renderPrompts(root, prompts, promptTypes, collectParametersFn, getEntityNamesFn) {
  const container = root.querySelector('[data-ce-container="prompts"]');
  if (!container) return;

  // 保存当前折叠状态
  const currentCollapsed = collectCollapsedState(container);
  if (currentCollapsed.size > 0) {
    collapsedSet = currentCollapsed;
  }

  container.innerHTML = "";

  const paramDefsByName = buildParameterDefsByName(collectParametersFn());

  // 收集已有的归属实体列表
  const ownerNameSet = new Set();
  (prompts || []).forEach((p) => {
    if (p && typeof p.ownerName === "string") {
      const v = p.ownerName.trim();
      if (v) ownerNameSet.add(v);
    }
  });
  const entityNamesForOwner = getEntityNamesFn();
  entityNamesForOwner.forEach((name) => {
    if (name) ownerNameSet.add(name);
  });
  const ownerNames = Array.from(ownerNameSet);

  // 收集已有的提示类型名称
  const promptTypeNameSet = new Set();
  (promptTypes || []).forEach((t) => {
    if (t && typeof t.name === "string") {
      const v = t.name.trim();
      if (v) promptTypeNameSet.add(v);
    }
  });
  (prompts || []).forEach((p) => {
    if (p && typeof p.promptTypeName === "string") {
      const v = p.promptTypeName.trim();
      if (v) promptTypeNameSet.add(v);
    }
  });
  const promptTypeNames = Array.from(promptTypeNameSet);

  (prompts || []).forEach((p, index) => {
    const rowId = `prompt-${index}`;
    const isCollapsed = collapsedSet.has(rowId) || collapsedSet.has(String(index));

    const ownerName = p.ownerName || "";
    const promptTypeName = p.promptTypeName || "";
    const conditionsText =
      typeof p.conditionsText === "string" && p.conditionsText.length > 0
        ? p.conditionsText
        : formatConditions(p.when || []);

    const { perLine, hasError, errorMessage, normalizedText } = parseConditions(
      conditionsText,
      paramDefsByName
    );
    const finalText = normalizedText || conditionsText;

    // 紧凑视图：显示归属实体、提示类型、条件摘要
    const conditionsSummary = finalText.split('\n').filter(Boolean).slice(0, 2).join('; ');
    const textPreview = (p.text || "").substring(0, 50) + ((p.text || "").length > 50 ? "..." : "");
    
    const headerContent = `
      <div class="ce-collapsible-header-content">
        <span class="ce-collapsible-title">${escapeHtml(ownerName || "（未命名）")}</span>
        <span class="ce-collapsible-badge">${escapeHtml(promptTypeName || "（无类型）")}</span>
        ${conditionsSummary ? `<span class="ce-collapsible-hint">${escapeHtml(conditionsSummary)}</span>` : ''}
        <button type="button" class="ce-btn ce-btn-small" data-ce-action="copy-prompt-entry" title="复制">
          <i class="fa-solid fa-copy"></i>
        </button>
        <button type="button" class="ce-btn ce-btn-small" data-ce-action="delete-prompt-entry" title="删除">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;

    // 构建下拉选择HTML
    const buildOwnerSelectHtml = (current) => {
      const optionsHtml = ownerNames
        .map((name) => {
          const selected = name === (current || "") ? " selected" : "";
          return `<option value="${escapeHtml(name)}"${selected}>${escapeHtml(name)}</option>`;
        })
        .join("");
      return `
        <select data-ce-select="ownerName">
          <option value="">（从已有记录选择）</option>
          ${optionsHtml}
        </select>
      `;
    };

    const buildPromptTypeSelectHtml = (current) => {
      const optionsHtml = promptTypeNames
        .map((name) => {
          const selected = name === (current || "") ? " selected" : "";
          return `<option value="${escapeHtml(name)}"${selected}>${escapeHtml(name)}</option>`;
        })
        .join("");
      return `
        <select data-ce-select="promptTypeName">
          <option value="">（从已有提示类型选择）</option>
          ${optionsHtml}
        </select>
      `;
    };

    // 展开视图：显示所有字段
    const errorClass = hasError ? " ce-input-error" : "";
    const errorTitle = hasError
      ? (errorMessage || "部分参数条件格式无法解析")
      : "";

    let errorListHtml = "";
    if (perLine && perLine.length) {
      const errorLines = perLine.filter((ln) => ln.hasError);
      if (errorLines.length) {
        errorListHtml = errorLines
          .map((ln) => {
            const label = `第 ${ln.index + 1} 行`;
            const reason = ln.reason || "该行条件格式无法解析";
            const raw = ln.raw.trim() || "(空行)";
            return `<div style="margin-top:2px;color:#ff9999;border-left:2px solid #e74c3c;padding-left:4px;font-size:0.75rem;">
              ${escapeHtml(label)}：${escapeHtml(raw)}（${escapeHtml(reason)}）
            </div>`;
          })
          .join("");
      }
    }

    const priority = typeof p.priority === 'number' ? p.priority : 100;

    const bodyContent = `
      <div class="ce-collapsible-body-content">
        <div class="ce-form-row-multi">
          <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
            <label style="display: flex; flex-direction: row; align-items: center; gap: 6px;">
              <span class="ce-form-label" style="white-space: nowrap;">归属实体：</span>
              <input type="text" value="${escapeHtml(ownerName)}" data-ce-field="ownerName" placeholder="例如：当前角色名或实体名" style="flex: 1;"/>
            </label>
            ${buildOwnerSelectHtml(ownerName)}
          </div>
          <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
            <label style="display: flex; flex-direction: row; align-items: center; gap: 6px;">
              <span class="ce-form-label" style="white-space: nowrap;">提示类型：</span>
              <input type="text" value="${escapeHtml(promptTypeName)}" data-ce-field="promptTypeName" placeholder="例如：语气" style="flex: 1;"/>
            </label>
            ${buildPromptTypeSelectHtml(promptTypeName)}
          </div>
        </div>
        <div class="ce-form-row-multi">
          <label style="flex: 3;">
            <span class="ce-form-label">参数条件（每行一个）：</span>
            <textarea data-ce-field="conditions" class="${errorClass.trim()}" title="${escapeHtml(errorTitle)}" rows="2" placeholder="每行一个条件，例如: 好感度 >= 60">${escapeHtml(finalText)}</textarea>
            ${errorListHtml ? `<div class="ce-conditions-error-list">${errorListHtml}</div>` : ''}
          </label>
          <label style="flex: 1;">
            <span class="ce-form-label">优先级：</span>
            <input type="number" value="${priority}" data-ce-field="priority" min="0" max="9999" placeholder="0-9999，默认100" title="数值越小优先级越高，0最优先，9999最落后"/>
          </label>
        </div>
        <div class="ce-form-row">
          <label>
            <span class="ce-form-label">提示文本：</span>
            <textarea data-ce-field="text" rows="3" placeholder="在此编写要注入给 LLM 的提示文本">${escapeHtml(p.text || "")}</textarea>
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

  promptCurrentPage = 1;
  refreshPromptPagination(root);
}

/**
 * 从 UI 收集提示条目数据
 * @param {HTMLElement} root
 * @param {Function} collectParametersFn
 * @returns {Array}
 */
export function collectPrompts(root, collectParametersFn) {
  const container = root.querySelector('[data-ce-container="prompts"]');
  if (!container) return [];

  // 保存折叠状态
  collapsedSet = collectCollapsedState(container);

  const cards = container.querySelectorAll('.ce-collapsible-card');
  const list = [];

  const paramDefsByName = buildParameterDefsByName(collectParametersFn());

  cards.forEach((card) => {
    const ownerEl = /** @type {HTMLInputElement|null} */ (card.querySelector('[data-ce-field="ownerName"]'));
    const typeEl = /** @type {HTMLInputElement|null} */ (card.querySelector('[data-ce-field="promptTypeName"]'));
    const condEl = /** @type {HTMLTextAreaElement|null} */ (card.querySelector('[data-ce-field="conditions"]'));
    const textEl = /** @type {HTMLTextAreaElement|null} */ (card.querySelector('[data-ce-field="text"]'));
    const priorityEl = /** @type {HTMLInputElement|null} */ (card.querySelector('[data-ce-field="priority"]'));

    const ownerName = ownerEl?.value.trim() || "";
    const promptTypeName = typeEl?.value.trim() || "";
    const rawConditionsText = condEl?.value || "";
    const text = textEl?.value || "";

    if (!ownerName || !promptTypeName || !text.trim()) {
      return;
    }

    const { conditions, perLine, hasError, errorMessage, normalizedText } = parseConditions(
      rawConditionsText,
      paramDefsByName
    );
    const conditionsText = normalizedText || rawConditionsText;

    // UI 标记
    if (condEl) {
      if (hasError) {
        condEl.classList.add("ce-input-error");
        condEl.title = errorMessage || "部分参数条件格式或取值不合法";
      } else {
        condEl.classList.remove("ce-input-error");
        condEl.removeAttribute("title");
      }
      condEl.value = conditionsText;
    }

    // 获取优先级，默认为 100
    let priority = 100;
    if (priorityEl) {
      const val = Number(priorityEl.value);
      if (!isNaN(val) && val >= 0 && val <= 9999) {
        priority = val;
      }
    }

    list.push({
      ownerName,
      promptTypeName,
      text,
      when: conditions,
      conditionsText,
      priority
    });
  });

  return list;
}

/**
 * 提示条目面板点击事件处理
 * @param {MouseEvent} ev
 */
function onPromptsPanelClick(ev) {
  const target = ev.target;
  if (!(target instanceof HTMLElement)) return;

  const actionBtn = target.closest('[data-ce-action]');
  const action = actionBtn?.dataset.ceAction;
  if (!action) return;

  const panel = target.closest('[data-tab-panel="prompts"]');
  if (!panel) return;

  if (action === "add-prompt-entry") {
    addEmptyPromptRow(panel);
  } else if (action === "copy-prompt-entry") {
    const card = target.closest('.ce-collapsible-card');
    if (card) {
      copyPromptEntry(panel, card);
    }
  } else if (action === "delete-prompt-entry") {
    const card = target.closest('.ce-collapsible-card');
    if (card && card.parentElement) {
      card.parentElement.removeChild(card);
      refreshPromptPagination(panel);
    }
  } else if (action === "toggle-collapse") {
    const card = target.closest('.ce-collapsible-card');
    if (card) {
      toggleCollapse(card);
    }
  } else if (action === "expand-all-prompts") {
    const container = panel.querySelector('[data-ce-container="prompts"]');
    if (container) {
      expandAll(container);
      collapsedSet.clear();
    }
  } else if (action === "collapse-all-prompts") {
    const container = panel.querySelector('[data-ce-container="prompts"]');
    if (container) {
      collapseAll(container);
      const cards = container.querySelectorAll('.ce-collapsible-card');
      cards.forEach((card, index) => {
        const rowId = card.dataset.rowId || String(index);
        collapsedSet.add(rowId);
      });
    }
  } else if (action === "filter-prompts") {
    applyPromptFilterFromUi(panel);
  }
}

/**
 * 提示条目面板 input 事件：实时更新卡片标题
 * @param {Event} ev
 */
function onPromptsPanelInput(ev) {
  const target = ev.target;
  // 检查是否是输入框
  if (!(target instanceof HTMLInputElement)) return;
  
  const field = target.dataset.ceField;
  if (!field) return;

  const card = target.closest('.ce-collapsible-card');
  if (!card) return;

  // 更新归属实体名称
  if (field === "ownerName") {
    const titleSpan = card.querySelector('.ce-collapsible-title');
    if (titleSpan) {
      const newName = target.value.trim();
      titleSpan.textContent = newName || "（未命名）";
    }
  }
  // 更新提示类型
  else if (field === "promptTypeName") {
    const badges = card.querySelectorAll('.ce-collapsible-badge');
    if (badges.length > 0) {
      const newType = target.value.trim();
      badges[0].textContent = newType || "（无类型）";
    }
  }
}

/**
 * 提示条目面板 change 事件：处理下拉菜单变更
 * @param {Event} ev
 */
function onPromptsPanelChange(ev) {
  const target = ev.target;
  if (!(target instanceof HTMLSelectElement)) return;
  const field = target.dataset.ceSelect;
  if (!field) return;

  const card = target.closest('.ce-collapsible-card');
  if (!card) return;
  const input = card.querySelector(`[data-ce-field="${field}"]`);
  if (input instanceof HTMLInputElement) {
    input.value = target.value;
    // 触发 input 事件以更新标题
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/**
 * 从面板中获取现有的实体名称列表
 * @param {HTMLElement} panel
 * @returns {string[]}
 */
function getExistingEntityNamesFromPanel(panel) {
  const root = panel.closest('.ce-modal');
  if (!root) return [];
  
  const entitiesPanel = root.querySelector('[data-tab-panel="entities"]');
  if (!entitiesPanel) return [];
  
  const cards = entitiesPanel.querySelectorAll('.ce-collapsible-card');
  const names = [];
  
  cards.forEach((card) => {
    const nameInput = card.querySelector('[data-ce-field="name"]');
    if (nameInput instanceof HTMLInputElement) {
      const name = nameInput.value.trim();
      if (name) names.push(name);
    }
  });
  
  return names;
}

/**
 * 从面板中获取现有的提示类型名称列表
 * @param {HTMLElement} panel
 * @returns {string[]}
 */
function getExistingPromptTypeNamesFromPanel(panel) {
  const root = panel.closest('.ce-modal');
  if (!root) return [];
  
  const typesPanel = root.querySelector('[data-tab-panel="promptTypes"]');
  if (!typesPanel) return [];
  
  const cards = typesPanel.querySelectorAll('.ce-collapsible-card');
  const names = [];
  
  cards.forEach((card) => {
    const nameInput = card.querySelector('[data-ce-field="name"]');
    if (nameInput instanceof HTMLInputElement) {
      const name = nameInput.value.trim();
      if (name) names.push(name);
    }
  });
  
  return names;
}

/**
 * 添加空的提示条目行
 * @param {HTMLElement} panel
 */
function addEmptyPromptRow(panel) {
  const container = panel.querySelector('[data-ce-container="prompts"]');
  if (!container) return;

  const rowId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  
  // 获取现有的实体名称和提示类型名称
  const entityNames = getExistingEntityNamesFromPanel(panel);
  const promptTypeNames = getExistingPromptTypeNamesFromPanel(panel);
  
  // 构建下拉选择HTML
  const buildOwnerSelectHtml = () => {
    const optionsHtml = entityNames
      .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
      .join("");
    return `
      <select data-ce-select="ownerName">
        <option value="">（从已有记录选择）</option>
        ${optionsHtml}
      </select>
    `;
  };

  const buildPromptTypeSelectHtml = () => {
    const optionsHtml = promptTypeNames
      .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
      .join("");
    return `
      <select data-ce-select="promptTypeName">
        <option value="">（从已有提示类型选择）</option>
        ${optionsHtml}
      </select>
    `;
  };

  const headerContent = `
    <div class="ce-collapsible-header-content">
      <span class="ce-collapsible-title">（新提示条目）</span>
      <span class="ce-collapsible-badge">（无类型）</span>
      <button type="button" class="ce-btn ce-btn-small" data-ce-action="copy-prompt-entry" title="复制">
        <i class="fa-solid fa-copy"></i>
      </button>
      <button type="button" class="ce-btn ce-btn-small" data-ce-action="delete-prompt-entry" title="删除">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </div>
  `;

  const bodyContent = `
    <div class="ce-collapsible-body-content">
      <div class="ce-form-row-multi">
        <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
          <label style="display: flex; flex-direction: row; align-items: center; gap: 6px;">
            <span class="ce-form-label" style="white-space: nowrap;">归属实体：</span>
            <input type="text" value="" data-ce-field="ownerName" placeholder="例如：当前角色名或实体名" style="flex: 1;"/>
          </label>
          ${buildOwnerSelectHtml()}
        </div>
        <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
          <label style="display: flex; flex-direction: row; align-items: center; gap: 6px;">
            <span class="ce-form-label" style="white-space: nowrap;">提示类型：</span>
            <input type="text" value="" data-ce-field="promptTypeName" placeholder="例如：语气" style="flex: 1;"/>
          </label>
          ${buildPromptTypeSelectHtml()}
        </div>
      </div>
      <div class="ce-form-row-multi">
        <label style="flex: 3;">
          <span class="ce-form-label">参数条件（每行一个）：</span>
          <textarea data-ce-field="conditions" rows="2" placeholder="每行一个条件，例如: 好感度 >= 60"></textarea>
        </label>
        <label style="flex: 1;">
          <span class="ce-form-label">优先级：</span>
          <input type="number" value="100" data-ce-field="priority" min="0" max="9999" placeholder="0-9999，默认100" title="数值越小优先级越高，0最优先，9999最落后"/>
        </label>
      </div>
      <div class="ce-form-row">
        <label>
          <span class="ce-form-label">提示文本：</span>
          <textarea data-ce-field="text" rows="3" placeholder="在此编写要注入给 LLM 的提示文本"></textarea>
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

  const cards = container.querySelectorAll('.ce-collapsible-card');
  const total = cards.length;
  const pageSize = promptPageSize > 0 ? promptPageSize : 25;
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
  promptCurrentPage = totalPages;
  refreshPromptPagination(panel);
}

/**
 * 复制提示条目
 * @param {HTMLElement} panel
 * @param {HTMLElement} sourceCard - 源卡片元素
 */
function copyPromptEntry(panel, sourceCard) {
  const container = panel.querySelector('[data-ce-container="prompts"]');
  if (!container) return;

  // 读取源卡片的所有字段值
  const getFieldValue = (field) => {
    const el = sourceCard.querySelector(`[data-ce-field="${field}"]`);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return el.value;
    }
    return "";
  };

  const ownerName = getFieldValue("ownerName");
  const promptTypeName = getFieldValue("promptTypeName");
  const conditions = getFieldValue("conditions");
  const text = getFieldValue("text");
  const priority = getFieldValue("priority") || "100";

  // 获取现有的实体名称和提示类型名称
  const entityNames = getExistingEntityNamesFromPanel(panel);
  const promptTypeNames = getExistingPromptTypeNamesFromPanel(panel);

  const rowId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // 构建下拉选择HTML
  const buildOwnerSelectHtml = () => {
    const optionsHtml = entityNames
      .map((name) => {
        const selected = name === ownerName ? " selected" : "";
        return `<option value="${escapeHtml(name)}"${selected}>${escapeHtml(name)}</option>`;
      })
      .join("");
    return `
      <select data-ce-select="ownerName">
        <option value="">（从已有记录选择）</option>
        ${optionsHtml}
      </select>
    `;
  };

  const buildPromptTypeSelectHtml = () => {
    const optionsHtml = promptTypeNames
      .map((name) => {
        const selected = name === promptTypeName ? " selected" : "";
        return `<option value="${escapeHtml(name)}"${selected}>${escapeHtml(name)}</option>`;
      })
      .join("");
    return `
      <select data-ce-select="promptTypeName">
        <option value="">（从已有提示类型选择）</option>
        ${optionsHtml}
      </select>
    `;
  };

  const headerContent = `
    <div class="ce-collapsible-header-content">
      <span class="ce-collapsible-title">${escapeHtml(ownerName || "（未命名）")} (副本)</span>
      <span class="ce-collapsible-badge">${escapeHtml(promptTypeName || "（无类型）")}</span>
      <button type="button" class="ce-btn ce-btn-small" data-ce-action="copy-prompt-entry" title="复制">
        <i class="fa-solid fa-copy"></i>
      </button>
      <button type="button" class="ce-btn ce-btn-small" data-ce-action="delete-prompt-entry" title="删除">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </div>
  `;

  const bodyContent = `
    <div class="ce-collapsible-body-content">
      <div class="ce-form-row-multi">
        <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
          <label style="display: flex; flex-direction: row; align-items: center; gap: 6px;">
            <span class="ce-form-label" style="white-space: nowrap;">归属实体：</span>
            <input type="text" value="${escapeHtml(ownerName)}" data-ce-field="ownerName" placeholder="例如：当前角色名或实体名" style="flex: 1;"/>
          </label>
          ${buildOwnerSelectHtml()}
        </div>
        <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
          <label style="display: flex; flex-direction: row; align-items: center; gap: 6px;">
            <span class="ce-form-label" style="white-space: nowrap;">提示类型：</span>
            <input type="text" value="${escapeHtml(promptTypeName)}" data-ce-field="promptTypeName" placeholder="例如：语气" style="flex: 1;"/>
          </label>
          ${buildPromptTypeSelectHtml()}
        </div>
      </div>
      <div class="ce-form-row-multi">
        <label style="flex: 3;">
          <span class="ce-form-label">参数条件（每行一个）：</span>
          <textarea data-ce-field="conditions" rows="2" placeholder="每行一个条件，例如: 好感度 >= 60">${escapeHtml(conditions)}</textarea>
        </label>
        <label style="flex: 1;">
          <span class="ce-form-label">优先级：</span>
          <input type="number" value="${escapeHtml(priority)}" data-ce-field="priority" min="0" max="9999" placeholder="0-9999，默认100" title="数值越小优先级越高，0最优先，9999最落后"/>
        </label>
      </div>
      <div class="ce-form-row">
        <label>
          <span class="ce-form-label">提示文本：</span>
          <textarea data-ce-field="text" rows="3" placeholder="在此编写要注入给 LLM 的提示文本">${escapeHtml(text)}</textarea>
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

  // 插入到源卡片的下方
  if (sourceCard.nextSibling) {
    container.insertBefore(card, sourceCard.nextSibling);
  } else {
    container.appendChild(card);
  }

  // 滚动到新卡片
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  refreshPromptPagination(panel);
}

/**
 * 应用筛选
 * @param {HTMLElement} panel
 */
function applyPromptFilterFromUi(panel) {
  promptCurrentPage = 1;
  refreshPromptPagination(panel);
}

/**
 * 刷新分页
 * @param {HTMLElement} panel
 */
function refreshPromptPagination(panel) {
  const container = panel.querySelector('[data-ce-container="prompts"]');
  const paginationBar = panel.querySelector(".ce-prompts-pagination");
  if (!container || !paginationBar) return;

  const sizeSelect = /** @type {HTMLSelectElement|null} */ (
    paginationBar.querySelector('[data-ce-prompts-page-size]')
  );
  const pageSelect = /** @type {HTMLSelectElement|null} */ (
    paginationBar.querySelector('[data-ce-prompts-page-index]')
  );
  const summaryEl = /** @type {HTMLElement|null} */ (
    paginationBar.querySelector('[data-ce-prompts-page-summary]')
  );

  if (sizeSelect) {
    const sizeVal = Number(sizeSelect.value) || 25;
    promptPageSize = sizeVal;
  }

  const filterInput = /** @type {HTMLInputElement|null} */ (
    panel.querySelector('[data-ce-filter-owner]')
  );
  const filter = (filterInput?.value || "").trim().toLowerCase();

  const allCards = Array.from(container.querySelectorAll('.ce-collapsible-card'));

  const items = allCards.map((card) => {
    const ownerEl = /** @type {HTMLInputElement|null} */ (
      card.querySelector('[data-ce-field="ownerName"]')
    );
    const ownerName = ownerEl?.value.trim().toLowerCase() || "";
    const matchesFilter = !filter || ownerName.includes(filter);
    return { card, matchesFilter };
  });

  const visibleItems = items.filter((item) => item.matchesFilter);
  const totalVisible = visibleItems.length;
  const pageSize = promptPageSize > 0 ? promptPageSize : 25;
  const totalPages = totalVisible > 0 ? Math.ceil(totalVisible / pageSize) : 1;

  if (promptCurrentPage < 1) promptCurrentPage = 1;
  if (promptCurrentPage > totalPages) promptCurrentPage = totalPages;

  if (pageSelect) {
    pageSelect.innerHTML = "";
    for (let i = 1; i <= totalPages; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = String(i);
      if (i === promptCurrentPage) {
        opt.selected = true;
      }
      pageSelect.appendChild(opt);
    }
  }

  if (summaryEl) {
    summaryEl.textContent = `共 ${totalVisible} 条 / ${totalPages} 页`;
  }

  // 先隐藏所有
  items.forEach(({ card }) => {
    card.style.display = "none";
  });

  // 只显示当前页
  visibleItems.forEach((item, index) => {
    const pageIndex = Math.floor(index / pageSize) + 1;
    if (pageIndex === promptCurrentPage) {
      item.card.style.display = "";
    }
  });
}