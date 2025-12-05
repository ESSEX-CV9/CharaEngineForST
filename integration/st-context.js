// SillyTavern 上下文封装：统一从这里获取 getContext() 以及常用字段。
// 其它模块不要直接 import "../../../extensions.js"，避免路径混乱。

import { getContext } from "../../../../extensions.js";

/**
 * 获取 SillyTavern 上下文对象。
 * 等价于 SillyTavern.getContext()，但通过打包后的扩展 API 提供。
 */
export function getStContext() {
  try {
    const ctx = getContext?.();
    return ctx || {};
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[CharacterEngine] 获取 ST 上下文失败", err);
    return {};
  }
}

/**
 * 获取当前聊天数组（引用），可能为 undefined。
 * @returns {Array|undefined}
 */
export function getChat() {
  const ctx = getStContext();
  return ctx.chat;
}

/**
 * 获取当前聊天的元数据对象（引用），如果不存在会返回一个空对象。
 * 注意：不要长期持有引用，应在每次需要时重新调用。
 * @returns {Object}
 */
export function getChatMetadata() {
  const ctx = getStContext();
  return ctx.chatMetadata || {};
}

/**
 * 持久化当前聊天的元数据。
 * 通常在修改 chatMetadata 后调用。
 */
export async function saveChatMetadata() {
  const ctx = getStContext();
  if (typeof ctx.saveMetadata === "function") {
    try {
      await ctx.saveMetadata();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[CharacterEngine] 保存 chatMetadata 失败", err);
    }
  }
}

/**
 * 获取扩展设置对象（全局），用于读取/写入 CharacterEngine 配置。
 * @returns {Object}
 */
export function getExtensionSettingsRoot() {
  const ctx = getStContext();
  return ctx.extensionSettings || ctx.extension_settings || {};
}

/**
 * 获取本扩展的设置对象（全局），不存在时返回空对象。
 * @param {string} extId
 * @returns {Object}
 */
export function getExtensionSettings(extId) {
  const root = getExtensionSettingsRoot();
  return root[extId] || {};
}

/**
 * 获取当前用户名称（{{user}} 的实际值）
 * @returns {string}
 */
export function getUserName() {
  const ctx = getStContext();
  return ctx.name1 || "User";
}

/**
 * 获取当前用户的 persona 描述
 * @returns {string}
 */
export function getUserPersonaDescription() {
  const ctx = getStContext();
  const powerUser = ctx.powerUserSettings || ctx.power_user || {};
  return powerUser.persona_description || "";
}