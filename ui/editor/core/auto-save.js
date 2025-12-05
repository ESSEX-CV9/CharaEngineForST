// 自动保存机制

import { saveConfigForCurrentCharacter } from "../../../integration/card-storage.js";
import { logDebug } from "../utils/dom.js";

/** @type {number|null} */
let autoSaveTimer = null;

/** @type {string} */
let lastSavedConfigJson = "";

/**
 * 设置最后保存的配置快照
 * @param {string} json
 */
export function setLastSavedConfig(json) {
  lastSavedConfigJson = json;
}

/**
 * 获取最后保存的配置快照
 * @returns {string}
 */
export function getLastSavedConfig() {
  return lastSavedConfigJson;
}

/**
 * 自动保存调度：在用户停止输入一段时间后触发真正保存
 * - 文本类输入（input[type=text|number] / textarea）：停止修改 15s 后保存
 * - 其它控件（checkbox / select 等）：保持较短延迟（800ms）
 * @param {HTMLElement} sourceEl
 * @param {Function} isLockedFn - 检查是否锁定的函数
 * @param {Function} setMessageFn - 设置状态消息的函数
 * @param {Function} runSaveFn - 执行保存的函数
 */
export function scheduleAutoSave(sourceEl, isLockedFn, setMessageFn, runSaveFn) {
  if (isLockedFn()) {
    setMessageFn("未选择角色卡：当前更改不会被保存，请先选择一个角色卡。", "error");
    return;
  }

  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }

  /** @type {number} */
  let delayMs = 800;

  if (sourceEl instanceof HTMLTextAreaElement) {
    delayMs = 15000;
  } else if (sourceEl instanceof HTMLInputElement) {
    const t = (sourceEl.type || "").toLowerCase();
    if (t === "text" || t === "number" || t === "") {
      delayMs = 15000;
    }
  }

  setMessageFn(
    delayMs >= 15000
      ? "检测到文本更改，将在 15 秒无进一步修改后自动保存…"
      : "检测到更改，将在短时间内自动保存…",
    "info"
  );

  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    void runSaveFn(false);
  }, delayMs);
}

/**
 * 统一的保存逻辑
 * @param {boolean} isManual - 是否由用户手动触发
 * @param {Function} isLockedFn - 检查是否锁定的函数
 * @param {Function} setMessageFn - 设置状态消息的函数
 * @param {Function} collectConfigFn - 收集配置的函数
 * @param {Function} onSaveSuccessFn - 保存成功后的回调
 * @returns {Promise<void>}
 */
export async function runAutoSave(isManual, isLockedFn, setMessageFn, collectConfigFn, onSaveSuccessFn) {
  if (isLockedFn()) {
    setMessageFn(
      "未选择角色卡：编辑器已锁定，当前更改不会被保存。请先在左侧选择一个角色卡。",
      "error"
    );
    return;
  }

  const cfg = collectConfigFn();
  let json = "";
  try {
    json = JSON.stringify(cfg);
  } catch {
    json = "";
  }

  // 若和上次保存的配置完全一致，则不重复写盘
  if (json && json === lastSavedConfigJson) {
    if (isManual) {
      setMessageFn("没有检测到新的更改，无需保存。", "info");
    }
    return;
  }

  logDebug(isManual ? "手动保存角色卡配置：" : "自动保存角色卡配置：", cfg);
  setMessageFn(isManual ? "正在保存到当前角色卡…" : "正在自动保存到当前角色卡…", "info");

  const ok = await saveConfigForCurrentCharacter(cfg);
  if (!ok) {
    setMessageFn(
      isManual ? "保存失败，请检查控制台日志。" : "自动保存失败，请检查控制台日志。",
      "error"
    );
    return;
  }

  // 保存成功后，更新基线快照
  lastSavedConfigJson = json;
  
  // 调用成功回调
  if (onSaveSuccessFn) {
    onSaveSuccessFn(cfg);
  }

  setMessageFn(
    isManual ? "已保存到当前角色卡。" : "已自动保存到当前角色卡。",
    "success"
  );
}