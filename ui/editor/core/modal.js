// 弹窗基础设施

import { getCurrentCharacterName } from "../../../integration/card-storage.js";

/**
 * 创建弹窗 DOM 结构
 * @returns {HTMLElement}
 */
export function createModalDOM() {
  const root = document.createElement("div");
  root.className = "ce-modal-backdrop";
  root.dataset.ceEditorRoot = "true";

  root.innerHTML = `
    <div class="ce-modal">
      <div class="ce-modal-header">
        <div class="ce-modal-title">参数与提示编辑器</div>
        <div class="ce-modal-header-actions">
          <button class="ce-modal-action-btn" data-action="toggle-sidebar" type="button" title="切换侧边栏模式">
            <i class="fa-solid fa-bars-staggered"></i>
          </button>
          <button class="ce-modal-close" type="button" title="关闭">×</button>
        </div>
      </div>
      <!-- 未选择角色卡时的锁定遮罩 -->
      <div class="ce-modal-locked-overlay" data-ce-locked-overlay>
        <div class="ce-locked-box">
          <div class="ce-locked-title">尚未选择角色卡</div>
          <div class="ce-locked-message">
            请先在 SillyTavern 右侧角色列表中选择一个角色卡，然后再使用「参数与提示编辑器」。
          </div>
          <div class="ce-locked-hint">
            当前编辑器已锁定，避免在未绑定角色的情况下误写配置。选择角色后会自动解锁。
          </div>
        </div>
      </div>
      <div class="ce-modal-tabs">
        <button class="ce-tab-btn ce-tab-btn-active" data-tab="parameters">参数</button>
        <button class="ce-tab-btn" data-tab="promptTypes">提示类型</button>
        <button class="ce-tab-btn" data-tab="entities">实体</button>
        <button class="ce-tab-btn" data-tab="prompts">提示条目</button>
        <button class="ce-tab-btn" data-tab="initialParams">初始参数</button>
        <button class="ce-tab-btn" data-tab="options">角色卡选项</button>
      </div>
      <div class="ce-modal-body">
        <div class="ce-tab-panel" data-tab-panel="parameters"></div>
        <div class="ce-tab-panel" data-tab-panel="promptTypes" style="display:none;"></div>
        <div class="ce-tab-panel" data-tab-panel="entities" style="display:none;"></div>
        <div class="ce-tab-panel" data-tab-panel="prompts" style="display:none;"></div>
        <div class="ce-tab-panel" data-tab-panel="initialParams" style="display:none;"></div>
        <div class="ce-tab-panel" data-tab-panel="options" style="display:none;"></div>
      </div>
      <div class="ce-modal-footer">
        <div class="ce-modal-message ce-small-hint" data-ce-message></div>
        <div class="ce-modal-footer-buttons">
          <button class="ce-btn" data-action="save">保存到当前角色卡</button>
          <button class="ce-btn ce-btn-secondary" data-action="cancel">关闭</button>
        </div>
      </div>
    </div>
  `;

  return root;
}

/**
 * 显示弹窗
 * @param {HTMLElement} root
 */
export function showModal(root) {
  root.style.display = "flex";
}

/**
 * 隐藏弹窗
 * @param {HTMLElement} root
 */
export function hideModal(root) {
  root.style.display = "none";
}

/**
 * 更新编辑器标题中的当前角色卡名称和整体状态。
 *
 * 规则：
 * - 有角色名时：
 *   - 标题：参数与提示编辑器 - 当前角色：XXX
 *   - 弹窗使用普通样式（移除错误高亮）
 * - 无角色名时（未选中角色卡）：
 *   - 标题：参数与提示编辑器（未选择角色卡）
 *   - 弹窗添加红色高亮边框，提示用户需要先选择角色
 * @param {HTMLElement} root
 */
export function updateEditorTitle(root) {
  const titleEl = /** @type {HTMLElement|null} */ (
    root.querySelector(".ce-modal-title")
  );
  if (!titleEl) return;

  const baseTitle = "参数与提示编辑器";
  const charName = getCurrentCharacterName();

  if (charName) {
    titleEl.textContent = `${baseTitle} - 当前角色：${charName}`;
  } else {
    titleEl.textContent = `${baseTitle}（未选择角色卡）`;
  }

  updateLockState(root);
}

/**
 * 根据当前是否选中角色卡，控制编辑器锁定状态：
 * - 未选中角色卡：显示遮罩、添加错误高亮、禁止自动保存；
 * - 已选中角色卡：隐藏遮罩、移除错误高亮。
 * @param {HTMLElement} root
 * @param {Function} [setMessageFn] - 设置状态消息的函数
 */
export function updateLockState(root, setMessageFn) {
  const modalEl = /** @type {HTMLElement|null} */ (
    root.querySelector(".ce-modal")
  );
  const overlayEl = /** @type {HTMLElement|null} */ (
    root.querySelector("[data-ce-locked-overlay]")
  );
  if (!modalEl || !overlayEl) return;

  const charName = getCurrentCharacterName();
  const locked = !charName;

  if (locked) {
    modalEl.classList.add("ce-modal-error");
    overlayEl.style.display = "flex";
    // 添加UI锁定状态标记
    root.dataset.ceUiLocked = "true";
    if (setMessageFn) {
      setMessageFn("未选择角色卡：编辑器已锁定，当前更改不会被保存。", "error");
    }
  } else {
    modalEl.classList.remove("ce-modal-error");
    overlayEl.style.display = "none";
    // 移除UI锁定状态标记
    delete root.dataset.ceUiLocked;
    // 不强行清空状态栏，避免覆盖用户刚看到的其它提示
  }
}

/**
 * 当前编辑器是否处于"未选中角色卡"的锁定状态。
 * 这个函数会同时检查逻辑状态（是否有角色名）和UI状态（是否显示锁定遮罩）。
 * @param {HTMLElement} [root] - 编辑器根元素，如果提供则会检查UI锁定状态
 * @returns {boolean}
 */
export function isEditorLocked(root) {
  const name = getCurrentCharacterName();
  const logicallyLocked = !name;
  
  // 如果提供了root，同时检查UI锁定状态
  if (root && root.dataset) {
    const uiLocked = root.dataset.ceUiLocked === "true";
    // 只有当逻辑和UI都解锁时，才认为编辑器真正解锁
    return logicallyLocked || uiLocked;
  }
  
  return logicallyLocked;
}

/**
 * 在编辑器底部显示状态提示信息（成功 / 失败 / 普通信息）。
 * @param {HTMLElement} root
 * @param {string} text
 * @param {"success"|"error"|"info"} [type]
 */
export function setEditorStatusMessage(root, text, type = "info") {
  const box = /** @type {HTMLElement|null} */ (
    root.querySelector("[data-ce-message]")
  );
  if (!box) return;

  box.textContent = text || "";
  box.dataset.ceMessageType = type;
}

/**
 * 绑定弹窗基础事件（关闭按钮、背景点击、侧边栏切换）
 * @param {HTMLElement} root
 * @param {Function} closeFn - 关闭弹窗的函数
 * @param {Function} [saveBeforeCloseFn] - 关闭前保存的函数（可选）
 */
export function wireModalEvents(root, closeFn, saveBeforeCloseFn) {
  // 关闭按钮
  const closeBtn = root.querySelector(".ce-modal-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", async () => {
      if (saveBeforeCloseFn) {
        await saveBeforeCloseFn();
      }
      closeFn();
    });
  }

  // 侧边栏切换按钮
  const sidebarBtn = root.querySelector('[data-action="toggle-sidebar"]');
  if (sidebarBtn) {
    sidebarBtn.addEventListener("click", () => {
      toggleSidebarMode(root);
    });
  }

  // 背景点击（仅在锁定状态下允许）
  root.addEventListener("click", async (ev) => {
    if (ev.target === root && isEditorLocked(root)) {
      if (saveBeforeCloseFn) {
        await saveBeforeCloseFn();
      }
      closeFn();
    }
  });
}

/**
 * 切换侧边栏模式
 * @param {HTMLElement} root
 */
function toggleSidebarMode(root) {
  const modal = root.querySelector(".ce-modal");
  if (!modal) return;

  const isSidebar = modal.classList.contains("ce-modal-sidebar");
  
  if (isSidebar) {
    // 切换回居中模式
    modal.classList.remove("ce-modal-sidebar");
    root.classList.remove("ce-modal-backdrop-sidebar");
  } else {
    // 切换到侧边栏模式
    modal.classList.add("ce-modal-sidebar");
    root.classList.add("ce-modal-backdrop-sidebar");
  }
  
  // 保存用户偏好到 localStorage
  try {
    localStorage.setItem('ce-editor-sidebar-mode', isSidebar ? 'false' : 'true');
  } catch (e) {
    console.warn('无法保存侧边栏模式偏好:', e);
  }
}

/**
 * 恢复用户的侧边栏模式偏好
 * @param {HTMLElement} root
 */
export function restoreSidebarMode(root) {
  try {
    const savedMode = localStorage.getItem('ce-editor-sidebar-mode');
    if (savedMode === 'true') {
      const modal = root.querySelector(".ce-modal");
      if (modal) {
        modal.classList.add("ce-modal-sidebar");
        root.classList.add("ce-modal-backdrop-sidebar");
      }
    }
  } catch (e) {
    console.warn('无法恢复侧边栏模式偏好:', e);
  }
}

/**
 * 绑定底部按钮事件
 * @param {HTMLElement} root
 * @param {Function} saveFn - 保存函数
 * @param {Function} closeFn - 关闭函数
 * @param {Function} [saveBeforeCloseFn] - 关闭前保存的函数（可选）
 */
export function wireFooterEvents(root, saveFn, closeFn, saveBeforeCloseFn) {
  const footer = root.querySelector(".ce-modal-footer");
  if (footer) {
    footer.addEventListener("click", async (ev) => {
      const target = ev.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.dataset.action;
      if (!action) return;

      if (action === "save") {
        await saveFn(true);
      } else if (action === "cancel") {
        if (saveBeforeCloseFn) {
          await saveBeforeCloseFn();
        }
        closeFn();
      }
    });
  }
}