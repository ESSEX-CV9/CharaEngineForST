// 提示组合模块：根据作者定义的提示类型与规则，在给定参数状态下生成提示文本。
// 本模块不依赖 SillyTavern，仅做纯数据计算。

import { matchPromptConditions } from "./variables.js";
import { replaceBundlesTemplates } from "./template-replacer.js";

/**
 * @typedef {import("./variables.js").CePromptEntry} CePromptEntry
 */

/**
 * @typedef {Object} PromptBundle
 * @property {string} ownerName
 * @property {Object.<string, string>} byPromptType  // key 为提示类型名，value 为组合后的文本
 */

/**
 * 在给定的参数快照下，选出所有满足条件的提示条目，并按「ownerName -> promptTypeName」分组。
 *
 * 核心改进：
 * 1. 为每个 ownerName 创建独立的参数查找上下文
 * 2. 支持路径式参数引用（通过 getValueByPath）
 * 3. 自动为简单参数名补全 ownerName 前缀
 *
 * 返回结构示意：
 * {
 *   "艾莉娅": {
 *     "语气": "..." ,
 *     "内心独白": "..."
 *   },
 *   "学园屋顶": {
 *     "场景描述": "..."
 *   }
 * }
 *
 * @param {CePromptEntry[]} entries - 提示条目列表
 * @param {(path: string) => any} getValueByPath - 通过路径获取参数值的函数
 * @returns {Object.<string, PromptBundle>}
 */
export function buildPromptBundles(entries, getValueByPath) {
  const result = {};
  if (!Array.isArray(entries) || entries.length === 0) {
    return result;
  }

  // 按优先级排序（数值越小优先级越高）
  const sortedEntries = [...entries].sort((a, b) => {
    const priorityA = typeof a.priority === 'number' ? a.priority : 100;
    const priorityB = typeof b.priority === 'number' ? b.priority : 100;
    return priorityA - priorityB;
  });

  for (const entry of sortedEntries) {
    if (!entry || typeof entry !== "object") continue;

    const ownerName = String(entry.ownerName || "").trim();
    const promptTypeName = String(entry.promptTypeName || "").trim();
    if (!ownerName || !promptTypeName) continue;

    const conditions = Array.isArray(entry.when) ? entry.when : [];
    
    // 关键改进: 传入 ownerName 作为上下文，支持自动路径补全
    if (!matchPromptConditions(conditions, getValueByPath, ownerName)) {
      continue;
    }

    if (!result[ownerName]) {
      result[ownerName] = {
        ownerName,
        byPromptType: {}
      };
    }

    const bundle = result[ownerName];
    const prevText = bundle.byPromptType[promptTypeName] || "";
    const nextText = String(entry.text ?? "").trim();

    if (!nextText) {
      continue;
    }

    bundle.byPromptType[promptTypeName] = prevText
      ? `${prevText}\n\n${nextText}`
      : nextText;
  }

  // 模板替换
  const replacedResult = replaceBundlesTemplates(result, getValueByPath);

  return replacedResult;
}