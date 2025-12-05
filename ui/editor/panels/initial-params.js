// 初始参数面板（卡片式）

import { escapeHtml } from "../utils/dom.js";
import { parseParameterBindings } from "../utils/parameter-binding-dialog.js";

/**
 * 初始化初始参数面板 DOM 结构
 * @param {HTMLElement} panel
 */
export function initInitialParamsPanel(panel) {
  panel.innerHTML = `
    <div class="ce-section-header">
      <span>初始参数设置</span>
    </div>
    <div class="ce-initial-params-container" data-ce-initial-params-root>
      <div class="ce-small-hint">
        使用说明：请先在「参数」Tab 中定义参数，在「实体」Tab 中为实体绑定参数名，之后切换回本页，
        为每个实体的已绑定参数设置开局初始值。这些初始值会作为本角色卡在每条新聊天中的基线状态。
      </div>
    </div>
  `;
  
  // 添加事件委托
  panel.addEventListener('click', handleInitialParamsClick);
  panel.addEventListener('change', handleInitialParamsChange);
}

/**
 * 渲染初始参数面板
 * @param {HTMLElement} panel - 初始参数面板元素
 * @param {import("../../../integration/card-storage.js").CeCharacterConfig} cfg - 配置对象
 * @param {Function} collectParametersFn - 收集参数的函数
 */
export function renderInitialParams(panel, cfg, collectParametersFn) {
  if (!panel) return;
  const container = /** @type {HTMLElement|null} */ (
    panel.querySelector("[data-ce-initial-params-root]")
  );
  if (!container) return;

  // 使用传入的函数收集最新的参数定义
  const parameters = typeof collectParametersFn === 'function'
    ? collectParametersFn()
    : (Array.isArray(cfg.parameters) ? cfg.parameters : []);
  const entities = Array.isArray(cfg.entities) ? cfg.entities : [];
  
  // 将参数定义存储到面板的 dataset 中，供事件处理函数使用
  panel.dataset.ceParametersCache = JSON.stringify(parameters);
  panel.dataset.ceEntitiesCache = JSON.stringify(entities);

  const initialState = cfg.initialState && typeof cfg.initialState === "object" 
    ? cfg.initialState 
    : {};

  const vars = initialState.variables && typeof initialState.variables === "object"
    ? initialState.variables
    : {};
  const buckets = {
    global: vars.global || {},
    character: vars.character || {},
    relationship: vars.relationship || {},
    scene: vars.scene || {}
  };

  if (!entities.length || !parameters.length) {
    container.innerHTML = `
      <div class="ce-small-hint">
        当前尚未配置实体或参数。请先在「参数」与「实体」Tab 中完成配置，然后再回到本页设置初始值。
      </div>
    `;
    return;
  }

  /** @type {Record<string, import("../../../core/variables.js").CeParameterDefinition>} */
  const paramDefsByName = {};
  parameters.forEach((p) => {
    if (!p || typeof p.name !== "string") return;
    const key = p.name.trim();
    if (!key) return;
    paramDefsByName[key] = p;
  });

  const cards = [];

  entities.forEach((ent) => {
    if (!ent || typeof ent.name !== "string") return;
    const entName = ent.name.trim();
    if (!entName) return;

    const boundNames = Array.isArray(ent.parameterNames)
      ? ent.parameterNames.map((n) => String(n || "").trim()).filter(Boolean)
      : [];

    if (!boundNames.length) {
      cards.push(`
        <div class="ce-initial-param-card">
          <div class="ce-initial-param-card-header">
            <span class="ce-initial-param-entity-name">${escapeHtml(entName)}</span>
            <span class="ce-collapsible-badge">无参数</span>
          </div>
          <div class="ce-initial-param-card-body">
            <div class="ce-small-hint">该实体当前未绑定任何参数，可在「实体」Tab 中为其绑定参数名。</div>
          </div>
        </div>
      `);
      return;
    }

    // 解析参数绑定
    const bindings = parseParameterBindings(boundNames.join(", "));
    
    // 按参数分组
    const paramGroups = new Map();
    bindings.forEach(binding => {
      if (!paramGroups.has(binding.paramName)) {
        paramGroups.set(binding.paramName, []);
      }
      paramGroups.get(binding.paramName).push(binding);
    });

    const paramRows = [];

    paramGroups.forEach((bindingList, paramName) => {
      const paramDef = paramDefsByName[paramName];
      if (!paramDef) return;

      const isRelationship = paramDef.scope === 'relationship';
      
      if (!isRelationship) {
        // 非关系型参数：直接显示一个输入框
        paramRows.push(buildNonRelationshipParamRow(paramDef, buckets, entName));
      } else {
        // 关系型参数：根据绑定类型显示不同UI
        const binding = bindingList[0]; // 取第一个绑定来判断类型
        
        if (binding.bindingType === 'specific') {
          // 具体目标绑定：显示每个目标的输入框
          paramRows.push(buildSpecificTargetParamRow(paramDef, binding, buckets, entities, entName));
        } else {
          // 全局或按类型绑定：显示可添加/删除的目标列表
          paramRows.push(buildDynamicTargetParamRow(paramDef, binding, buckets, entities, entName));
        }
      }
    });

    if (paramRows.length === 0) {
      cards.push(`
        <div class="ce-initial-param-card">
          <div class="ce-initial-param-card-header">
            <span class="ce-initial-param-entity-name">${escapeHtml(entName)}</span>
            <span class="ce-collapsible-badge">无有效参数</span>
          </div>
          <div class="ce-initial-param-card-body">
            <div class="ce-small-hint">该实体绑定的参数未在参数定义中找到。</div>
          </div>
        </div>
      `);
      return;
    }

    cards.push(`
      <div class="ce-initial-param-card" data-ce-entity="${escapeHtml(entName)}">
        <div class="ce-initial-param-card-header">
          <span class="ce-initial-param-entity-name">${escapeHtml(entName)}</span>
          <span class="ce-collapsible-badge">${paramGroups.size} 个参数</span>
        </div>
        <div class="ce-initial-param-card-body">
          ${paramRows.join("")}
        </div>
      </div>
    `);
  });

  container.innerHTML = cards.join("\n") || `
    <div class="ce-small-hint">
      当前实体均未绑定参数。请先在「实体」Tab 中为实体设置 parameterNames 后再回到本页。
    </div>
  `;
}

/**
 * 构建非关系型参数行
 */
function buildNonRelationshipParamRow(paramDef, buckets, entName) {
  const paramName = paramDef.name;
  const type = paramDef.type || "text";
  const desc = typeof paramDef.description === "string" ? paramDef.description.trim() : "";
  
  // 从嵌套结构读取值：character[entName][paramName] 或 global[paramName]
  let currentVal;
  if (paramDef.scope === 'character') {
    currentVal = buckets.character?.[entName]?.[paramName];
  } else if (paramDef.scope === 'scene') {
    currentVal = buckets.scene?.[paramName];
  } else {
    currentVal = buckets.global?.[paramName];
  }
  
  const controlHtml = buildInputControl(paramName, type, currentVal, paramDef, null, entName);
  
  const typeText = {
    number: "数值",
    boolean: "布尔",
    enum: "枚举",
    text: "文本"
  }[type] || type;

  return `
    <div class="ce-initial-param-row">
      <div class="ce-initial-param-name">
        <span class="ce-form-label">${escapeHtml(paramName)}</span>
        <span class="ce-collapsible-badge">${typeText}</span>
      </div>
      <div class="ce-initial-param-control">
        ${controlHtml}
      </div>
      ${desc ? `<div class="ce-initial-param-desc">${escapeHtml(desc)}</div>` : ''}
    </div>
  `;
}

/**
 * 构建具体目标绑定的关系型参数行
 */
function buildSpecificTargetParamRow(paramDef, binding, buckets, entities, entityName) {
  const paramName = paramDef.name;
  const type = paramDef.type || "text";
  const desc = typeof paramDef.description === "string" ? paramDef.description.trim() : "";
  
  const typeText = {
    number: "数值",
    boolean: "布尔",
    enum: "枚举",
    text: "文本"
  }[type] || type;

  const targetRows = binding.targets.map(target => {
    // 从嵌套结构读取：relationship[entityName][paramName][target]
    const currentVal = buckets.relationship?.[entityName]?.[paramName]?.[target];
    const controlHtml = buildInputControl(paramName, type, currentVal, paramDef, target, entityName);
    
    return `
      <div class="ce-initial-param-target-row">
        <span class="ce-initial-param-target-label">→ ${escapeHtml(target)}:</span>
        ${controlHtml}
      </div>
    `;
  }).join("");

  return `
    <div class="ce-initial-param-row ce-initial-param-relationship">
      <div class="ce-initial-param-name">
        <span class="ce-form-label">${escapeHtml(paramName)}</span>
        <span class="ce-collapsible-badge">${typeText}</span>
        <span class="ce-collapsible-badge">关系型</span>
      </div>
      <div class="ce-initial-param-targets">
        ${targetRows}
      </div>
      ${desc ? `<div class="ce-initial-param-desc">${escapeHtml(desc)}</div>` : ''}
    </div>
  `;
}

/**
 * 构建动态目标（全局/按类型）的关系型参数行
 */
function buildDynamicTargetParamRow(paramDef, binding, buckets, entities, currentEntityName) {
  const paramName = paramDef.name;
  const type = paramDef.type || "text";
  const desc = typeof paramDef.description === "string" ? paramDef.description.trim() : "";
  
  const typeText = {
    number: "数值",
    boolean: "布尔",
    enum: "枚举",
    text: "文本"
  }[type] || type;

  // 从嵌套结构读取：relationship[currentEntityName][paramName][target]
  const existingTargets = [];
  const entityRelationships = buckets.relationship?.[currentEntityName]?.[paramName];
  if (entityRelationships && typeof entityRelationships === 'object') {
    Object.keys(entityRelationships).forEach(target => {
      existingTargets.push({
        target,
        value: entityRelationships[target]
      });
    });
  }

  const targetRows = existingTargets.map(({ target, value }) => {
    const controlHtml = buildInputControl(paramName, type, value, paramDef, target, currentEntityName);
    
    return `
      <div class="ce-initial-param-target-row" data-ce-target="${escapeHtml(target)}">
        <span class="ce-initial-param-target-label">→ ${escapeHtml(target)}:</span>
        ${controlHtml}
        <button type="button" class="ce-btn ce-btn-small" 
                data-ce-action="remove-target" 
                data-ce-param="${escapeHtml(paramName)}"
                data-ce-target="${escapeHtml(target)}"
                title="删除">
          <i class="fa-solid fa-times"></i>
        </button>
      </div>
    `;
  }).join("");

  // 构建可选实体列表
  let availableEntities = entities;
  if (binding.bindingType === 'byType' && binding.targets.length > 0) {
    // 按类型过滤
    const targetType = binding.targets[0]; // "角色"、"地点"、"其他"
    const typeMap = { "角色": "character", "地点": "location", "其他": "other" };
    const filterType = typeMap[targetType];
    if (filterType) {
      availableEntities = entities.filter(e => e.type === filterType);
    }
  }

  // 排除已添加的目标和当前实体自己
  const usedTargets = new Set(existingTargets.map(t => t.target));
  usedTargets.add(currentEntityName); // 不能添加自己
  
  const entityOptions = availableEntities
    .filter(e => !usedTargets.has(e.name))
    .map(e => {
      const typeIcon = e.type === 'character' ? '👤' : e.type === 'location' ? '📍' : '📦';
      return `<option value="${escapeHtml(e.name)}">${typeIcon} ${escapeHtml(e.name)}</option>`;
    }).join("");

  const bindingTypeText = binding.bindingType === 'global' 
    ? '全局' 
    : `按类型: ${binding.targets.join(", ")}`;

  return `
    <div class="ce-initial-param-row ce-initial-param-relationship ce-initial-param-dynamic">
      <div class="ce-initial-param-name">
        <span class="ce-form-label">${escapeHtml(paramName)}</span>
        <span class="ce-collapsible-badge">${typeText}</span>
        <span class="ce-collapsible-badge">关系型</span>
        <span class="ce-collapsible-hint">${bindingTypeText}</span>
      </div>
      <div class="ce-initial-param-targets" data-ce-param="${escapeHtml(paramName)}">
        ${targetRows}
        <div class="ce-initial-param-add-target">
          <select data-ce-action="select-target" 
                  data-ce-param="${escapeHtml(paramName)}"
                  class="ce-param-binding-tag-select">
            <option value="">+ 添加目标实体</option>
            ${entityOptions}
          </select>
        </div>
      </div>
      ${desc ? `<div class="ce-initial-param-desc">${escapeHtml(desc)}</div>` : ''}
    </div>
  `;
}

/**
 * 构建输入控件
 */
function buildInputControl(paramName, type, currentVal, paramDef, target, entityName) {
  // 构建键：对于 character scope，使用 entityName.paramName 格式
  let key;
  if (target) {
    // 关系型参数：entityName.paramName.target
    key = entityName ? `${entityName}.${paramName}.${target}` : `${paramName}.${target}`;
  } else if (entityName && paramDef?.scope === 'character') {
    // 角色参数：entityName.paramName
    key = `${entityName}.${paramName}`;
  } else {
    // 其他：paramName
    key = paramName;
  }
  
  const dataAttrs = `data-ce-initial-param="value" data-ce-initial-param-key="${escapeHtml(key)}" data-ce-initial-param-type="${type}"`;
  
  if (type === "number") {
    const v = currentVal != null && currentVal !== "" ? String(currentVal) : "";
    return `
      <input type="number"
             ${dataAttrs}
             value="${escapeHtml(v)}"
             class="ce-input-number-small"
             placeholder="未设置"/>
    `;
  } else if (type === "boolean") {
    const v = currentVal === true ? "true" : currentVal === false ? "false" : "";
    return `
      <select ${dataAttrs}>
        <option value="">（未设置）</option>
        <option value="true"${v === "true" ? " selected" : ""}>true</option>
        <option value="false"${v === "false" ? " selected" : ""}>false</option>
      </select>
    `;
  } else if (type === "enum") {
    const enumValues = Array.isArray(paramDef.enumValues) ? paramDef.enumValues : [];
    const v = currentVal != null ? String(currentVal) : "";
    const optionsHtml = enumValues
      .map((ev) => {
        const val = String(ev);
        const selected = val === v ? " selected" : "";
        return `<option value="${escapeHtml(val)}"${selected}>${escapeHtml(val)}</option>`;
      })
      .join("");
    return `
      <select ${dataAttrs}>
        <option value="">（未设置）</option>
        ${optionsHtml}
      </select>
    `;
  } else {
    const v = currentVal != null ? String(currentVal) : "";
    return `
      <input type="text"
             ${dataAttrs}
             value="${escapeHtml(v)}"
             placeholder="未设置"/>
    `;
  }
}

/**
 * 处理点击事件
 */
function handleInitialParamsClick(ev) {
  const target = ev.target;
  if (!(target instanceof HTMLElement)) return;

  const actionBtn = target.closest('[data-ce-action]');
  if (!actionBtn) return;

  const action = actionBtn.dataset.ceAction;
  
  if (action === 'remove-target') {
    const paramName = actionBtn.dataset.ceParam;
    const targetName = actionBtn.dataset.ceTarget;
    
    if (paramName && targetName) {
      const row = actionBtn.closest('.ce-initial-param-target-row');
      if (row) {
        // 找到对应的下拉菜单
        const targetsContainer = row.closest('.ce-initial-param-targets');
        const selectElement = targetsContainer?.querySelector('[data-ce-action="select-target"]');
        
        // 清除对应的输入值
        const input = row.querySelector('[data-ce-initial-param="value"]');
        if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) {
          input.value = '';
          // 触发 change 事件以更新数据
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        
        // 移除行
        row.remove();
        
        // 将删除的目标重新添加回下拉菜单
        if (selectElement instanceof HTMLSelectElement) {
          // 获取缓存的实体列表
          const panel = selectElement.closest('[data-tab-panel="initialParams"]');
          if (panel) {
            try {
              const entitiesCache = panel.dataset.ceEntitiesCache;
              if (entitiesCache) {
                const entities = JSON.parse(entitiesCache);
                
                // 找到被删除的实体
                const entity = entities.find(e => e && e.name === targetName);
                if (entity) {
                  // 创建新的 option
                  const typeIcon = entity.type === 'character' ? '👤' : entity.type === 'location' ? '📍' : '📦';
                  const newOption = document.createElement('option');
                  newOption.value = targetName;
                  newOption.textContent = `${typeIcon} ${targetName}`;
                  
                  // 插入到下拉菜单中（保持排序）
                  const options = Array.from(selectElement.options);
                  let inserted = false;
                  for (let i = 1; i < options.length; i++) { // 从1开始，跳过"+ 添加目标实体"
                    if (options[i].value > targetName) {
                      selectElement.insertBefore(newOption, options[i]);
                      inserted = true;
                      break;
                    }
                  }
                  if (!inserted) {
                    selectElement.appendChild(newOption);
                  }
                }
              }
            } catch (e) {
              console.error('Failed to restore option to select:', e);
            }
          }
        }
      }
    }
  }
}

/**
 * 处理变更事件
 */
function handleInitialParamsChange(ev) {
  const target = ev.target;
  if (!(target instanceof HTMLElement)) return;

  const action = target.dataset.ceAction;
  
  if (action === 'select-target' && target instanceof HTMLSelectElement) {
    const paramName = target.dataset.ceParam;
    const targetName = target.value;
    
    if (paramName && targetName) {
      // 获取面板和缓存的参数定义
      const panel = target.closest('[data-tab-panel="initialParams"]');
      if (!panel) return;
      
      // 从缓存中获取参数定义
      let parameters = [];
      try {
        const cached = panel.dataset.ceParametersCache;
        if (cached) {
          parameters = JSON.parse(cached);
        }
      } catch (e) {
        console.error('Failed to parse parameters cache:', e);
        return;
      }
      
      // 查找参数定义
      const paramDef = parameters.find(p => p && p.name === paramName);
      if (!paramDef) return;
      
      // 获取目标容器
      const targetsContainer = target.closest('.ce-initial-param-targets');
      if (!targetsContainer) return;
      
      // 获取当前实体名称
      const card = target.closest('[data-ce-entity]');
      const entityName = card?.dataset.ceEntity || '';
      
      // 使用 buildInputControl 构建正确的输入控件
      const controlHtml = buildInputControl(paramName, paramDef.type || 'text', '', paramDef, targetName, entityName);
      
      // 创建新行
      const newRow = document.createElement('div');
      newRow.className = 'ce-initial-param-target-row';
      newRow.dataset.ceTarget = targetName;
      newRow.innerHTML = `
        <span class="ce-initial-param-target-label">→ ${escapeHtml(targetName)}:</span>
        ${controlHtml}
        <button type="button" class="ce-btn ce-btn-small"
                data-ce-action="remove-target"
                data-ce-param="${escapeHtml(paramName)}"
                data-ce-target="${escapeHtml(targetName)}"
                title="删除">
          <i class="fa-solid fa-times"></i>
        </button>
      `;
      
      // 插入到添加按钮之前
      const addTargetDiv = targetsContainer.querySelector('.ce-initial-param-add-target');
      if (addTargetDiv) {
        targetsContainer.insertBefore(newRow, addTargetDiv);
      }
      
      // 从下拉框中移除已选项
      const optionToRemove = target.querySelector(`option[value="${targetName}"]`);
      if (optionToRemove) {
        optionToRemove.remove();
      }
      
      // 重置选择
      target.value = '';
    }
  }
}

/**
 * 从初始参数页收集基线初始状态
 * @param {HTMLElement} root
 * @param {import("../../../core/variables.js").CeParameterDefinition[]} parameters
 * @param {any} lastLoadedInitialState
 * @returns {any} initialState 对象
 */
export function collectInitialState(root, parameters, lastLoadedInitialState) {
  /** @type {any} */
  const base = lastLoadedInitialState && typeof lastLoadedInitialState === "object"
    ? lastLoadedInitialState
    : {};

  const prevVars = base.variables && typeof base.variables === "object" ? base.variables : {};
  const newVars = {
    character: {},  // 重新构建为嵌套结构
    relationship: {},  // 重新构建为嵌套结构
    scene: { ...(prevVars.scene || {}) },
    global: { ...(prevVars.global || {}) }
  };

  /** @type {Record<string, import("../../../core/variables.js").CeParameterDefinition>} */
  const paramDefsByName = {};
  (parameters || []).forEach((p) => {
    if (!p) return;
    const name = typeof p.name === "string" ? p.name.trim() : "";
    if (!name) return;
    paramDefsByName[name] = p;
  });

  const inputs = root.querySelectorAll("[data-ce-initial-param='value']");
  inputs.forEach((el) => {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return;
    const key = el.dataset.ceInitialParamKey || "";
    if (!key) return;

    const typeAttr = el.dataset.ceInitialParamType || "";
    
    // 解析键：entityName.paramName 或 entityName.paramName.target
    const parts = key.split('.');
    if (parts.length < 2) {
      // 不符合嵌套格式，跳过（或作为 global/scene 处理）
      return;
    }
    
    const entityName = parts[0];
    const paramName = parts[1];
    const targetName = parts.length > 2 ? parts[2] : null;
    
    const paramDef = paramDefsByName[paramName];
    const effectiveType = typeAttr || (paramDef && paramDef.type) || "text";

    let rawVal = el.value;
    if (typeof rawVal !== "string") {
      rawVal = String(rawVal ?? "");
    }
    rawVal = rawVal.trim();

    /** @type {any} */
    let parsedVal = rawVal;

    // 对于关系型参数，即使值为空也要保存（保持目标的存在）
    // 对于非关系型参数，空字符串视为"未设置初始值"
    if (!rawVal && !targetName) {
      return;
    }

    if (effectiveType === "number") {
      if (!rawVal) {
        // 关系型参数允许空值，存储为 null
        parsedVal = null;
      } else {
        const n = Number(rawVal);
        if (Number.isNaN(n)) {
          return;
        }
        parsedVal = n;
      }
    } else if (effectiveType === "boolean") {
      if (rawVal === "true") {
        parsedVal = true;
      } else if (rawVal === "false") {
        parsedVal = false;
      } else if (!rawVal && targetName) {
        // 关系型参数允许空值，存储为 null
        parsedVal = null;
      } else {
        return;
      }
    } else {
      // text 和 enum 类型，关系型参数允许空字符串
      parsedVal = rawVal;
    }

    // 根据参数类型存储到嵌套结构
    if (targetName) {
      // 关系型参数：relationship[entityName][paramName][targetName]
      if (!newVars.relationship[entityName]) {
        newVars.relationship[entityName] = {};
      }
      if (!newVars.relationship[entityName][paramName]) {
        newVars.relationship[entityName][paramName] = {};
      }
      newVars.relationship[entityName][paramName][targetName] = parsedVal;
    } else if (paramDef?.scope === 'character') {
      // 角色参数：character[entityName][paramName]
      if (!newVars.character[entityName]) {
        newVars.character[entityName] = {};
      }
      newVars.character[entityName][paramName] = parsedVal;
    } else if (paramDef?.scope === 'scene') {
      // 场景参数：scene[paramName]
      newVars.scene[paramName] = parsedVal;
    } else {
      // 全局参数：global[paramName]
      newVars.global[paramName] = parsedVal;
    }
  });

  return {
    variables: newVars,
    scene: base.scene || {},
    cast: base.cast || {},
    entitiesRuntime: base.entitiesRuntime || {}
  };
}