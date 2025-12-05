// DOM 工具函数

/**
 * HTML 转义
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 简单日志工具
 * @param {...any} args
 */
export function logDebug(...args) {
  // eslint-disable-next-line no-console
  console.debug("[CharacterEngine][Editor]", ...args);
}