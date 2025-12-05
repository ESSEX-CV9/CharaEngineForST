// 角色引擎：参数 / 提示编辑器主入口
// 本文件负责整合所有模块，提供统一的对外接口

import {
  getConfigForCurrentCharacter,
  saveConfigForCurrentCharacter,
  getCurrentCharacterName
} from "../integration/card-storage.js";
import { buildNormalizedEntities } from "../core/entities.js";
import { getUserName, getUserPersonaDescription } from "../integration/st-context.js";

// 核心模块
import {
  createModalDOM,
  showModal,
  hideModal,
  updateEditorTitle,
  isEditorLocked,
  setEditorStatusMessage as setModalStatusMessage,
  wireModalEvents,
  wireFooterEvents,
  restoreSidebarMode
} from "./editor/core/modal.js";
import { switchTab } from "./editor/core/tabs.js";
import {
  scheduleAutoSave as scheduleAutoSaveCore,
  runAutoSave as runAutoSaveCore
} from "./editor/core/auto-save.js";

// 面板模块
import {
  initParametersPanel,
  renderParameters,
  collectParameters
} from "./editor/panels/parameters.js";
import {
  initPromptTypesPanel,
  renderPromptTypes,
  collectPromptTypes
} from "./editor/panels/prompt-types.js";
import {
  initEntitiesPanel,
  renderEntities,
  collectEntities
} from "./editor/panels/entities.js";
import {
  initInitialParamsPanel,
  renderInitialParams,
  collectInitialState
} from "./editor/panels/initial-params.js";
import {
  initPromptsPanel,
  renderPrompts,
  collectPrompts,
  setCollapsedSet as setPromptsCollapsedSet,
  updateOwnerNameSelects
} from "./editor/panels/prompts.js";
import {
  initOptionsPanel,
  renderOptions,
  collectOptions
} from "./editor/panels/options.js";

// 工具函数
import { logDebug } from "./editor/utils/dom.js";

/**
 * 最近一次从角色卡加载的 initialState 快照
 * @type {any}
 */
let lastLoadedInitialState = null;

/**
 * 上次保存的配置 JSON（用于自动保存去重）
 * @type {string}
 */
let lastSavedConfigJson = "";

/**
 * 编辑器根元素引用（全局单例）
 * @type {HTMLElement|null}
 */
let editorRoot = null;

/**
 * 角色切换事件监听器是否已注册
 * @type {boolean}
 */
let characterChangeListenerRegistered = false;

/**
 * 确保编辑器弹窗存在
 * @returns {HTMLElement}
 */
function ensureModalExists() {
  if (editorRoot && document.body.contains(editorRoot)) {
    return editorRoot;
  }
  
  editorRoot = createModalDOM();
  document.body.appendChild(editorRoot);
  return editorRoot;
}

/**
 * 处理角色切换事件
 */
function handleCharacterChanged() {
  if (!editorRoot || editorRoot.style.display === "none") {
    // 编辑器未打开，无需处理
    return;
  }
  
  logDebug("检测到角色切换事件");
  
  // 更新标题和锁定状态
  updateEditorTitle(editorRoot);
  
  // 如果现在有角色了（从锁定状态切换到有角色）
  if (!isEditorLocked(editorRoot)) {
    logDebug("角色已选中，刷新编辑器数据");
    // 刷新编辑器数据
    refreshEditorFromCurrentCard();
  }
}

/**
 * 注册角色切换事件监听器
 */
function registerCharacterChangeListener() {
  if (characterChangeListenerRegistered) {
    return;
  }
  
  try {
    const context = SillyTavern.getContext();
    const { eventSource, event_types } = context;
    
    if (!eventSource || !event_types) {
      logDebug("无法获取事件源，跳过角色切换监听器注册");
      return;
    }
    
    // 注册 CHAT_CHANGED 事件监听
    eventSource.on(event_types.CHAT_CHANGED, handleCharacterChanged);
    characterChangeListenerRegistered = true;
    logDebug("角色切换事件监听器已注册");
  } catch (err) {
    logDebug("注册角色切换事件监听器失败：", err);
  }
}

/**
 * 打开参数/提示编辑器主入口
 */
export function openCeEditorPanel() {
  editorRoot = ensureModalExists();
  
  // 注册角色切换事件监听器（只注册一次）
  registerCharacterChangeListener();
  
  initAllPanels(editorRoot);
  refreshEditorFromCurrentCard();
  updateEditorTitle(editorRoot);
  restoreSidebarMode(editorRoot); // 恢复用户的侧边栏模式偏好
  showModal(editorRoot);
}

/**
 * 初始化所有面板
 * @param {HTMLElement} root
 */
function initAllPanels(root) {
  const paramPanel = root.querySelector('[data-tab-panel="parameters"]');
  const typePanel = root.querySelector('[data-tab-panel="promptTypes"]');
  const entitiesPanel = root.querySelector('[data-tab-panel="entities"]');
  const initialParamsPanel = root.querySelector('[data-tab-panel="initialParams"]');
  const promptsPanel = root.querySelector('[data-tab-panel="prompts"]');
  const optionsPanel = root.querySelector('[data-tab-panel="options"]');

  if (paramPanel) initParametersPanel(paramPanel);
  if (typePanel) initPromptTypesPanel(typePanel);
  if (entitiesPanel) initEntitiesPanel(entitiesPanel);
  if (initialParamsPanel) initInitialParamsPanel(initialParamsPanel);
  if (promptsPanel) initPromptsPanel(promptsPanel);
  if (optionsPanel) initOptionsPanel(optionsPanel);

  // 绑定全局事件
  wireGlobalEvents(root);
}

/**
 * 绑定全局事件（关闭、Tab切换、底部按钮等）
 * @param {HTMLElement} root
 */
function wireGlobalEvents(root) {
  // 创建关闭前保存函数
  const saveBeforeClose = async () => {
    // 只在未锁定状态下执行保存
    if (!isEditorLocked(root)) {
      await runAutoSave(false);
    }
  };

  // 绑定弹窗基础事件（关闭按钮、背景点击），传入保存函数
  wireModalEvents(root, () => hideModal(root), saveBeforeClose);

  // Tab 切换
  const tabButtons = root.querySelectorAll(".ce-tab-btn");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (!tab) return;
      
      switchTab(root, tab, collectConfigFromUi, () => {
        const cfg = collectConfigFromUi();
        const panel = root.querySelector('[data-tab-panel="initialParams"]');
        if (panel) {
          renderInitialParams(panel, cfg, () => {
            const paramPanel = root.querySelector('[data-tab-panel="parameters"]');
            return paramPanel ? collectParameters(paramPanel) : [];
          });
        }
      });
    });
  });

  // 绑定底部按钮事件，传入保存函数
  wireFooterEvents(root, (isManual) => runAutoSave(isManual), () => hideModal(root), saveBeforeClose);

  // 内容变更触发自动保存
  root.addEventListener("input", (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest(".ce-modal-footer")) return;
    
    // 同步紧凑视图
    syncCompactFieldFromFull(target, root);
    
    // 如果是实体面板的名称字段变更，更新提示条目的下拉菜单
    const entitiesPanel = target.closest('[data-tab-panel="entities"]');
    if (entitiesPanel && target.dataset.ceField === "name") {
      updatePromptOwnerSelects(root);
    }
    
    scheduleAutoSave(target);
  });

  root.addEventListener("change", (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest(".ce-modal-footer")) return;
    
    // 如果是实体面板的任何变更，更新提示条目的下拉菜单
    const entitiesPanel = target.closest('[data-tab-panel="entities"]');
    if (entitiesPanel) {
      updatePromptOwnerSelects(root);
    }
    
    scheduleAutoSave(target);
  });
}

/**
 * 调度自动保存
 * @param {HTMLElement} sourceEl
 */
function scheduleAutoSave(sourceEl) {
  scheduleAutoSaveCore(
    sourceEl,
    () => isEditorLocked(editorRoot),
    (text, type) => setModalStatusMessage(editorRoot, text, type),
    runAutoSave
  );
}

/**
 * 执行自动保存
 * @param {boolean} isManual
 * @returns {Promise<void>}
 */
async function runAutoSave(isManual) {
  await runAutoSaveCore(
    isManual,
    () => isEditorLocked(editorRoot),
    (text, type) => setModalStatusMessage(editorRoot, text, type),
    collectConfigFromUi,
    onSaveSuccess
  );
}

/**
 * 保存成功后的回调
 * @param {any} cfg
 */
function onSaveSuccess(cfg) {
  if (!editorRoot) return;
  
  // 更新保存基线
  try {
    lastSavedConfigJson = JSON.stringify(cfg);
  } catch {
    lastSavedConfigJson = "";
  }
  
  // 刷新提示类型和提示条目
  const typePanel = editorRoot.querySelector('[data-tab-panel="promptTypes"]');
  const promptsPanel = editorRoot.querySelector('[data-tab-panel="prompts"]');
  
  if (typePanel) renderPromptTypes(typePanel, cfg.promptTypes || []);
  if (promptsPanel) {
    renderPrompts(
      promptsPanel,
      cfg.prompts || [],
      cfg.promptTypes || [],
      () => {
        const paramPanel = editorRoot.querySelector('[data-tab-panel="parameters"]');
        return paramPanel ? collectParameters(paramPanel) : [];
      },
      getExistingEntityNames
    );
  }
}

/**
 * 同步紧凑视图中的输入回详细输入控件
 * @param {HTMLElement} target
 * @param {HTMLElement} root
 */
function syncCompactFieldFromFull(target, root) {
  const compactField = target.dataset.ceCompactField;
  if (!compactField) return;

  const mainRow = target.closest('tr[data-ce-prompt-row="main"]');
  const tbody = root.querySelector('table[data-ce-table="prompts"] tbody');
  if (!mainRow || !tbody) return;

  const rowId = mainRow.dataset.rowId || "";

  if (compactField === "ownerName" || compactField === "promptTypeName" || compactField === "conditions") {
    const fullEl = mainRow.querySelector(`[data-ce-field="${compactField}"]`);
    if (fullEl instanceof HTMLInputElement || fullEl instanceof HTMLTextAreaElement) {
      fullEl.value = target.value;
    }
  } else if (compactField === "text" && rowId) {
    const textRow = tbody.querySelector(
      `tr[data-ce-prompt-row="text"][data-row-id="${rowId}"]`
    );
    const textEl = textRow?.querySelector('[data-ce-field="text"]');
    if (textEl instanceof HTMLTextAreaElement) {
      textEl.value = target.value;
    }
  }
}

/**
 * 从当前角色卡读取配置并刷新 UI
 */
function refreshEditorFromCurrentCard() {
  const cfg = getConfigForCurrentCharacter();
  logDebug("加载角色卡配置：", cfg);

  if (!editorRoot) return;

  lastLoadedInitialState =
    cfg.initialState && typeof cfg.initialState === "object" ? cfg.initialState : {};

  // 首次加载时，默认所有提示条目为折叠态
  if (Array.isArray(cfg.prompts)) {
    const collapsedSet = new Set(
      cfg.prompts.map((_, index) => String(index))
    );
    setPromptsCollapsedSet(collapsedSet);
  }

  // 渲染各个面板
  const paramPanel = editorRoot.querySelector('[data-tab-panel="parameters"]');
  const typePanel = editorRoot.querySelector('[data-tab-panel="promptTypes"]');
  const entitiesPanel = editorRoot.querySelector('[data-tab-panel="entities"]');
  const initialParamsPanel = editorRoot.querySelector('[data-tab-panel="initialParams"]');
  const promptsPanel = editorRoot.querySelector('[data-tab-panel="prompts"]');
  const optionsPanel = editorRoot.querySelector('[data-tab-panel="options"]');

  if (paramPanel) renderParameters(paramPanel, cfg.parameters || []);
  if (typePanel) renderPromptTypes(typePanel, cfg.promptTypes || []);
  if (entitiesPanel) renderEntities(entitiesPanel, cfg.entities || []);
  if (initialParamsPanel) {
    renderInitialParams(initialParamsPanel, cfg, () => {
      return paramPanel ? collectParameters(paramPanel) : [];
    });
  }
  if (promptsPanel) {
    renderPrompts(
      promptsPanel,
      cfg.prompts || [],
      cfg.promptTypes || [],
      () => {
        return paramPanel ? collectParameters(paramPanel) : [];
      },
      getExistingEntityNames
    );
  }
  if (optionsPanel) renderOptions(optionsPanel, cfg.options || {});

  // 更新保存基线
  try {
    lastSavedConfigJson = JSON.stringify(cfg);
  } catch {
    lastSavedConfigJson = "";
  }

  setModalStatusMessage(editorRoot, "", "info");
}

/**
 * 从 UI 收集完整配置
 * @returns {import("../integration/card-storage.js").CeCharacterConfig}
 */
function collectConfigFromUi() {
  if (!editorRoot) {
    return {
      parameters: [],
      promptTypes: [],
      prompts: [],
      entities: [],
      initialState: {},
      options: {}
    };
  }

  const paramPanel = editorRoot.querySelector('[data-tab-panel="parameters"]');
  const typePanel = editorRoot.querySelector('[data-tab-panel="promptTypes"]');
  const entitiesPanel = editorRoot.querySelector('[data-tab-panel="entities"]');
  const promptsPanel = editorRoot.querySelector('[data-tab-panel="prompts"]');
  const optionsPanel = editorRoot.querySelector('[data-tab-panel="options"]');

  const parameters = paramPanel ? collectParameters(paramPanel) : [];
  let promptTypes = typePanel ? collectPromptTypes(typePanel) : [];
  const prompts = promptsPanel ? collectPrompts(promptsPanel, () => {
    return paramPanel ? collectParameters(paramPanel) : [];
  }) : [];
  const entitiesFromUi = entitiesPanel ? collectEntities(entitiesPanel) : [];
  const options = optionsPanel ? collectOptions(optionsPanel) : {};

  if (!Array.isArray(promptTypes)) {
    promptTypes = [];
  }

  // 自动补全提示类型
  const existingTypeNames = new Set(
    promptTypes.map((t) => (t && typeof t.name === "string" ? t.name.trim() : "")).filter(Boolean)
  );

  for (const p of prompts) {
    if (!p || typeof p.promptTypeName !== "string") continue;
    const typeName = p.promptTypeName.trim();
    if (!typeName) continue;
    if (!existingTypeNames.has(typeName)) {
      promptTypes.push({
        name: typeName,
        id: "",
        description: ""
      });
      existingTypeNames.add(typeName);
    }
  }

  // 规范化实体
  const entities = normalizeEntitiesWithPrompts(entitiesFromUi, prompts);

  // 收集初始状态
  const initialState = collectInitialStateFromPanels(parameters);

  return {
    parameters,
    promptTypes,
    prompts,
    entities,
    initialState,
    options
  };
}

/**
 * 收集初始状态（包含 variables 和其他字段）
 * @param {Array} parameters
 * @returns {any}
 */
function collectInitialStateFromPanels(parameters) {
  if (!editorRoot) {
    return {
      variables: { character: {}, relationship: {}, scene: {}, global: {} },
      scene: {},
      cast: {},
      entitiesRuntime: {}
    };
  }

  const panel = editorRoot.querySelector('[data-tab-panel="initialParams"]');
  if (!panel) {
    return {
      variables: { character: {}, relationship: {}, scene: {}, global: {} },
      scene: lastLoadedInitialState?.scene || {},
      cast: lastLoadedInitialState?.cast || {},
      entitiesRuntime: lastLoadedInitialState?.entitiesRuntime || {}
    };
  }

  return collectInitialState(panel, parameters, lastLoadedInitialState);
}

/**
 * 规范化实体并与提示条目对齐
 * @param {Array} entitiesFromUi
 * @param {Array} prompts
 * @returns {Array}
 */
function normalizeEntitiesWithPrompts(entitiesFromUi, prompts) {
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
 * 获取当前实体面板中的实体名称列表（从卡片式布局中读取）
 * @returns {string[]}
 */
function getExistingEntityNames() {
  if (!editorRoot) return [];
  const panel = editorRoot.querySelector('[data-tab-panel="entities"]');
  if (!panel) return [];
  
  // 从卡片式布局中读取实体名称
  const cards = panel.querySelectorAll('.ce-collapsible-card');
  const set = new Set();
  cards.forEach((card) => {
    const nameEl = /** @type {HTMLInputElement|null} */ (
      card.querySelector('[data-ce-field="name"]')
    );
    const v = nameEl?.value.trim();
    if (v) set.add(v);
  });
  return Array.from(set);
}

/**
 * 更新提示条目面板中的归属实体下拉菜单
 * @param {HTMLElement} root
 */
function updatePromptOwnerSelects(root) {
  if (!root) return;
  const promptsPanel = root.querySelector('[data-tab-panel="prompts"]');
  if (!promptsPanel) return;
  
  updateOwnerNameSelects(promptsPanel, getExistingEntityNames);
}