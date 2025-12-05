// 实体面板

import { escapeHtml } from "../utils/dom.js";
import { buildNormalizedEntities } from "../../../core/entities.js";
import { getUserName, getUserPersonaDescription } from "../../../integration/st-context.js";
import {
  createCollapsibleCard,
  toggleCollapse,
  DragSortManager,
  expandAll,
  collapseAll,
  collectCollapsedState,
  restoreCollapsedState
} from "../utils/collapsible-list.js";
import { renderParameterBindingList, hideParameterBindingList } from "../utils/parameter-binding-dialog.js";

/** @type {DragSortManager|null} */
let dragManager = null;

/** @type {Set<string>} */
let collapsedSet = new Set();

/**
 * 初始化实体面板 DOM 结构
 * @param {HTMLElement} panel
 */
export function initEntitiesPanel(panel) {
  panel.innerHTML = `
    <div class="ce-section-header">
      <span>实体列表（角色 / 地点 / 其他实体）</span>
      <div style="display: flex; gap: 4px;">
        <button type="button" class="ce-btn ce-btn-small" data-ce-action="expand-all-entities">全部展开</button>
        <button type="button" class="ce-btn ce-btn-small" data-ce-action="collapse-all-entities">全部折叠</button>
        <button type="button" class="ce-btn ce-btn-small" data-ce-action="add-entity">新增实体</button>
      </div>
    </div>
    <div class="ce-entities-container" data-ce-container="entities"></div>
    <div class="ce-small-hint">
      说明：
      <ul>
        <li>类型为「地点」的实体：可以配置子地点（地点层级嵌套）和常见场景角色。</li>
        <li>类型为「角色」的实体：可以配置常见地点。</li>
        <li>类型为「其他」的实体：不参与层级嵌套和结构关联，仅作为提示归属占位使用。</li>
        <li>可以为任意实体绑定参数名（与「参数」Tab 中名称一致），用于在「初始参数」页为其设置开局初始值。</li>
        <li>除「地点下人物」这一特殊关系外，不存在其他实体间结构关联。</li>
      </ul>
    </div>
  `;

  panel.addEventListener("click", onEntityPanelClick);
  panel.addEventListener("change", onEntityPanelChange);
  panel.addEventListener("input", onEntityPanelInput);

  // 初始化拖拽管理器
  const container = panel.querySelector('[data-ce-container="entities"]');
  if (container) {
    dragManager = new DragSortManager(container);
    dragManager.enable();
  }
}

/**
 * 渲染实体数据
 * @param {HTMLElement} root
 * @param {import("../../../core/entities.js").CeEntityDefinition[]} entities
 */
export function renderEntities(root, entities) {
  const container = root.querySelector('[data-ce-container="entities"]');
  if (!container) return;

  // 保存当前折叠状态
  const currentCollapsed = collectCollapsedState(container);
  if (currentCollapsed.size > 0) {
    collapsedSet = currentCollapsed;
  }

  container.innerHTML = "";

  // 确保 {{user}} 实体存在，如果不存在则自动创建
  let entitiesList = Array.isArray(entities) ? [...entities] : [];
  let userEntity = entitiesList.find(e => e.name === "{{user}}");
  
  if (!userEntity) {
    // 自动创建 {{user}} 实体
    const userName = getUserName();
    const userDescription = getUserPersonaDescription();
    userEntity = {
      name: "{{user}}",
      id: "__user__",
      type: "character",
      baseinfo: userDescription,
      childrenNames: [],
      locations: [],
      characters: [],
      parameterNames: [],
      summaryForSupporting: "",
      tagsForSupporting: [],
      descForOffstage: ""
    };
    entitiesList.unshift(userEntity);
  } else {
    // 强制更新 {{user}} 实体的关键属性（从 ST Persona 同步）
    const userDescription = getUserPersonaDescription();
    userEntity.baseinfo = userDescription;
    userEntity.type = "character";
    userEntity.id = "__user__";
  }

  // 将 {{user}} 实体置顶
  const otherEntities = entitiesList.filter(e => e.name !== "{{user}}");
  const sortedEntities = [userEntity, ...otherEntities];

  sortedEntities.forEach((e, index) => {
    const rowId = `entity-${index}`;
    const isCollapsed = collapsedSet.has(rowId) || collapsedSet.has(String(index));
    
    // 检查是否为 {{user}} 特殊实体
    const isUserEntity = e.name === "{{user}}";

    const type =
      e && (e.type === "character" || e.type === "location" || e.type === "other")
        ? e.type
        : "other";

    // 类型显示文本
    const typeText = {
      character: "角色",
      location: "地点",
      other: "其他"
    }[type] || "其他";

    // 紧凑视图：显示名称和类型
    // {{user}} 实体不显示复制和删除按钮，并添加特殊标记
    const headerContent = `
      <div class="ce-collapsible-header-content">
        <span class="ce-collapsible-title">${escapeHtml(e.name || "（未命名）")}</span>
        <span class="ce-collapsible-badge">${typeText}</span>
        ${isUserEntity ? '<span class="ce-collapsible-badge" style="background: #4a9eff;">系统</span>' : ''}
        ${!isUserEntity ? `<button type="button" class="ce-btn ce-btn-small" data-ce-action="copy-entity" title="复制">
          <i class="fa-solid fa-copy"></i>
        </button>
        <button type="button" class="ce-btn ce-btn-small" data-ce-action="delete-entity" title="删除">
          <i class="fa-solid fa-trash-can"></i>
        </button>` : ''}
      </div>
    `;

    // 展开视图：显示所有字段
    const bodyContent = buildEntityBodyContent(e, type, isUserEntity);

    const card = createCollapsibleCard({
      rowId,
      headerContent,
      bodyContent,
      collapsed: isCollapsed,
      draggable: !isUserEntity  // {{user}} 实体不可拖拽
    });
    
    // 为 {{user}} 实体添加特殊样式
    if (isUserEntity) {
      card.style.border = "2px solid #4a9eff";
      card.style.backgroundColor = "rgba(74, 158, 255, 0.05)";
    }

    container.appendChild(card);
  });
}

/**
 * 构建实体卡片的主体内容
 * @param {import("../../../core/entities.js").CeEntityDefinition} e - 实体对象
 * @param {string} type - 实体类型
 * @param {boolean} isUserEntity - 是否为 {{user}} 特殊实体
 * @returns {string}
 */
function buildEntityBodyContent(e, type, isUserEntity = false) {
  const childrenStr = Array.isArray(e.childrenNames) ? e.childrenNames.join(",") : "";
  const locationsStr = Array.isArray(e.locations) ? e.locations.join(",") : "";
  const charactersStr = Array.isArray(e.characters) ? e.characters.join(",") : "";
  
  // 过滤掉内置的短期情绪/意图参数（对用户隐藏）
  const visibleParamNames = Array.isArray(e.parameterNames)
    ? e.parameterNames.filter(name => {
        const nameLower = (name || "").toLowerCase();
        return !nameLower.includes("短期情绪") &&
               !nameLower.includes("短期意图") &&
               nameLower !== "short_term_emotion" &&
               nameLower !== "short_term_intent";
      })
    : [];
  const paramNamesStr = visibleParamNames.join(",");

  let relationsHtml = "";
  if (type === "character") {
    relationsHtml = `
      <div class="ce-form-row-horizontal">
        <label>
          <span class="ce-form-label">常见地点：</span>
          <input type="text" data-ce-field="locations" value="${escapeHtml(locationsStr)}" placeholder="例如：东京.爱知学院.3年E班" />
        </label>
      </div>
    `;
  } else if (type === "location") {
    relationsHtml = `
      <div class="ce-form-row-horizontal">
        <label>
          <span class="ce-form-label">子地点：</span>
          <input type="text" data-ce-field="childrenNames" value="${escapeHtml(childrenStr)}" placeholder="例如：爱知学院.3年E班" />
        </label>
      </div>
      <div class="ce-form-row-horizontal">
        <label>
          <span class="ce-form-label">常见角色：</span>
          <input type="text" data-ce-field="characters" value="${escapeHtml(charactersStr)}" placeholder="例如：上原惠, 安野" />
        </label>
      </div>
    `;
  } else {
    relationsHtml = `
      <div class="ce-form-row">
        <span class="ce-small-hint">该类型不参与层级嵌套和结构关联。</span>
      </div>
    `;
  }

  // Cast 分层字段（仅对角色类型显示）
  let castLayersHtml = "";
  if (type === "character") {
    const summaryForSupporting = e.summaryForSupporting || "";
    const tagsForSupporting = Array.isArray(e.tagsForSupporting)
      ? e.tagsForSupporting.join(",")
      : "";
    const descForOffstage = e.descForOffstage || "";

    castLayersHtml = `
      <div class="ce-entity-cast-section">
        <div class="ce-small-hint" style="margin-bottom:8px;">
          <strong>角色出场分层设置</strong>：根据角色在场景中的重要程度，自动加载不同详细度的人设信息，节省 token 并提升性能。
        </div>
        <div class="ce-form-row">
          <label title="当角色作为配角在场时（不是主要互动对象），只加载这段简短摘要，而不是完整人设。适合多角色场景。如果留空则自动使用上面的基础人设提示词作为简短人设">
            <span class="ce-form-label">作为配角在场时的简短人设（1-3 句话概括核心特征）：</span>
            <textarea data-ce-field="summaryForSupporting" rows="2" placeholder="例如：上原惠，17岁女高中生，性格傲娇但内心温柔，身材高挑，黑发蓝眼睛">${escapeHtml(summaryForSupporting)}</textarea>
          </label>
        </div>
        <div class="ce-form-row">
          <label title="当角色作为配角在场时，用这些关键词标签快速说明角色身份和关系，比完整人设更简洁。">
            <span class="ce-form-label">作为配角在场时的关键标签（逗号分隔，如身份、性格、关系）：</span>
            <input type="text" data-ce-field="tagsForSupporting" value="${escapeHtml(tagsForSupporting)}" placeholder="例如：同班同学, 傲娇, 学习委员"/>
          </label>
        </div>
        <div class="ce-form-row">
          <label title="当角色不在场但可能被提及时（如"她的朋友上原惠"），只用这一句话说明角色是谁，完全不加载人设。">
            <span class="ce-form-label">不在场但可提及时的一句话介绍：</span>
            <input type="text" data-ce-field="descForOffstage" value="${escapeHtml(descForOffstage)}" placeholder="例如：上原惠 —— {{user}}的同班同学，暧昧对象，性格傲娇"/>
          </label>
        </div>
      </div>
    `;
  }

  // {{user}} 实体的特殊提示（深色背景浅色字体）
  const userEntityNotice = isUserEntity ? `
    <div class="ce-small-hint" style="background: #2c3e50; color: #ecf0f1; padding: 8px; border-radius: 4px; margin-bottom: 12px;">
      <strong>💡 {{user}} 是特殊的系统实体</strong><br>
      • 名称固定为 "{{user}}"，在对话中会自动替换为当前用户名称<br>
      • 基础提示词自动同步自 SillyTavern 的用户 Persona 描述<br>
      • 类型固定为"角色"，不可修改<br>
      • 此实体不可删除，且始终置顶显示
    </div>
  ` : '';

  return `
    <div class="ce-collapsible-body-content">
      ${userEntityNotice}
      <div class="ce-form-row-multi">
        <label style="flex: 2;">
          <span class="ce-form-label">名称：</span>
          <input type="text" data-ce-field="name" value="${escapeHtml(e.name || "")}" placeholder="实体名称，如：上原惠 或 东京.爱知学院" ${isUserEntity ? 'readonly title="{{user}} 实体名称不可修改"' : ''} />
        </label>
        <label style="flex: 1;">
          <span class="ce-form-label">类型：</span>
          <select data-ce-field="type" ${isUserEntity ? 'disabled title="{{user}} 实体类型固定为角色"' : ''}>
            <option value="character"${type === "character" ? " selected" : ""}>角色</option>
            <option value="location"${type === "location" ? " selected" : ""}>地点</option>
            <option value="other"${type === "other" ? " selected" : ""}>其他</option>
          </select>
        </label>
        <label style="flex: 1;">
          <span class="ce-form-label">ID：</span>
          <input type="text" data-ce-field="id" value="${isUserEntity ? '__user__' : escapeHtml(e.id || "")}" placeholder="可选" ${isUserEntity ? 'readonly title="{{user}} 实体 ID 固定为 __user__"' : ''}/>
        </label>
      </div>
      ${!isUserEntity ? `<div data-ce-dynamic-field="relations">
        ${relationsHtml}
      </div>` : ''}
      <div class="ce-form-row-horizontal">
        <label style="flex: 1;">
          <span class="ce-form-label">绑定参数：</span>
          <div style="display: flex; gap: 4px; align-items: center;">
            <button type="button" class="ce-btn ce-btn-small ce-param-binding-btn"
                    data-ce-action="open-param-binding" title="打开参数绑定编辑器">
              <i class="fa-solid fa-link"></i>
            </button>
            <input type="text" data-ce-field="parameterNames"
                   value="${escapeHtml(paramNamesStr)}"
                   placeholder="例如：好感度.上原惠, 信任度"
                   style="flex: 1;" />
          </div>
        </label>
      </div>
      <div class="ce-form-row">
        <label>
          <span class="ce-form-label">基础提示词（用于 baseinfo）${isUserEntity ? '（自动同步自 ST Persona）' : ''}：</span>
          <textarea data-ce-field="baseinfo" rows="2" placeholder="${isUserEntity ? '此内容自动从 SillyTavern 用户 Persona 同步' : '该实体的基础提示词'}" ${isUserEntity ? 'readonly title="{{user}} 的基础提示词自动同步自 SillyTavern 的 Persona 描述，请在 ST 中修改"' : ''}>${escapeHtml(e.baseinfo || "")}</textarea>
        </label>
      </div>
      ${!isUserEntity ? `<div data-ce-dynamic-field="castLayers">
        ${castLayersHtml}
      </div>` : ''}
    </div>
  `;
}

/**
 * 从 UI 收集实体数据
 * @param {HTMLElement} root
 * @returns {import("../../../core/entities.js").CeEntityDefinition[]}
 */
export function collectEntities(root) {
  const container = root.querySelector('[data-ce-container="entities"]');
  if (!container) return [];

  // 保存折叠状态
  collapsedSet = collectCollapsedState(container);

  const cards = container.querySelectorAll('.ce-collapsible-card');
  /** @type {import("../../../core/entities.js").CeEntityDefinition[]} */
  const list = [];

  cards.forEach((card) => {
    const getInput = (field) => {
      const input = card.querySelector(`[data-ce-field="${field}"]`);
      return input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input : null;
    };

    const nameEl = getInput("name");
    const typeEl = /** @type {HTMLSelectElement|null} */ (card.querySelector('[data-ce-field="type"]'));
    if (!nameEl || !typeEl) return;

    const name = String(nameEl.value || "").trim();
    if (!name) return;

    const rawType = typeEl.value || "other";
    const type =
      rawType === "character" || rawType === "location" || rawType === "other"
        ? rawType
        : "other";

    const idEl = getInput("id");
    const baseinfoEl = getInput("baseinfo");

    const parseList = (el) => {
      if (!el) return [];
      return String(el.value || "")
        .split(/[,\uFF0C]/)
        .map((s) => s.trim())
        .filter(Boolean);
    };

    /** @type {string[]} */
    let childrenNames = [];
    /** @type {string[]} */
    let locations = [];
    /** @type {string[]} */
    let characters = [];
    /** @type {string[]} */
    let parameterNames = [];

    if (type === "character") {
      const locationsEl = getInput("locations");
      locations = parseList(locationsEl);
    } else if (type === "location") {
      const childrenEl = getInput("childrenNames");
      const charactersEl = getInput("characters");
      childrenNames = parseList(childrenEl);
      characters = parseList(charactersEl);
    }

    const paramsEl = getInput("parameterNames");
    parameterNames = parseList(paramsEl);

    // 收集 Cast 分层字段（仅角色类型）
    let summaryForSupporting = "";
    let tagsForSupporting = [];
    let descForOffstage = "";

    if (type === "character") {
      const summaryEl = getInput("summaryForSupporting");
      const tagsEl = getInput("tagsForSupporting");
      const descEl = getInput("descForOffstage");

      summaryForSupporting = summaryEl?.value.trim() || "";
      tagsForSupporting = parseList(tagsEl);
      descForOffstage = descEl?.value.trim() || "";
    }

    // 检查是否为 {{user}} 特殊实体
    const isUserEntity = name === "{{user}}";

    const entity = {
      name,
      id: idEl?.value.trim() || "",
      type,
      baseinfo: baseinfoEl?.value || "",
      childrenNames,
      locations,
      characters,
      parameterNames,
      summaryForSupporting,
      tagsForSupporting,
      descForOffstage
    };

    // 如果是 {{user}} 实体，强制覆盖关键字段以防止用户篡改
    if (isUserEntity) {
      const userDescription = getUserPersonaDescription();
      entity.name = "{{user}}";  // 强制名称
      entity.id = "__user__";    // 强制 ID
      entity.type = "character"; // 强制类型
      entity.baseinfo = userDescription;  // 强制从 ST Persona 同步
      entity.locations = [];     // {{user}} 没有常见地点
      entity.summaryForSupporting = "";  // {{user}} 没有分层设置
      entity.tagsForSupporting = [];
      entity.descForOffstage = "";
      // 保留 parameterNames（允许绑定参数）
    }

    list.push(entity);
  });

  return list;
}

/**
 * 规范化实体列表并与提示条目的 ownerName 对齐
 * @param {import("../../../core/entities.js").CeEntityDefinition[]} entitiesFromUi
 * @param {import("../../../core/variables.js").CePromptEntry[]} prompts
 * @returns {import("../../../core/entities.js").CeEntityDefinition[]}
 */
export function normalizeEntitiesWithPrompts(entitiesFromUi, prompts) {
  const ownerNames = Array.isArray(prompts)
    ? prompts
        .map((p) => (p && typeof p.ownerName === "string" ? p.ownerName.trim() : ""))
        .filter((name) => !!name)
    : [];
  
  // 获取用户信息用于 {{user}} 实体
  const userName = getUserName();
  const userDescription = getUserPersonaDescription();
  const userEntityData = {
    name: userName,
    baseinfo: userDescription
  };
  
  return buildNormalizedEntities(entitiesFromUi || [], null, ownerNames, userEntityData, null);
}

/**
 * 实体面板点击事件处理
 * @param {MouseEvent} ev
 */
function onEntityPanelClick(ev) {
  const target = ev.target;
  if (!(target instanceof HTMLElement)) return;

  const actionBtn = target.closest('[data-ce-action]');
  const action = actionBtn?.dataset.ceAction;
  if (!action) return;

  const panel = target.closest('[data-tab-panel="entities"]');
  if (!panel) return;

  if (action === "add-entity") {
    addEmptyEntityRow(panel);
  } else if (action === "copy-entity") {
    const card = target.closest('.ce-collapsible-card');
    if (card) {
      copyEntity(panel, card);
    }
  } else if (action === "delete-entity") {
    const card = target.closest('.ce-collapsible-card');
    if (card) {
      // 检查是否为 {{user}} 实体
      const nameInput = card.querySelector('[data-ce-field="name"]');
      const entityName = nameInput instanceof HTMLInputElement ? nameInput.value.trim() : "";
      
      if (entityName === "{{user}}") {
        // 阻止删除 {{user}} 实体
        alert("{{user}} 是系统特殊实体，不可删除。");
        return;
      }
      
      if (card.parentElement) {
        card.parentElement.removeChild(card);
      }
    }
  } else if (action === "toggle-collapse") {
    const card = target.closest('.ce-collapsible-card');
    if (card) {
      toggleCollapse(card);
    }
  } else if (action === "expand-all-entities") {
    const container = panel.querySelector('[data-ce-container="entities"]');
    if (container) {
      expandAll(container);
      collapsedSet.clear();
    }
  } else if (action === "collapse-all-entities") {
    const container = panel.querySelector('[data-ce-container="entities"]');
    if (container) {
      collapseAll(container);
      const cards = container.querySelectorAll('.ce-collapsible-card');
      cards.forEach((card, index) => {
        const rowId = card.dataset.rowId || String(index);
        collapsedSet.add(rowId);
      });
    }
  } else if (action === "open-param-binding") {
    openParamBindingDialog(target, panel);
  }
}

/**
 * 实体面板 change 事件：类型变更时动态调整关联字段和 Cast 字段
 * @param {Event} ev
 */
function onEntityPanelChange(ev) {
  const target = ev.target;
  if (!(target instanceof HTMLSelectElement)) return;
  if (target.dataset.ceField !== "type") return;

  const card = target.closest('.ce-collapsible-card');
  if (!card) return;

  const relationsField = /** @type {HTMLElement|null} */ (card.querySelector('[data-ce-dynamic-field="relations"]'));
  const castLayersField = /** @type {HTMLElement|null} */ (card.querySelector('[data-ce-dynamic-field="castLayers"]'));
  if (!relationsField) return;

  const newType = target.value || "other";

  // 更新类型徽章
  const typeBadge = card.querySelector('.ce-collapsible-badge');
  if (typeBadge) {
    const typeText = {
      character: "角色",
      location: "地点",
      other: "其他"
    }[newType] || "其他";
    typeBadge.textContent = typeText;
  }

  // 获取当前值以保留数据
  const getCurrentValue = (field) => {
    const input = card.querySelector(`[data-ce-field="${field}"]`);
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      return String(input.value || "");
    }
    return "";
  };

  const childrenStr = getCurrentValue("childrenNames");
  const locationsStr = getCurrentValue("locations");
  const charactersStr = getCurrentValue("characters");

  // 更新关联字段
  let relationsHtml = "";
  if (newType === "character") {
    relationsHtml = `
      <div class="ce-form-row-horizontal">
        <label>
          <span class="ce-form-label">常见地点：</span>
          <input type="text" data-ce-field="locations" value="${escapeHtml(locationsStr)}" placeholder="例如：东京.爱知学院.3年E班" />
        </label>
      </div>
    `;
  } else if (newType === "location") {
    relationsHtml = `
      <div class="ce-form-row-horizontal">
        <label>
          <span class="ce-form-label">子地点：</span>
          <input type="text" data-ce-field="childrenNames" value="${escapeHtml(childrenStr)}" placeholder="例如：爱知学院.3年E班" />
        </label>
      </div>
      <div class="ce-form-row-horizontal">
        <label>
          <span class="ce-form-label">常见角色：</span>
          <input type="text" data-ce-field="characters" value="${escapeHtml(charactersStr)}" placeholder="例如：上原惠, 安野" />
        </label>
      </div>
    `;
  } else {
    relationsHtml = `
      <div class="ce-form-row">
        <span class="ce-small-hint">该类型不参与层级嵌套和结构关联。</span>
      </div>
    `;
  }

  relationsField.innerHTML = relationsHtml;

  // 更新 Cast 分层字段
  if (castLayersField) {
    if (newType === "character") {
      castLayersField.innerHTML = `
        <div class="ce-entity-cast-section">
          <div class="ce-small-hint" style="margin-bottom:8px;">
            <strong>角色出场分层设置</strong>：根据角色在场景中的重要程度，自动加载不同详细度的人设信息，节省 token 并提升性能。
          </div>
          <div class="ce-form-row">
            <label title="当角色作为配角在场时（不是主要互动对象），只加载这段简短摘要，而不是完整人设。适合多角色场景。">
              <span class="ce-form-label">配角在场时的简短人设（1-3 句话概括核心特征）：</span>
              <textarea data-ce-field="summaryForSupporting" rows="2" placeholder="例如：上原惠，17岁女高中生，性格傲娇但内心温柔"></textarea>
            </label>
          </div>
          <div class="ce-form-row">
            <label title="当角色作为配角在场时，用这些关键词标签快速说明角色身份和关系，比完整人设更简洁。">
              <span class="ce-form-label">配角在场时的关键标签（逗号分隔，如身份、性格、关系）：</span>
              <input type="text" data-ce-field="tagsForSupporting" placeholder="例如：同班同学, 傲娇, 学习委员"/>
            </label>
          </div>
          <div class="ce-form-row">
            <label title="当角色不在场但可能被提及时（如"她的朋友上原惠"），只用这一句话说明角色是谁，完全不加载人设。">
              <span class="ce-form-label">不在场但可提及时的一句话介绍：</span>
              <input type="text" data-ce-field="descForOffstage" placeholder="例如：上原惠 —— 主角的同班同学，暧昧对象，性格傲娇"/>
            </label>
          </div>
        </div>
      `;
    } else {
      castLayersField.innerHTML = "";
    }
  }
}

/**
 * 实体面板 input 事件：实时更新卡片标题
 * @param {Event} ev
 */
function onEntityPanelInput(ev) {
  const target = ev.target;
  // 检查是否是输入框或文本域
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  
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
 * 打开/关闭参数绑定列表
 * @param {HTMLElement} button - 触发按钮
 * @param {HTMLElement} panel - 实体面板
 */
function openParamBindingDialog(button, panel) {
  const card = button.closest('.ce-collapsible-card');
  if (!card) return;

  // 检查是否已经打开
  const existingContainer = card.querySelector('[data-ce-binding-container]');
  if (existingContainer && existingContainer.style.display !== 'none') {
    // 已打开，关闭它
    hideParameterBindingList(card);
    return;
  }

  // 获取当前实体名称
  const nameInput = card.querySelector('[data-ce-field="name"]');
  const entityName = nameInput instanceof HTMLInputElement ? nameInput.value.trim() : "实体";

  // 获取当前绑定值
  const paramInput = card.querySelector('[data-ce-field="parameterNames"]');
  const currentValue = paramInput instanceof HTMLInputElement ? paramInput.value : "";

  // 获取可用实体列表（从实体面板，排除当前实体）
  const availableEntities = getAvailableEntities(panel, entityName);

  // 渲染绑定列表 - 传递函数以实时获取参数列表
  renderParameterBindingList(
    card,
    currentValue,
    () => getAvailableParameters(panel),  // 传递函数而非数组
    availableEntities,
    (newValue) => {
      // 更新回调：更新输入框并触发自动保存
      if (paramInput instanceof HTMLInputElement) {
        paramInput.value = newValue;
        paramInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  );
}

/**
 * 获取可用参数列表（包含完整信息）
 * 过滤掉内置的短期情绪/意图参数
 * @param {HTMLElement} panel
 * @returns {Array<{name: string, scope: string}>}
 */
function getAvailableParameters(panel) {
  const root = panel.closest('.ce-modal');
  if (!root) return [];

  const paramPanel = root.querySelector('[data-tab-panel="parameters"]');
  if (!paramPanel) return [];

  const cards = paramPanel.querySelectorAll('.ce-collapsible-card');
  const params = [];

  cards.forEach((card) => {
    const nameInput = card.querySelector('[data-ce-field="name"]');
    const scopeSelect = card.querySelector('[data-ce-field="scope"]');
    
    if (nameInput instanceof HTMLInputElement) {
      const name = nameInput.value.trim();
      const scope = scopeSelect instanceof HTMLSelectElement ? scopeSelect.value : 'character';
      
      // 过滤掉内置的短期情绪/意图参数
      const nameLower = name.toLowerCase();
      const isBuiltIn = nameLower.includes("短期情绪") ||
                        nameLower.includes("短期意图") ||
                        nameLower === "short_term_emotion" ||
                        nameLower === "short_term_intent";
      
      if (name && !isBuiltIn) {
        params.push({ name, scope });
      }
    }
  });

  return params;
}

/**
 * 获取可用实体列表
 * @param {HTMLElement} panel
 * @param {string} excludeName - 要排除的实体名称（当前实体）
 * @returns {Array<{name: string, type: string}>}
 */
function getAvailableEntities(panel, excludeName) {
  const container = panel.querySelector('[data-ce-container="entities"]');
  if (!container) return [];

  const cards = container.querySelectorAll('.ce-collapsible-card');
  const entities = [];

  cards.forEach((card) => {
    const nameInput = card.querySelector('[data-ce-field="name"]');
    const typeSelect = card.querySelector('[data-ce-field="type"]');

    if (nameInput instanceof HTMLInputElement && typeSelect instanceof HTMLSelectElement) {
      const name = nameInput.value.trim();
      const type = typeSelect.value || "other";

      if (name && name !== excludeName) {
        entities.push({ name, type });
      }
    }
  });

  return entities;
}

/**
 * 添加空的实体行
 * @param {HTMLElement} panel
 */
function addEmptyEntityRow(panel) {
  const container = panel.querySelector('[data-ce-container="entities"]');
  if (!container) return;

  const rowId = `entity-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const headerContent = `
    <div class="ce-collapsible-header-content">
      <span class="ce-collapsible-title">（新实体）</span>
      <span class="ce-collapsible-badge">角色</span>
      <button type="button" class="ce-btn ce-btn-small" data-ce-action="copy-entity" title="复制">
        <i class="fa-solid fa-copy"></i>
      </button>
      <button type="button" class="ce-btn ce-btn-small" data-ce-action="delete-entity" title="删除">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </div>
  `;

  const bodyContent = `
    <div class="ce-collapsible-body-content">
      <div class="ce-form-row-multi">
        <label style="flex: 2;">
          <span class="ce-form-label">名称：</span>
          <input type="text" data-ce-field="name" placeholder="实体名称，如：上原惠 或 东京.爱知学院" />
        </label>
        <label style="flex: 1;">
          <span class="ce-form-label">类型：</span>
          <select data-ce-field="type">
            <option value="character">角色</option>
            <option value="location">地点</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label style="flex: 1;">
          <span class="ce-form-label">ID：</span>
          <input type="text" data-ce-field="id" placeholder="可选"/>
        </label>
      </div>
      <div data-ce-dynamic-field="relations">
        <div class="ce-form-row-horizontal">
          <label>
            <span class="ce-form-label">常见地点：</span>
            <input type="text" data-ce-field="locations" placeholder="例如：东京.爱知学院.3年E班" />
          </label>
        </div>
      </div>
      <div class="ce-form-row-horizontal">
        <label style="flex: 1;">
          <span class="ce-form-label">绑定参数：</span>
          <div style="display: flex; gap: 4px; align-items: center;">
            <button type="button" class="ce-btn ce-btn-small ce-param-binding-btn"
                    data-ce-action="open-param-binding" title="打开参数绑定编辑器">
              <i class="fa-solid fa-link"></i>
            </button>
            <input type="text" data-ce-field="parameterNames"
                   placeholder="例如：好感度.上原惠, 信任度"
                   style="flex: 1;" />
          </div>
        </label>
      </div>
      <div class="ce-form-row">
        <label>
          <span class="ce-form-label">基础提示词（用于 baseinfo）：</span>
          <textarea data-ce-field="baseinfo" rows="2" placeholder="该实体的基础提示词"></textarea>
        </label>
      </div>
      <div data-ce-dynamic-field="castLayers">
        <div class="ce-entity-cast-section">
          <div class="ce-small-hint" style="margin-bottom:8px;">
            <strong>角色出场分层设置</strong>：根据角色在场景中的重要程度，自动加载不同详细度的人设信息，节省 token 并提升性能。
          </div>
          <div class="ce-form-row">
            <label>
              <span class="ce-form-label">配角在场时的简短人设（1-3 句话概括核心特征）：</span>
              <textarea data-ce-field="summaryForSupporting" rows="2" placeholder="例如：上原惠，17岁女高中生，性格傲娇但内心温柔"></textarea>
            </label>
          </div>
          <div class="ce-form-row-horizontal">
            <label>
              <span class="ce-form-label">配角在场时的关键标签：</span>
              <input type="text" data-ce-field="tagsForSupporting" placeholder="例如：同班同学, 傲娇, 学习委员"/>
            </label>
          </div>
          <div class="ce-form-row-horizontal">
            <label>
              <span class="ce-form-label">不在场但可提及时的一句话介绍：</span>
              <input type="text" data-ce-field="descForOffstage" placeholder="例如：上原惠 —— 主角的同班同学，暧昧对象，性格傲娇"/>
            </label>
          </div>
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
 * 复制实体
 * @param {HTMLElement} panel
 * @param {HTMLElement} sourceCard - 源卡片元素
 */
function copyEntity(panel, sourceCard) {
  const container = panel.querySelector('[data-ce-container="entities"]');
  if (!container) return;

  // 检查是否为 {{user}} 实体（虽然按钮已隐藏，但双重保险）
  const nameInput = sourceCard.querySelector('[data-ce-field="name"]');
  const sourceName = nameInput instanceof HTMLInputElement ? nameInput.value.trim() : "";
  if (sourceName === "{{user}}") {
    alert("{{user}} 是系统特殊实体，不可复制。");
    return;
  }

  // 读取源卡片的所有字段值
  const getFieldValue = (field) => {
    const el = sourceCard.querySelector(`[data-ce-field="${field}"]`);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return el.value;
    } else if (el instanceof HTMLSelectElement) {
      return el.value;
    }
    return "";
  };

  const name = getFieldValue("name");
  const type = getFieldValue("type") || "character";
  const id = getFieldValue("id");
  const baseinfo = getFieldValue("baseinfo");
  const childrenNames = getFieldValue("childrenNames");
  const locations = getFieldValue("locations");
  const characters = getFieldValue("characters");
  const parameterNames = getFieldValue("parameterNames");
  const summaryForSupporting = getFieldValue("summaryForSupporting");
  const tagsForSupporting = getFieldValue("tagsForSupporting");
  const descForOffstage = getFieldValue("descForOffstage");

  const rowId = `entity-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // 类型显示文本
  const typeText = {
    character: "角色",
    location: "地点",
    other: "其他"
  }[type] || "其他";

  const headerContent = `
    <div class="ce-collapsible-header-content">
      <span class="ce-collapsible-title">${escapeHtml(name || "（未命名）")} (副本)</span>
      <span class="ce-collapsible-badge">${typeText}</span>
      <button type="button" class="ce-btn ce-btn-small" data-ce-action="copy-entity" title="复制">
        <i class="fa-solid fa-copy"></i>
      </button>
      <button type="button" class="ce-btn ce-btn-small" data-ce-action="delete-entity" title="删除">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </div>
  `;

  // 构建关联字段HTML
  let relationsHtml = "";
  if (type === "character") {
    relationsHtml = `
      <div class="ce-form-row-horizontal">
        <label>
          <span class="ce-form-label">常见地点：</span>
          <input type="text" data-ce-field="locations" value="${escapeHtml(locations)}" placeholder="例如：东京.爱知学院.3年E班" />
        </label>
      </div>
    `;
  } else if (type === "location") {
    relationsHtml = `
      <div class="ce-form-row-horizontal">
        <label>
          <span class="ce-form-label">子地点：</span>
          <input type="text" data-ce-field="childrenNames" value="${escapeHtml(childrenNames)}" placeholder="例如：爱知学院.3年E班" />
        </label>
      </div>
      <div class="ce-form-row-horizontal">
        <label>
          <span class="ce-form-label">常见角色：</span>
          <input type="text" data-ce-field="characters" value="${escapeHtml(characters)}" placeholder="例如：上原惠, 安野" />
        </label>
      </div>
    `;
  } else {
    relationsHtml = `
      <div class="ce-form-row">
        <span class="ce-small-hint">该类型不参与层级嵌套和结构关联。</span>
      </div>
    `;
  }

  // Cast 分层字段（仅对角色类型显示）
  let castLayersHtml = "";
  if (type === "character") {
    castLayersHtml = `
      <div class="ce-entity-cast-section">
        <div class="ce-small-hint" style="margin-bottom:8px;">
          <strong>角色出场分层设置</strong>：根据角色在场景中的重要程度，自动加载不同详细度的人设信息，节省 token 并提升性能。
        </div>
        <div class="ce-form-row">
          <label title="当角色作为配角在场时（不是主要互动对象），只加载这段简短摘要，而不是完整人设。适合多角色场景。如果留空则自动使用上面的基础人设提示词作为简短人设">
            <span class="ce-form-label">作为配角在场时的简短人设（1-3 句话概括核心特征）：</span>
            <textarea data-ce-field="summaryForSupporting" rows="2" placeholder="例如：上原惠，17岁女高中生，性格傲娇但内心温柔，身材高挑，黑发蓝眼睛">${escapeHtml(summaryForSupporting)}</textarea>
          </label>
        </div>
        <div class="ce-form-row">
          <label title="当角色作为配角在场时，用这些关键词标签快速说明角色身份和关系，比完整人设更简洁。">
            <span class="ce-form-label">作为配角在场时的关键标签（逗号分隔，如身份、性格、关系）：</span>
            <input type="text" data-ce-field="tagsForSupporting" value="${escapeHtml(tagsForSupporting)}" placeholder="例如：同班同学, 傲娇, 学习委员"/>
          </label>
        </div>
        <div class="ce-form-row">
          <label title="当角色不在场但可能被提及时（如"她的朋友上原惠"），只用这一句话说明角色是谁，完全不加载人设。">
            <span class="ce-form-label">不在场但可提及时的一句话介绍：</span>
            <input type="text" data-ce-field="descForOffstage" value="${escapeHtml(descForOffstage)}" placeholder="例如：上原惠 —— {{user}}的同班同学，暧昧对象，性格傲娇"/>
          </label>
        </div>
      </div>
    `;
  }

  const bodyContent = `
    <div class="ce-collapsible-body-content">
      <div class="ce-form-row-multi">
        <label style="flex: 2;">
          <span class="ce-form-label">名称：</span>
          <input type="text" data-ce-field="name" value="${escapeHtml(name)}" placeholder="实体名称，如：上原惠 或 东京.爱知学院" />
        </label>
        <label style="flex: 1;">
          <span class="ce-form-label">类型：</span>
          <select data-ce-field="type">
            <option value="character"${type === "character" ? " selected" : ""}>角色</option>
            <option value="location"${type === "location" ? " selected" : ""}>地点</option>
            <option value="other"${type === "other" ? " selected" : ""}>其他</option>
          </select>
        </label>
        <label style="flex: 1;">
          <span class="ce-form-label">ID：</span>
          <input type="text" data-ce-field="id" value="${escapeHtml(id)}" placeholder="可选"/>
        </label>
      </div>
      <div data-ce-dynamic-field="relations">
        ${relationsHtml}
      </div>
      <div class="ce-form-row-horizontal">
        <label style="flex: 1;">
          <span class="ce-form-label">绑定参数：</span>
          <div style="display: flex; gap: 4px; align-items: center;">
            <button type="button" class="ce-btn ce-btn-small ce-param-binding-btn"
                    data-ce-action="open-param-binding" title="打开参数绑定编辑器">
              <i class="fa-solid fa-link"></i>
            </button>
            <input type="text" data-ce-field="parameterNames"
                   value="${escapeHtml(parameterNames)}"
                   placeholder="例如：好感度.上原惠, 信任度"
                   style="flex: 1;" />
          </div>
        </label>
      </div>
      <div class="ce-form-row">
        <label>
          <span class="ce-form-label">基础提示词（用于 baseinfo）：</span>
          <textarea data-ce-field="baseinfo" rows="2" placeholder="该实体的基础提示词">${escapeHtml(baseinfo)}</textarea>
        </label>
      </div>
      <div data-ce-dynamic-field="castLayers">
        ${castLayersHtml}
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