// 参数绑定编辑器 - 卡片式列表版本（优化版）
// 用于在实体卡片内部展开的绑定列表管理

import { escapeHtml } from "./dom.js";
import {
  createCollapsibleCard,
  toggleCollapse,
  DragSortManager,
  setCollapsed,
  isCollapsed
} from "./collapsible-list.js";

/**
 * @typedef {Object} ParameterBinding
 * @property {string} paramName - 参数名称
 * @property {"specific"|"global"|"byType"} bindingType - 绑定类型
 * @property {string[]} targets - 目标列表（实体名或类型名）
 */

/**
 * 解析参数绑定字符串
 * 
 * 支持的格式：
 * - "好感度" → 全局绑定
 * - "好感度.上原惠" → 绑定到特定实体
 * - "好感度.角色" → 按类型绑定
 * - "好感度.上原惠, 好感度.安野" → 绑定到多个实体
 * 
 * @param {string} bindingStr - 绑定字符串
 * @returns {ParameterBinding[]}
 */
export function parseParameterBindings(bindingStr) {
  if (!bindingStr || typeof bindingStr !== "string") {
    return [];
  }

  const bindings = [];
  const bindingMap = new Map(); // paramName -> binding object

  // 按逗号分割
  const items = bindingStr.split(/[,\uFF0C]/).map(s => s.trim()).filter(Boolean);

  for (const item of items) {
    if (!item.includes('.')) {
      // 全局绑定：好感度
      if (!bindingMap.has(item)) {
        bindingMap.set(item, {
          paramName: item,
          bindingType: "global",
          targets: []
        });
      }
    } else {
      // 带目标的绑定：好感度.上原惠 或 好感度.角色
      const parts = item.split('.').map(s => s.trim());
      if (parts.length < 2) continue;

      const paramName = parts[0];
      const target = parts[1];

      if (!paramName || !target) continue;

      // 判断是类型还是实体
      const entityTypes = ["角色", "地点", "其他"];
      const isType = entityTypes.includes(target);

      if (!bindingMap.has(paramName)) {
        bindingMap.set(paramName, {
          paramName,
          bindingType: isType ? "byType" : "specific",
          targets: [target]
        });
      } else {
        const existing = bindingMap.get(paramName);
        
        // 如果已存在的是全局绑定，保持全局
        if (existing.bindingType === "global") {
          continue;
        }

        // 如果类型不匹配，转为specific并合并
        if (isType && existing.bindingType === "specific") {
          existing.bindingType = "specific";
        } else if (!isType && existing.bindingType === "byType") {
          existing.bindingType = "specific";
        }

        // 添加目标（去重）
        if (!existing.targets.includes(target)) {
          existing.targets.push(target);
        }
      }
    }
  }

  return Array.from(bindingMap.values());
}

/**
 * 构建参数绑定字符串
 * 
 * @param {ParameterBinding[]} bindings - 绑定对象数组
 * @returns {string}
 */
export function buildParameterBindingsString(bindings) {
  if (!Array.isArray(bindings) || bindings.length === 0) {
    return "";
  }

  const parts = [];

  for (const binding of bindings) {
    // 跳过未设置参数名的绑定
    if (!binding || !binding.paramName || binding.paramName.trim() === "") {
      continue;
    }

    if (binding.bindingType === "global") {
      parts.push(binding.paramName);
    } else if (Array.isArray(binding.targets) && binding.targets.length > 0) {
      for (const target of binding.targets) {
        parts.push(`${binding.paramName}.${target}`);
      }
    } else {
      // 如果没有目标，视为全局
      parts.push(binding.paramName);
    }
  }

  return parts.join(", ");
}

/**
 * 在实体卡片内部渲染参数绑定列表
 *
 * @param {HTMLElement} entityCard - 实体卡片元素
 * @param {string} currentValue - 当前绑定字符串
 * @param {Function} getAvailableParams - 获取可用参数列表的函数（返回参数对象数组）
 * @param {Array<{name: string, type: string}>} availableEntities - 可用实体列表
 * @param {Function} onUpdate - 更新回调 (newValue: string) => void
 */
export function renderParameterBindingList(entityCard, currentValue, getAvailableParams, availableEntities, onUpdate) {
  // 查找或创建绑定列表容器
  let container = entityCard.querySelector('[data-ce-binding-container]');
  
  if (!container) {
    // 在参数输入框后面插入容器
    const paramRow = entityCard.querySelector('[data-ce-field="parameterNames"]')?.closest('.ce-form-row-horizontal');
    if (!paramRow) return;

    container = document.createElement('div');
    container.className = 'ce-param-bindings-section';
    container.dataset.ceBindingContainer = '';
    container.innerHTML = `
      <div class="ce-param-bindings-header">
        <span class="ce-param-bindings-title">参数绑定详情</span>
        <div style="display: flex; gap: 4px;">
          <button type="button" class="ce-btn ce-btn-small" data-ce-binding-action="add">
            <i class="fa-solid fa-plus"></i> 新增绑定
          </button>
          <button type="button" class="ce-btn ce-btn-small" data-ce-binding-action="close">
            <i class="fa-solid fa-times"></i> 关闭
          </button>
        </div>
      </div>
      <div class="ce-param-bindings-list" data-ce-bindings-list></div>
    `;

    paramRow.parentElement?.insertBefore(container, paramRow.nextSibling);
  }

  // 解析当前绑定
  const bindings = parseParameterBindings(currentValue);

  // 渲染绑定列表
  const listContainer = container.querySelector('[data-ce-bindings-list]');
  if (!listContainer) return;

  renderBindingCards(listContainer, bindings, getAvailableParams, availableEntities);

  // 绑定事件
  wireBindingListEvents(container, bindings, getAvailableParams, availableEntities, onUpdate);

  // 显示容器
  container.style.display = 'block';
}

/**
 * 渲染绑定卡片列表
 */
function renderBindingCards(listContainer, bindings, getAvailableParams, availableEntities, newIndex = -1) {
  listContainer.innerHTML = '';

  if (bindings.length === 0) {
    listContainer.innerHTML = '<div class="ce-param-bindings-empty">暂无参数绑定，点击"新增绑定"开始添加</div>';
    return;
  }

  bindings.forEach((binding, index) => {
    const isNew = index === newIndex;
    const card = createBindingCard(binding, index, getAvailableParams, availableEntities, bindings, isNew);
    listContainer.appendChild(card);
  });

  // 初始化拖拽
  const dragManager = new DragSortManager(listContainer);
  dragManager.enable();
}

/**
 * 创建单个绑定卡片
 */
function createBindingCard(binding, index, getAvailableParams, availableEntities, allBindings, isNew = false) {
  const rowId = `binding-${index}`;
  
  // 获取参数列表（完整对象）
  const availableParams = typeof getAvailableParams === 'function'
    ? getAvailableParams()
    : (Array.isArray(getAvailableParams) ? getAvailableParams : []);
  
  // 查找当前参数的scope
  const currentParam = availableParams.find(p => p.name === binding.paramName);
  const isRelationshipParam = currentParam?.scope === 'relationship';
  
  // 绑定类型显示文本
  let typeText = "";
  let targetText = "";
  
  if (!binding.paramName) {
    typeText = "未设置";
    targetText = "请选择参数";
  } else if (!isRelationshipParam) {
    // 非关系型参数不显示目标类型
    typeText = "";
    targetText = "";
  } else if (binding.bindingType === "global") {
    typeText = "全局";
    targetText = "所有实体";
  } else if (binding.bindingType === "byType") {
    typeText = "按类型";
    targetText = binding.targets.join(", ");
  } else {
    typeText = "指定实体";
    targetText = binding.targets.length > 0 ? binding.targets.join(", ") : "未选择";
  }

  // 卡片头部内容 - 添加紧凑编辑控件
  const headerContent = buildBindingHeaderContent(binding, index, availableParams, typeText, targetText, allBindings);

  // 卡片主体内容
  const bodyContent = buildBindingCardBody(binding, index, availableParams, availableEntities);

  return createCollapsibleCard({
    rowId,
    headerContent,
    bodyContent,
    collapsed: !isNew,  // 新增的卡片默认展开
    draggable: true
  });
}

/**
 * 构建绑定卡片头部内容（包含紧凑编辑控件）
 */
function buildBindingHeaderContent(binding, index, availableParams, typeText, targetText, allBindings) {
  // 过滤掉已经被其他绑定使用的参数（但保留当前绑定的参数）
  const usedParamNames = new Set(
    allBindings
      .filter((b, i) => i !== index && b.paramName) // 排除当前绑定和空参数名
      .map(b => b.paramName)
  );
  
  const filteredParams = availableParams.filter(p =>
    !usedParamNames.has(p.name) || p.name === binding.paramName
  );
  
  const paramOptions = filteredParams.length > 0
    ? filteredParams.map(p =>
        `<option value="${escapeHtml(p.name)}"${p.name === binding.paramName ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
      ).join('')
    : '';

  return `
    <div class="ce-collapsible-header-content">
      <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
        <select data-ce-binding-field="paramName" data-index="${index}"
                class="ce-param-binding-select ce-param-binding-compact-select"
                title="选择要绑定的参数">
          <option value="">-- 请选择参数 --</option>
          ${paramOptions}
        </select>
        ${typeText ? `<span class="ce-collapsible-badge">${typeText}</span>` : ''}
        ${targetText ? `<span class="ce-collapsible-hint">${escapeHtml(targetText)}</span>` : ''}
      </div>
      <button type="button" class="ce-btn ce-btn-small" data-ce-binding-action="delete" data-index="${index}" title="删除">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </div>
  `;
}

/**
 * 构建绑定卡片的主体内容
 */
function buildBindingCardBody(binding, index, availableParams, availableEntities) {
  // 如果未选择参数，显示提示
  if (!binding.paramName) {
    return `
      <div class="ce-collapsible-body-content">
        <div class="ce-param-bindings-empty" style="padding: 12px; text-align: center; color: var(--SmartThemeQuoteColor);">
          <i class="fa-solid fa-arrow-up"></i> 请先在上方选择要绑定的参数
        </div>
      </div>
    `;
  }

  // 从参数定义获取scope
  const currentParam = availableParams.find(p => p.name === binding.paramName);
  const isRelationshipParam = currentParam?.scope === 'relationship';

  // 非关系型参数不显示目标类型选择
  if (!isRelationshipParam) {
    return `
      <div class="ce-collapsible-body-content">
        <div class="ce-param-bindings-empty" style="padding: 12px; text-align: center; color: var(--SmartThemeQuoteColor);">
          该参数不是关系型参数，无需设置参数目标实体
        </div>
      </div>
    `;
  }

  return `
    <div class="ce-collapsible-body-content">
      <div class="ce-form-row-horizontal">
        <label style="flex: 0 0 auto; min-width: 120px;">
          <span class="ce-form-label">目标类型：</span>
          <select data-ce-binding-type="${index}" data-index="${index}" class="ce-param-binding-select">
            <option value="global"${binding.bindingType === 'global' ? ' selected' : ''}>全局</option>
            <option value="byType"${binding.bindingType === 'byType' ? ' selected' : ''}>按类型</option>
            <option value="specific"${binding.bindingType === 'specific' ? ' selected' : ''}>指定实体</option>
          </select>
        </label>

        ${binding.bindingType === 'byType' ? `
          <label style="flex: 1;">
            <span class="ce-form-label">实体类型：</span>
            <select data-ce-binding-field="entityType" data-index="${index}" class="ce-param-binding-select">
              <option value="角色"${binding.targets.includes('角色') ? ' selected' : ''}>角色</option>
              <option value="地点"${binding.targets.includes('地点') ? ' selected' : ''}>地点</option>
              <option value="其他"${binding.targets.includes('其他') ? ' selected' : ''}>其他</option>
            </select>
          </label>
        ` : binding.bindingType === 'specific' ? `
          <div style="flex: 1;">
            <span class="ce-form-label">
              目标实体：
              <i class="fa-solid fa-info-circle" style="opacity: 0.6;" title="关系型参数提示：全局绑定对所有实体生效；按类型绑定对指定类型的所有实体生效；指定实体绑定仅对选中的实体生效。"></i>
            </span>
            <div class="ce-param-binding-tag-container" data-ce-binding-tags="${index}">
              ${buildEntityTags(binding.targets, availableEntities, index)}
            </div>
          </div>
        ` : '<div style="flex: 1;"></div>'}
      </div>
    </div>
  `;
}

/**
 * 构建实体标签（tag式多选）
 */
function buildEntityTags(selectedTargets, availableEntities, index) {
  const tags = selectedTargets.map(target => {
    const entity = availableEntities.find(e => e.name === target);
    const typeIcon = entity?.type === 'character' ? '👤' : entity?.type === 'location' ? '📍' : '📦';
    return `
      <span class="ce-param-binding-tag" data-entity="${escapeHtml(target)}">
        ${typeIcon} ${escapeHtml(target)}
        <i class="fa-solid fa-times" data-ce-remove-tag="${escapeHtml(target)}" data-index="${index}"></i>
      </span>
    `;
  }).join('');

  const availableOptions = availableEntities
    .filter(e => !selectedTargets.includes(e.name))
    .map(e => {
      const typeIcon = e.type === 'character' ? '👤' : e.type === 'location' ? '📍' : '📦';
      return `<option value="${escapeHtml(e.name)}">${typeIcon} ${escapeHtml(e.name)}</option>`;
    }).join('');

  return `
    ${tags}
    <select data-ce-add-tag="${index}" class="ce-param-binding-tag-select">
      <option value="">+ 添加实体</option>
      ${availableOptions}
    </select>
  `;
}

/**
 * 绑定列表事件
 */
function wireBindingListEvents(container, bindings, getAvailableParams, availableEntities, onUpdate) {
  // 点击事件
  container.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;

    const actionBtn = target.closest('[data-ce-binding-action]');
    const action = actionBtn?.dataset.ceBindingAction;

    if (action === 'add') {
      addNewBinding(container, bindings, getAvailableParams, availableEntities, onUpdate);
    } else if (action === 'delete') {
      const index = parseInt(actionBtn?.dataset.index || '-1');
      deleteBinding(container, bindings, index, getAvailableParams, availableEntities, onUpdate);
    } else if (action === 'close') {
      container.style.display = 'none';
    } else if (action === 'toggle-collapse') {
      const card = target.closest('.ce-collapsible-card');
      if (card) toggleCollapse(card);
    }
    
    // Tag删除事件
    const removeTag = target.dataset.ceRemoveTag;
    const removeIndex = parseInt(target.dataset.index || '-1');
    
    if (removeTag && removeIndex >= 0 && removeIndex < bindings.length) {
      bindings[removeIndex].targets = bindings[removeIndex].targets.filter(t => t !== removeTag);
      
      // 保存展开状态并重新渲染
      const listContainer = container.querySelector('[data-ce-bindings-list]');
      const expandedStates = saveExpandedStates(listContainer);
      renderBindingCards(listContainer, bindings, getAvailableParams, availableEntities);
      restoreExpandedStates(listContainer, expandedStates);
      
      onUpdate(buildParameterBindingsString(bindings));
    }
  });

  // 输入变更事件
  container.addEventListener('change', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;

    const field = target.dataset.ceBindingField;
    const index = parseInt(target.dataset.index || '-1');

    if (index >= 0 && index < bindings.length) {
      updateBinding(container, bindings, index, field, target, getAvailableParams, availableEntities, onUpdate);
    }

    // 绑定类型切换
    if (target.dataset.ceBindingType !== undefined) {
      const idx = parseInt(target.dataset.index || '-1');
      if (idx >= 0 && idx < bindings.length && target instanceof HTMLSelectElement) {
        bindings[idx].bindingType = target.value;
        
        // 根据新的绑定类型设置默认目标
        if (target.value === 'byType') {
          // 切换到"按类型"时，默认设置为"角色"
          bindings[idx].targets = ['角色'];
        } else {
          // 其他类型清空目标
          bindings[idx].targets = [];
        }
        
        // 保存当前展开状态
        const listContainer = container.querySelector('[data-ce-bindings-list]');
        const expandedStates = saveExpandedStates(listContainer);
        
        // 重新渲染
        if (listContainer) {
          renderBindingCards(listContainer, bindings, getAvailableParams, availableEntities);
          
          // 恢复展开状态
          restoreExpandedStates(listContainer, expandedStates);
          
          onUpdate(buildParameterBindingsString(bindings));
        }
      }
    }
    
    // Tag添加事件
    const addTagIndex = target.dataset.ceAddTag;
    if (addTagIndex !== undefined && target instanceof HTMLSelectElement) {
      const idx = parseInt(addTagIndex);
      const entityName = target.value;
      if (entityName && idx >= 0 && idx < bindings.length) {
        if (!bindings[idx].targets.includes(entityName)) {
          bindings[idx].targets.push(entityName);
          
          // 保存展开状态并重新渲染
          const listContainer = container.querySelector('[data-ce-bindings-list]');
          const expandedStates = saveExpandedStates(listContainer);
          renderBindingCards(listContainer, bindings, getAvailableParams, availableEntities);
          restoreExpandedStates(listContainer, expandedStates);
          
          onUpdate(buildParameterBindingsString(bindings));
        }
        target.value = '';
      }
    }
  });
}

/**
 * 添加新绑定
 */
function addNewBinding(container, bindings, getAvailableParams, availableEntities, onUpdate) {
  const newIndex = bindings.length;
  bindings.push({
    paramName: "",  // 默认未设置
    bindingType: 'global',
    targets: []
  });

  const listContainer = container.querySelector('[data-ce-bindings-list]');
  if (listContainer) {
    renderBindingCards(listContainer, bindings, getAvailableParams, availableEntities, newIndex);
    // 不立即更新文本框，等用户选择参数后再更新
  }
}

/**
 * 删除绑定
 */
function deleteBinding(container, bindings, index, getAvailableParams, availableEntities, onUpdate) {
  if (index >= 0 && index < bindings.length) {
    bindings.splice(index, 1);
    
    const listContainer = container.querySelector('[data-ce-bindings-list]');
    if (listContainer) {
      renderBindingCards(listContainer, bindings, getAvailableParams, availableEntities);
      onUpdate(buildParameterBindingsString(bindings));
    }
  }
}

/**
 * 更新绑定
 */
function updateBinding(container, bindings, index, field, target, getAvailableParams, availableEntities, onUpdate) {
  const binding = bindings[index];
  if (!binding) return;

  if (field === 'paramName' && target instanceof HTMLSelectElement) {
    const oldParamName = binding.paramName;
    binding.paramName = target.value;
    
    // 如果参数名改变，需要重新渲染卡片以更新展开内容
    if (oldParamName !== binding.paramName) {
      const listContainer = container.querySelector('[data-ce-bindings-list]');
      const expandedStates = saveExpandedStates(listContainer);
      renderBindingCards(listContainer, bindings, getAvailableParams, availableEntities);
      restoreExpandedStates(listContainer, expandedStates);
    }
    
    onUpdate(buildParameterBindingsString(bindings));
  } else if (field === 'entityType' && target instanceof HTMLSelectElement) {
    binding.targets = [target.value];
    onUpdate(buildParameterBindingsString(bindings));
  } else if (field === 'entities' && target instanceof HTMLSelectElement) {
    binding.targets = Array.from(target.selectedOptions).map(opt => opt.value);
    onUpdate(buildParameterBindingsString(bindings));
  }
}

/**
 * 保存展开状态
 */
function saveExpandedStates(listContainer) {
  const states = new Map();
  if (!listContainer) return states;
  
  const cards = listContainer.querySelectorAll('.ce-collapsible-card');
  cards.forEach((card, index) => {
    // 使用 isCollapsed 函数正确判断折叠状态
    // isCollapsed 返回 true 表示折叠，false 表示展开
    const isExpanded = !isCollapsed(card);
    states.set(index, isExpanded);
  });
  return states;
}

/**
 * 恢复展开状态
 */
function restoreExpandedStates(listContainer, states) {
  if (!listContainer) return;
  
  const cards = listContainer.querySelectorAll('.ce-collapsible-card');
  cards.forEach((card, index) => {
    const shouldExpand = states.get(index);
    // 使用 setCollapsed 函数正确设置展开/折叠状态
    // shouldExpand 为 true 表示应该展开，所以 collapsed 参数应该是 !shouldExpand
    setCollapsed(card, !shouldExpand);
  });
}

/**
 * 隐藏绑定列表
 */
export function hideParameterBindingList(entityCard) {
  const container = entityCard.querySelector('[data-ce-binding-container]');
  if (container) {
    container.style.display = 'none';
  }
}