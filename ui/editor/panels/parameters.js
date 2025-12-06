// 参数面板

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
 * 初始化参数面板 DOM 结构
 * @param {HTMLElement} panel
 */
export function initParametersPanel(panel) {
  panel.innerHTML = `
    <div class="ce-section-header">
      <span>参数列表（定义可用于条件和解析）</span>
      <div style="display: flex; gap: 4px;">
        <button type="button" class="ce-btn ce-btn-small" data-ce-action="expand-all-params">全部展开</button>
        <button type="button" class="ce-btn ce-btn-small" data-ce-action="collapse-all-params">全部折叠</button>
        <button type="button" class="ce-btn ce-btn-small" data-ce-action="add-parameter">新增参数</button>
      </div>
    </div>
    <div class="ce-parameters-container" data-ce-container="parameters"></div>
  `;

  panel.addEventListener("click", onParameterPanelClick);
  panel.addEventListener("change", onParameterPanelChange);
  panel.addEventListener("input", onParameterPanelInput);

  // 初始化拖拽管理器
  const container = panel.querySelector('[data-ce-container="parameters"]');
  if (container) {
    dragManager = new DragSortManager(container);
    dragManager.enable();
  }
}

/**
 * 渲染参数数据
 * @param {HTMLElement} root
 * @param {Array} parameters
 */
export function renderParameters(root, parameters) {
  const container = root.querySelector('[data-ce-container="parameters"]');
  if (!container) return;

  // 保存当前折叠状态
  const currentCollapsed = collectCollapsedState(container);
  if (currentCollapsed.size > 0) {
    collapsedSet = currentCollapsed;
  }

  container.innerHTML = "";

  (parameters || []).forEach((p, index) => {
    const rowId = `param-${index}`;
    const isCollapsed = collapsedSet.has(rowId) || collapsedSet.has(String(index));

    const type = p.type || "number";
    const scope = p.scope || "character";

    // 类型显示文本
    const typeText = {
      number: "数值型",
      boolean: "布尔",
      enum: "枚举",
      text: "文本",
      array: "数组"
    }[type] || "数值型";

    // 作用域显示文本
    const scopeText = {
      character: "角色自身",
      relationship: "关系型",
      scene: "场景级",
      global: "全局"
    }[scope] || "角色自身";

    // 紧凑视图：显示名称、类型、作用域
    const headerContent = `
      <div class="ce-collapsible-header-content">
        <span class="ce-collapsible-title">${escapeHtml(p.name || "（未命名）")}</span>
        <span class="ce-collapsible-badge">${typeText}</span>
        <span class="ce-collapsible-badge">${scopeText}</span>
        <button type="button" class="ce-btn ce-btn-small" data-ce-action="delete-parameter" title="删除">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;

    // 展开视图：显示所有字段
    const bodyContent = buildParameterBodyContent(p, type, scope);

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
 * 构建参数卡片的主体内容
 * @param {any} p - 参数对象
 * @param {string} type - 参数类型
 * @param {string} scope - 参数作用域
 * @returns {string}
 */
function buildParameterBodyContent(p, type, scope) {
  let rangeCellHtml = "";
  if (type === "number") {
    const minVal = p.range && typeof p.range.min === "number" ? String(p.range.min) : "";
    const maxVal = p.range && typeof p.range.max === "number" ? String(p.range.max) : "";
    rangeCellHtml = `
      <label style="flex: 1; display: flex; align-items: center; gap: 6px;">
        <span class="ce-form-label" style="white-space: nowrap;">范围：</span>
        <div class="ce-range-row" style="flex: 1;">
          <input type="number" data-ce-field="rangeMin" value="${escapeHtml(minVal)}" placeholder="最小" class="ce-input-number-small" style="max-width: none; flex: 1;" />
          <span class="ce-range-sep">~</span>
          <input type="number" data-ce-field="rangeMax" value="${escapeHtml(maxVal)}" placeholder="最大" class="ce-input-number-small" style="max-width: none; flex: 1;" />
        </div>
      </label>
    `;
  } else if (type === "enum") {
    const enumStr = Array.isArray(p.enumValues) ? p.enumValues.join(",") : "";
    rangeCellHtml = `
      <label style="flex: 1; display: flex; align-items: center; gap: 6px;">
        <span class="ce-form-label" style="white-space: nowrap;">枚举值：</span>
        <input type="text" value="${escapeHtml(enumStr)}" data-ce-field="enumValues" placeholder="用逗号分隔" style="flex: 1;"/>
      </label>
    `;
  } else if (type === "boolean") {
    rangeCellHtml = `
      <div style="flex: 1; display: flex; align-items: center; gap: 6px;">
        <span class="ce-form-label" style="white-space: nowrap;">取值：</span>
        <span class="ce-param-boolean-hint">true / false</span>
      </div>
    `;
  } else if (type === "array") {
    const arrayConfig = p.arrayConfig || {};
    const itemType = arrayConfig.itemType || "string";
    const maxLength = arrayConfig.maxLength || "";
    rangeCellHtml = `
      <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
        <label style="display: flex; align-items: center; gap: 6px;">
          <span class="ce-form-label" style="white-space: nowrap;">元素类型：</span>
          <select data-ce-field="arrayItemType" style="flex: 1;">
            <option value="string"${itemType === "string" ? " selected" : ""}>字符串</option>
            <option value="number"${itemType === "number" ? " selected" : ""}>数值</option>
            <option value="boolean"${itemType === "boolean" ? " selected" : ""}>布尔</option>
            <option value="object"${itemType === "object" ? " selected" : ""}>对象</option>
          </select>
        </label>
        <label style="display: flex; align-items: center; gap: 6px;">
          <span class="ce-form-label" style="white-space: nowrap;">最大长度：</span>
          <input type="number" data-ce-field="arrayMaxLength" value="${escapeHtml(String(maxLength))}" placeholder="不限制" min="0" style="flex: 1;"/>
        </label>
      </div>
    `;
  } else {
    const textHint = typeof p.textHint === "string" ? p.textHint : "";
    rangeCellHtml = `
      <label style="flex: 1; display: flex; align-items: center; gap: 6px;">
        <span class="ce-form-label" style="white-space: nowrap;">说明：</span>
        <input type="text" value="${escapeHtml(textHint)}" data-ce-field="textHint" placeholder="文本参数说明" style="flex: 1;"/>
      </label>
    `;
  }

  return `
    <div class="ce-collapsible-body-content">
      <div class="ce-form-row-multi">
        <label style="flex: 1.5;">
          <span class="ce-form-label">名称：</span>
          <input type="text" value="${escapeHtml(p.name || "")}" data-ce-field="name" placeholder="参数名称" />
        </label>
        <label style="flex: 1;">
          <span class="ce-form-label">ID：</span>
          <input type="text" value="${escapeHtml(p.id || "")}" data-ce-field="id" placeholder="自动生成"/>
        </label>
        <label style="flex: 1;">
          <span class="ce-form-label">类型：</span>
          <select data-ce-field="type">
            <option value="number"${type === "number" ? " selected" : ""}>数值型</option>
            <option value="boolean"${type === "boolean" ? " selected" : ""}>布尔</option>
            <option value="enum"${type === "enum" ? " selected" : ""}>枚举</option>
            <option value="text"${type === "text" ? " selected" : ""}>文本</option>
            <option value="array"${type === "array" ? " selected" : ""}>数组</option>
          </select>
        </label>
        <label style="flex: 1;">
          <span class="ce-form-label">作用域：</span>
          <select data-ce-field="scope" title="character=角色自身参数，relationship=需要目标实体的参数，scene=场景级参数，global=全局参数">
            <option value="character"${scope === "character" ? " selected" : ""}>角色自身</option>
            <option value="relationship"${scope === "relationship" ? " selected" : ""}>关系型</option>
            <option value="scene"${scope === "scene" ? " selected" : ""}>场景级</option>
            <option value="global"${scope === "global" ? " selected" : ""}>全局</option>
          </select>
        </label>
      </div>
      <div class="ce-form-row-multi">
        <label style="flex: 2;">
          <span class="ce-form-label">说明：</span>
          <input type="text" value="${escapeHtml(p.description || "")}" data-ce-field="description" placeholder="参数说明"/>
        </label>
        <div data-ce-dynamic-field="rangeOrEnum" style="flex: 1.5; display: flex;">
          ${rangeCellHtml}
        </div>
      </div>
    </div>
  `;
}

/**
 * 从 UI 收集参数数据
 * @param {HTMLElement} root
 * @returns {Array}
 */
export function collectParameters(root) {
  const container = root.querySelector('[data-ce-container="parameters"]');
  if (!container) return [];

  // 保存折叠状态
  collapsedSet = collectCollapsedState(container);

  const cards = container.querySelectorAll('.ce-collapsible-card');
  const list = [];

  cards.forEach((card) => {
    const getInput = (field) =>
      /** @type {HTMLInputElement|null} */ (card.querySelector(`[data-ce-field="${field}"]`));

    const nameEl = getInput("name");
    if (!nameEl) return;
    const name = nameEl.value.trim();
    if (!name) return;

    const idEl = getInput("id");
    const typeEl = /** @type {HTMLSelectElement|null} */ (card.querySelector('[data-ce-field="type"]'));
    const scopeEl = /** @type {HTMLSelectElement|null} */ (card.querySelector('[data-ce-field="scope"]'));
    const descEl = getInput("description");

    const type = typeEl ? typeEl.value : "number";
    const scope = scopeEl ? scopeEl.value : "character";

    /** @type {any} */
    const param = {
      name,
      id: idEl?.value.trim() || "",
      type,
      scope,
      description: descEl?.value.trim() || ""
    };

    if (type === "number") {
      const minEl = getInput("rangeMin");
      const maxEl = getInput("rangeMax");
      const minStr = minEl?.value.trim() || "";
      const maxStr = maxEl?.value.trim() || "";
      /** @type {{min?: number, max?: number}} */
      const range = {};

      if (minStr !== "" && !Number.isNaN(Number(minStr))) {
        range.min = Number(minStr);
      }
      if (maxStr !== "" && !Number.isNaN(Number(maxStr))) {
        range.max = Number(maxStr);
      }

      if (Object.keys(range).length > 0) {
        param.range = range;
      }
    } else if (type === "enum") {
      const enumEl = getInput("enumValues");
      const rawEnum = (enumEl?.value || "").trim();
      if (rawEnum) {
        param.enumValues = rawEnum.split(/[,\uFF0C\/]/).map((s) => s.trim()).filter(Boolean);
      } else {
        param.enumValues = [];
      }
    } else if (type === "text") {
      const textHintEl = getInput("textHint");
      const hint = textHintEl?.value.trim() || "";
      if (hint) {
        param.textHint = hint;
      }
    } else if (type === "array") {
      const itemTypeEl = /** @type {HTMLSelectElement|null} */ (card.querySelector('[data-ce-field="arrayItemType"]'));
      const maxLengthEl = getInput("arrayMaxLength");
      
      const arrayConfig = {
        itemType: itemTypeEl?.value || "string"
      };
      
      const maxLengthStr = maxLengthEl?.value.trim() || "";
      if (maxLengthStr !== "" && !Number.isNaN(Number(maxLengthStr))) {
        const maxLen = Number(maxLengthStr);
        if (maxLen > 0) {
          arrayConfig.maxLength = maxLen;
        }
      }
      
      param.arrayConfig = arrayConfig;
    }

    list.push(param);
  });

  return list;
}

/**
 * 参数面板点击事件处理
 * @param {MouseEvent} ev
 */
function onParameterPanelClick(ev) {
  const target = ev.target;
  if (!(target instanceof HTMLElement)) return;

  const actionBtn = target.closest('[data-ce-action]');
  const action = actionBtn?.dataset.ceAction;
  if (!action) return;

  const panel = target.closest('[data-tab-panel="parameters"]');
  if (!panel) return;

  if (action === "add-parameter") {
    addEmptyParameterRow(panel);
  } else if (action === "delete-parameter") {
    const card = target.closest('.ce-collapsible-card');
    if (card && card.parentElement) {
      card.parentElement.removeChild(card);
    }
  } else if (action === "toggle-collapse") {
    const card = target.closest('.ce-collapsible-card');
    if (card) {
      toggleCollapse(card);
    }
  } else if (action === "expand-all-params") {
    const container = panel.querySelector('[data-ce-container="parameters"]');
    if (container) {
      expandAll(container);
      collapsedSet.clear();
    }
  } else if (action === "collapse-all-params") {
    const container = panel.querySelector('[data-ce-container="parameters"]');
    if (container) {
      collapseAll(container);
      const cards = container.querySelectorAll('.ce-collapsible-card');
      cards.forEach((card, index) => {
        const rowId = card.dataset.rowId || String(index);
        collapsedSet.add(rowId);
      });
    }
  }
}

/**
 * 参数面板 input 事件：实时更新卡片标题
 * @param {Event} ev
 */
function onParameterPanelInput(ev) {
  const target = ev.target;
  // 检查是否是输入框
  if (!(target instanceof HTMLInputElement)) return;
  
  const field = target.dataset.ceField;
  if (!field) return;

  const card = target.closest('.ce-collapsible-card');
  if (!card) return;

  // 更新名称
  if (field === "name") {
    const titleSpan = card.querySelector('.ce-collapsible-title');
    if (titleSpan) {
      const newName = target.value.trim();
      titleSpan.textContent = newName || "（未命名）";
    }
  }
}

/**
 * 参数面板 change 事件：当类型或作用域下拉框变更时，立即切换动态字段和更新徽章
 * @param {Event} ev
 */
function onParameterPanelChange(ev) {
  const target = ev.target;
  if (!(target instanceof HTMLSelectElement)) return;
  
  const field = target.dataset.ceField;
  if (field !== "type" && field !== "scope") return;

  const card = target.closest('.ce-collapsible-card');
  if (!card) return;

  // 更新徽章
  const badges = card.querySelectorAll('.ce-collapsible-badge');
  
  if (field === "type") {
    const dynamicField = /** @type {HTMLElement|null} */ (card.querySelector('[data-ce-dynamic-field="rangeOrEnum"]'));
    if (!dynamicField) return;

    const type = target.value || "number";

    // 更新类型徽章
    if (badges.length > 0) {
      const typeText = {
        number: "数值型",
        boolean: "布尔",
        enum: "枚举",
        text: "文本",
        array: "数组"
      }[type] || "数值型";
      badges[0].textContent = typeText;
    }

    if (type === "number") {
      dynamicField.innerHTML = `
        <label style="flex: 1; display: flex; align-items: center; gap: 6px;">
          <span class="ce-form-label" style="white-space: nowrap;">范围：</span>
          <div class="ce-range-row" style="flex: 1;">
            <input type="number" data-ce-field="rangeMin" placeholder="最小" class="ce-input-number-small" style="max-width: none; flex: 1;" />
            <span class="ce-range-sep">~</span>
            <input type="number" data-ce-field="rangeMax" placeholder="最大" class="ce-input-number-small" style="max-width: none; flex: 1;" />
          </div>
        </label>
      `;
    } else if (type === "enum") {
      dynamicField.innerHTML = `
        <label style="flex: 1; display: flex; align-items: center; gap: 6px;">
          <span class="ce-form-label" style="white-space: nowrap;">枚举值：</span>
          <input type="text" data-ce-field="enumValues" placeholder="用逗号分隔" style="flex: 1;"/>
        </label>
      `;
    } else if (type === "boolean") {
      dynamicField.innerHTML = `
        <div style="flex: 1; display: flex; align-items: center; gap: 6px;">
          <span class="ce-form-label" style="white-space: nowrap;">取值：</span>
          <span class="ce-param-boolean-hint">true / false</span>
        </div>
      `;
    } else if (type === "array") {
      dynamicField.innerHTML = `
        <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
          <label style="display: flex; align-items: center; gap: 6px;">
            <span class="ce-form-label" style="white-space: nowrap;">元素类型：</span>
            <select data-ce-field="arrayItemType" style="flex: 1;">
              <option value="string">字符串</option>
              <option value="number">数值</option>
              <option value="boolean">布尔</option>
              <option value="object">对象</option>
            </select>
          </label>
          <label style="display: flex; align-items: center; gap: 6px;">
            <span class="ce-form-label" style="white-space: nowrap;">最大长度：</span>
            <input type="number" data-ce-field="arrayMaxLength" placeholder="不限制" min="0" style="flex: 1;"/>
          </label>
        </div>
      `;
    } else if (type === "text") {
      dynamicField.innerHTML = `
        <label style="flex: 1; display: flex; align-items: center; gap: 6px;">
          <span class="ce-form-label" style="white-space: nowrap;">说明：</span>
          <input type="text" data-ce-field="textHint" placeholder="文本参数说明" style="flex: 1;"/>
        </label>
      `;
    }
  } else if (field === "scope") {
    // 更新作用域徽章
    const scope = target.value || "character";
    if (badges.length > 1) {
      const scopeText = {
        character: "角色自身",
        relationship: "关系型",
        scene: "场景级",
        global: "全局"
      }[scope] || "角色自身";
      badges[1].textContent = scopeText;
    }
  }
}

/**
 * 添加空的参数行
 * @param {HTMLElement} panel
 */
function addEmptyParameterRow(panel) {
  const container = panel.querySelector('[data-ce-container="parameters"]');
  if (!container) return;

  const rowId = `param-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const headerContent = `
    <div class="ce-collapsible-header-content">
      <span class="ce-collapsible-title">（新参数）</span>
      <span class="ce-collapsible-badge">数值型</span>
      <span class="ce-collapsible-badge">角色自身</span>
      <button type="button" class="ce-btn ce-btn-small" data-ce-action="delete-parameter" title="删除">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </div>
  `;

  const bodyContent = `
    <div class="ce-collapsible-body-content">
      <div class="ce-form-row-multi">
        <label style="flex: 1.5;">
          <span class="ce-form-label">名称：</span>
          <input type="text" data-ce-field="name" placeholder="参数名称" />
        </label>
        <label style="flex: 1;">
          <span class="ce-form-label">ID：</span>
          <input type="text" data-ce-field="id" placeholder="自动生成"/>
        </label>
        <label style="flex: 1;">
          <span class="ce-form-label">类型：</span>
          <select data-ce-field="type">
            <option value="number">数值型</option>
            <option value="boolean">布尔</option>
            <option value="enum">枚举</option>
            <option value="text">文本</option>
            <option value="array">数组</option>
          </select>
        </label>
        <label style="flex: 1;">
          <span class="ce-form-label">作用域：</span>
          <select data-ce-field="scope" title="character=角色自身参数，relationship=需要目标实体的参数，scene=场景级参数，global=全局参数">
            <option value="character" selected>角色自身</option>
            <option value="relationship">关系型</option>
            <option value="scene">场景级</option>
            <option value="global">全局</option>
          </select>
        </label>
      </div>
      <div class="ce-form-row-multi">
        <label style="flex: 2;">
          <span class="ce-form-label">说明：</span>
          <input type="text" data-ce-field="description" placeholder="参数说明"/>
        </label>
        <div data-ce-dynamic-field="rangeOrEnum" style="flex: 1.5; display: flex;">
          <label style="flex: 1; display: flex; align-items: center; gap: 6px;">
            <span class="ce-form-label" style="white-space: nowrap;">范围：</span>
            <div class="ce-range-row" style="flex: 1;">
              <input type="number" data-ce-field="rangeMin" placeholder="最小" class="ce-input-number-small" style="max-width: none; flex: 1;" />
              <span class="ce-range-sep">~</span>
              <input type="number" data-ce-field="rangeMax" placeholder="最大" class="ce-input-number-small" style="max-width: none; flex: 1;" />
            </div>
          </label>
        </div>
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