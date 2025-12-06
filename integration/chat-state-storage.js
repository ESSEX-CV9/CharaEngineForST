// 聊天级状态存储：基于 git 风格 diff，将 EngineState 与 ChangeSet 绑定到 ST 的 chatMetadata 与消息上。
// 这里只负责「读/写存储结构」，不做解析调用或提示注入。

import { getStContext, getChatMetadata, saveChatMetadata, getChat } from "./st-context.js";
import { createInitialEngineState, cloneEngineState, applyChangeSet } from "../core/engine-state.js";
import { getConfigForCurrentCharacter } from "./card-storage.js";
import { createEmptyChangeSet } from "../core/change-set.js";
import { withParsedPath } from "../core/variables.js";

/**
 * chatMetadata 中用于角色引擎的根键名。
 */
const META_KEY = "CharacterEngine";

/**
 * 计算消息内容的哈希值（用于检测内容变化）
 * @param {Object} message - ST 消息对象
 * @returns {string}
 */
function computeMessageHash(message) {
  if (!message) return '';
  
  // 组合关键字段：消息内容 + 是否用户消息 + 发送者名称
  const content = [
    message.mes || '',
    message.is_user ? 'user' : 'ai',
    message.name || ''
  ].join('|');
  
  // 简单哈希算法
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * 获取消息的唯一标识（包含 swipe_id）
 * @param {Object} message - ST 消息对象
 * @param {number} index - 消息索引（作为后备）
 * @returns {string}
 */
function getMessageId(message, index) {
  // 获取当前 swipe 的 ID（默认为 0）
  const swipeId = typeof message.swipe_id === 'number' ? message.swipe_id : 0;
  
  // ST 的消息可能有 send_date 作为唯一标识
  if (message && message.send_date) {
    return `msg_${message.send_date}_swipe_${swipeId}`;
  }
  // 后备：使用索引 + 内容哈希 + swipe_id
  return `msg_${index}_${computeMessageHash(message)}_swipe_${swipeId}`;
}

/**
 * 从 chatMetadata 中读取角色引擎元信息，如果不存在则创建。
 *
 * 存储结构：
 * {
 *   initialState: EngineState 序列化对象,
 *   initialized: true,  // 标记已完成初始化
 *   runtimeMeta: {
 *     lastComputedMessageIndex: number,
 *     lastComputedStateCheckpoint: EngineState 序列化对象
 *   },
 *   changeSetsByMessageId: {
 *     [messageId: string]: {
 *       changeSet: CeChangeSet,
 *       contentHash: string,        // 消息内容的哈希值
 *       prevMessageId: string|null, // 上一条消息的 ID（用于检测分支）
 *       timestamp: number            // 创建时间戳
 *     }
 *   }
 * }
 */
export function getOrCreateEngineMeta(chatId = "") {
  const metaRoot = getChatMetadata();
  const ctx = getStContext();
  const effectiveChatId = chatId || String(ctx.chatId ?? "");

  // 检查是否需要初始化
  const needsInit = !metaRoot[META_KEY] ||
                    typeof metaRoot[META_KEY] !== "object" ||
                    !metaRoot[META_KEY].initialized ||
                    !metaRoot[META_KEY].initialState;

  if (needsInit) {
    // 1. 从角色卡读取基础配置
    const charConfig = getConfigForCurrentCharacter();
    const initialConfig =
      charConfig && typeof charConfig.initialState === "object" ? charConfig.initialState : {};

    // 2. 扫描 greeting 中的 <CE_Init> 并解析初始参数
    const greetingChangeSet = extractGreetingInitFromChat();

    // 3. 创建基础 initialState
    let initialState = createInitialEngineState({
      chatId: effectiveChatId,
      initialVariables: initialConfig.variables || {},
      initialScene: initialConfig.scene || {},
      initialCast: initialConfig.cast || {},
      initialEntitiesRuntime: initialConfig.entitiesRuntime || {}
    });

    // 4. 如果 greeting 中有初始化参数，合并到 initialState
    if (greetingChangeSet) {
      // 获取参数定义、实体定义和 Cast 配置
      const parameterDefs = Array.isArray(charConfig.parameters) ? charConfig.parameters : [];
      const entityDefs = Array.isArray(charConfig.entities) ? charConfig.entities : [];
      const castConfig = charConfig?.options?.castConfig || null;
      initialState = applyChangeSet(initialState, greetingChangeSet, parameterDefs, entityDefs, castConfig);
      
      // 将 greetingChangeSet 绑定到 greeting 消息，便于状态观察器显示
      const chat = getChat();
      if (Array.isArray(chat) && chat.length > 0) {
        const firstAiMsg = chat.find(msg => msg && typeof msg === "object" && !msg.is_user);
        if (firstAiMsg && !firstAiMsg.ce_change_set) {
          firstAiMsg.ce_change_set = greetingChangeSet;
        }
      }
    }

    // 5. 创建或更新 meta 对象
    metaRoot[META_KEY] = {
      initialState,
      initialized: true,  // 标记已完成初始化
      runtimeMeta: {
        lastComputedMessageIndex: -1,
        lastComputedStateCheckpoint: null
      },
      changeSetsByMessageId: {}
    };
  }

  return metaRoot[META_KEY];
}

/**
 * 从当前 chat 的 greeting（第一条 AI 消息）中提取 <CE_Init> 块并解析为 ChangeSet。
 * 这个函数在 getOrCreateEngineMeta 中被调用，确保 greeting 的初始化在状态创建之前完成。
 *
 * @returns {import("../core/change-set.js").CeChangeSet|null}
 */
function extractGreetingInitFromChat() {
  const chat = getChat();
  if (!Array.isArray(chat) || chat.length === 0) {
    return null;
  }

  // 找到第一条 AI 消息（greeting）
  let greetingMsg = null;
  for (let i = 0; i < chat.length; i++) {
    const msg = chat[i];
    if (msg && typeof msg === "object" && !msg.is_user) {
      greetingMsg = msg;
      break;
    }
  }

  if (!greetingMsg) {
    return null;
  }

  const text = typeof greetingMsg.mes === "string" ? greetingMsg.mes : "";
  if (!text) {
    return null;
  }

  // 解析 <CE_Init> 中的 ce.set(...) 指令
  return parseInitialCeSetFromGreetingText(text);
}

/**
 * 更新并保存 chatMetadata 中的角色引擎元信息。
 * @param {Object} updaterFn - (meta) => void
 */
export async function updateEngineMeta(updaterFn) {
  const metaRoot = getChatMetadata();
  const current = metaRoot[META_KEY] || {};
  updaterFn(current);
  metaRoot[META_KEY] = current;
  await saveChatMetadata();
}

/**
 * 为当前 chat 设置/重置初始状态。
 * @param {import("../core/engine-state.js").EngineState} engineState
 */
export async function setInitialStateForChat(engineState) {
  await updateEngineMeta(meta => {
    meta.initialState = cloneEngineState(engineState);
    meta.runtimeMeta = meta.runtimeMeta || {};
    meta.runtimeMeta.lastComputedMessageIndex = -1;
    meta.runtimeMeta.lastComputedStateCheckpoint = null;
  });
}

/**
 * 读取当前 chat 的初始状态 EngineState。
 * @returns {import("../core/engine-state.js").EngineState}
 */
export function getInitialStateFromChat() {
  const ctx = getStContext();
  const chatId = String(ctx.chatId ?? "");
  const meta = getOrCreateEngineMeta(chatId);
  if (meta.initialState) {
    return cloneEngineState(meta.initialState);
  }
  return createInitialEngineState({ chatId });
}

/**
 * 获取当前保存的 checkpoint（最近完整计算的 EngineState）及其对应 messageIndex。
 * @returns {{ index: number, state: import("../core/engine-state.js").EngineState|null }}
 */
export function getCheckpoint() {
  const ctx = getStContext();
  const chatId = String(ctx.chatId ?? "");
  const meta = getOrCreateEngineMeta(chatId);
  const runtimeMeta = meta.runtimeMeta || {};
  const idx = typeof runtimeMeta.lastComputedMessageIndex === "number"
    ? runtimeMeta.lastComputedMessageIndex
    : -1;
  const state = runtimeMeta.lastComputedStateCheckpoint
    ? cloneEngineState(runtimeMeta.lastComputedStateCheckpoint)
    : null;
  return { index: idx, state };
}

/**
 * 写入新的 checkpoint。
 * @param {number} index
 * @param {import("../core/engine-state.js").EngineState} state
 */
export async function setCheckpoint(index, state) {
  await updateEngineMeta(meta => {
    meta.runtimeMeta = meta.runtimeMeta || {};
    meta.runtimeMeta.lastComputedMessageIndex = index;
    meta.runtimeMeta.lastComputedStateCheckpoint = cloneEngineState(state);
  });
}

/**
 * 存储 ChangeSet（基于消息 ID + 内容哈希）
 * @param {number} messageIndex
 * @param {Object} changeSet
 */
export async function setChangeSetForIndex(messageIndex, changeSet) {
  const chat = getChat() || [];
  const message = chat[messageIndex];
  
  if (!message) {
    // eslint-disable-next-line no-console
    console.warn(`[CharacterEngine] 无法存储 ChangeSet：消息索引 ${messageIndex} 不存在`);
    return;
  }
  
  const messageId = getMessageId(message, messageIndex);
  const contentHash = computeMessageHash(message);
  
  // 获取上一条消息的 ID（用于检测分支）
  let prevMessageId = null;
  if (messageIndex > 0) {
    const prevMessage = chat[messageIndex - 1];
    if (prevMessage) {
      prevMessageId = getMessageId(prevMessage, messageIndex - 1);
    }
  }
  
  await updateEngineMeta(meta => {
    if (!meta.changeSetsByMessageId) {
      meta.changeSetsByMessageId = {};
    }
    
    meta.changeSetsByMessageId[messageId] = {
      changeSet,
      contentHash,
      prevMessageId,
      timestamp: Date.now()
    };
  });
}

/**
 * 读取 ChangeSet（验证内容哈希和分支）
 * @param {number} messageIndex
 * @returns {Object|null}
 */
export function getChangeSetForIndex(messageIndex) {
  const chat = getChat() || [];
  const message = chat[messageIndex];
  
  if (!message) {
    return null;
  }
  
  const messageId = getMessageId(message, messageIndex);
  const currentHash = computeMessageHash(message);
  
  const metaRoot = getChatMetadata();
  const meta = metaRoot[META_KEY];
  
  if (!meta || !meta.changeSetsByMessageId) {
    return null;
  }
  
  const cached = meta.changeSetsByMessageId[messageId];
  
  if (!cached) {
    // 缓存不存在
    return null;
  }
  
  // 验证内容哈希
  if (cached.contentHash !== currentHash) {
    // eslint-disable-next-line no-console
    console.debug(`[CharacterEngine] ChangeSet 缓存失效：消息内容已改变（索引 ${messageIndex}）`, {
      oldHash: cached.contentHash,
      newHash: currentHash,
      messageId
    });
    return null;
  }
  
  // 验证分支（检查上一条消息是否匹配）
  if (messageIndex > 0) {
    const prevMessage = chat[messageIndex - 1];
    if (prevMessage) {
      const prevMessageId = getMessageId(prevMessage, messageIndex - 1);
      if (cached.prevMessageId && cached.prevMessageId !== prevMessageId) {
        // eslint-disable-next-line no-console
        console.debug(`[CharacterEngine] ChangeSet 缓存失效：检测到分支变化（索引 ${messageIndex}）`);
        return null;
      }
    }
  }
  
  // 缓存有效
  return cached.changeSet;
}

/**
 * 清理指定索引之后的所有 ChangeSet 缓存
 * @param {number} messageIndex
 */
export async function clearChangeSetAfterIndex(messageIndex) {
  const chat = getChat() || [];
  
  await updateEngineMeta(meta => {
    if (!meta.changeSetsByMessageId) return;
    
    // 收集需要删除的消息 ID
    const idsToDelete = [];
    
    // 遍历所有缓存的 ChangeSet
    for (const [msgId, cached] of Object.entries(meta.changeSetsByMessageId)) {
      // 检查这个缓存是否对应于 messageIndex 之后的消息
      // 通过时间戳判断：如果缓存的时间戳晚于目标索引处消息的时间戳，则删除
      let shouldDelete = false;
      
      // 尝试从 messageId 中提取 send_date
      const sendDateMatch = msgId.match(/^msg_(\d+)$/);
      if (sendDateMatch) {
        const cachedSendDate = parseInt(sendDateMatch[1], 10);
        // 获取 messageIndex 处消息的 send_date
        if (messageIndex < chat.length) {
          const targetMessage = chat[messageIndex];
          if (targetMessage && targetMessage.send_date) {
            shouldDelete = cachedSendDate > targetMessage.send_date;
          }
        }
      } else {
        // 如果无法从 ID 中提取信息，使用时间戳判断
        // 获取 messageIndex 处消息的缓存时间戳
        if (messageIndex < chat.length) {
          const targetMessage = chat[messageIndex];
          const targetId = getMessageId(targetMessage, messageIndex);
          const targetCached = meta.changeSetsByMessageId[targetId];
          if (targetCached && cached.timestamp > targetCached.timestamp) {
            shouldDelete = true;
          }
        }
      }
      
      if (shouldDelete) {
        idsToDelete.push(msgId);
      }
    }
    
    // 删除
    for (const id of idsToDelete) {
      delete meta.changeSetsByMessageId[id];
    }
  });
}

/**
 * 从初始状态和（可选）checkpoint 出发，按顺序应用每条 AI 消息的 ChangeSet，
 * 重建直到 targetIndex（包含）的 EngineState。
 *
 * @param {number} targetIndex 目标消息索引（通常是最新消息的 index）
 * @returns {import("../core/engine-state.js").EngineState}
 */
export function rebuildEngineStateUpTo(targetIndex) {
  const ctx = getStContext();
  const chatId = String(ctx.chatId ?? "");
  const chat = getChat() || [];

  const meta = getOrCreateEngineMeta(chatId);
  const runtimeMeta = meta.runtimeMeta || {};

  let baseState = getInitialStateFromChat();
  let startIndex = 0;

  // 如果 checkpoint 可用且位于目标范围内，从 checkpoint 开始
  if (typeof runtimeMeta.lastComputedMessageIndex === "number" &&
      runtimeMeta.lastComputedMessageIndex >= 0 &&
      runtimeMeta.lastComputedMessageIndex <= targetIndex &&
      runtimeMeta.lastComputedStateCheckpoint) {
    baseState = cloneEngineState(runtimeMeta.lastComputedStateCheckpoint);
    startIndex = runtimeMeta.lastComputedMessageIndex + 1;
  }

  // 获取参数定义、实体定义和 Cast 配置
  const charConfig = getConfigForCurrentCharacter();
  const parameterDefs = Array.isArray(charConfig.parameters) ? charConfig.parameters : [];
  const entityDefs = Array.isArray(charConfig.entities) ? charConfig.entities : [];
  const castConfig = charConfig?.options?.castConfig || null;

  let current = baseState;
  const upper = Math.min(targetIndex, chat.length - 1);

  for (let i = startIndex; i <= upper; i++) {
    const msg = chat[i];
    if (!msg || typeof msg !== "object") continue;
    if (msg.is_user) continue; // 只对 AI 消息应用 ChangeSet

    const cs = getChangeSetForIndex(i);
    if (!cs) continue;

    current = applyChangeSet(current, cs, parameterDefs, entityDefs, castConfig);
  }

  return current;
}

/**
 * 从 greeting 文本中解析手写的 ce.set("路径","op或值","可选原因") 指令，
 * 以及 ce.scene 和 ce.cast 的声明式初始化，
 * 生成一份用于初始化的 CeChangeSet。
 *
 * 约定：
 * - ce.set 仅解析双引号形式：ce.set("艾莉娅.好感度.玩家", "set_70", "理由");
 * - 第二个参数支持：
 *   - "70" 或 "-3.5"  → 直接视为数值 set；
 *   - "set_70"        → 解析为 set 70；
 *   - "up_small" 等   → 视为 symbolic 操作（交给后续数值映射模块处理）；
 *   - 其它字符串      → 视为普通字符串值，使用 set。
 * - ce.scene.location = "地点名称"
 * - ce.scene.tags = ["标签1", "标签2"]
 * - ce.cast.focus = ["角色1", "角色2"]
 * - ce.cast.presentSupporting = ["角色3"]
 * - ce.cast.offstageRelated = ["角色4"]
 *
 * @param {string} text
 * @returns {import("../core/change-set.js").CeChangeSet|null}
 */
export function parseInitialCeSetFromGreetingText(text) {
  if (!text || typeof text !== "string") return null;

  const cs = createEmptyChangeSet();
  let hasAnyContent = false;

  // 1. 解析 ce.set() 变量操作
  const setRegex = /ce\.set\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"(?:\s*,\s*"([^"]*)")?\s*\)/g;
  /** @type {import("../core/change-set.js").CeVariableOp[]} */
  const variables = [];
  let match;

  // eslint-disable-next-line no-cond-assign
  while ((match = setRegex.exec(text)) !== null) {
    const path = (match[1] || "").trim();
    const opRaw = (match[2] || "").trim();
    const reason = (match[3] || "").trim();

    if (!path || !opRaw) continue;

    const opInfo = interpretCeSetOp(opRaw);

    /** @type {import("../core/change-set.js").CeVariableOp} */
    const v = {
      path,
      key: path,
      op: opInfo.op,
      value: opInfo.value,
      symbol: opInfo.symbol,
      meta: reason ? { reason } : undefined
    };

    // 附加 parsedPath 信息（关键修复：确保路径式存储正确）
    const vWithPath = withParsedPath(v);
    variables.push(vWithPath);
    hasAnyContent = true;
  }

  if (variables.length > 0) {
    cs.stateDelta = { variables };
  }

  // 2. 解析 ce.scene.location
  const locationMatch = /ce\.scene\.location\s*=\s*"([^"]+)"/i.exec(text);
  if (locationMatch) {
    const location = (locationMatch[1] || "").trim();
    if (location) {
      if (!cs.sceneDelta) cs.sceneDelta = {};
      cs.sceneDelta.locationHint = { op: "set", value: location };
      hasAnyContent = true;
    }
  }

  // 3. 解析 ce.scene.tags = ["tag1", "tag2"]（覆盖语义：set）
  const tagsMatch = /ce\.scene\.tags\s*=\s*\[([^\]]*)\]/i.exec(text);
  if (tagsMatch) {
    const tagsStr = tagsMatch[1] || "";
    const tags = tagsStr
      .split(",")
      .map(s => s.trim().replace(/^["']|["']$/g, ""))
      .filter(s => s.length > 0);

    if (!cs.sceneDelta) cs.sceneDelta = {};
    // 覆盖语义：无论是否为空数组，都作为 set 应用；支持清空标签
    cs.sceneDelta.sceneTags = { set: tags };
    hasAnyContent = true;
  }

  // 4. 解析 ce.cast.focus / presentSupporting / offstageRelated
  const castLayers = ["focus", "presentSupporting", "offstageRelated"];
  for (const layer of castLayers) {
    const castRegex = new RegExp(`ce\\.cast\\.${layer}\\s*=\\s*\\[([^\\]]*)\\]`, "i");
    const castMatch = castRegex.exec(text);
    if (castMatch) {
      const namesStr = castMatch[1] || "";
      const names = namesStr
        .split(",")
        .map(s => s.trim().replace(/^["']|["']$/g, ""))
        .filter(s => s.length > 0);
      
      if (names.length > 0) {
        if (!cs.sceneDelta) cs.sceneDelta = {};
        if (!cs.sceneDelta.castIntent) {
          cs.sceneDelta.castIntent = {};
        }
        // 使用 enter 提案，引擎会根据层级自动分配
        if (!cs.sceneDelta.castIntent.enter) {
          cs.sceneDelta.castIntent.enter = [];
        }
        // 为每个角色添加层级提示（通过 meta）
        for (const name of names) {
          cs.sceneDelta.castIntent.enter.push({
            name,
            preferredLayer: layer
          });
        }
        hasAnyContent = true;
      }
    }
  }

  return hasAnyContent ? cs : null;
}


/**
 * 解析 ce.set 第二个参数的含义。
 *
 * @param {string} raw
 * @returns {{ op: "set"|"add"|"symbolic", value: any, symbol: string|undefined }}
 */
function interpretCeSetOp(raw) {
  const text = String(raw || "").trim();

  // 纯数字字符串 → 直接 set 数值
  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    return {
      op: "set",
      value: Number(text),
      symbol: undefined
    };
  }

  // set_70 / set_-3.5 形式 → set 数值
  const setMatch = /^set_(\-?\d+(?:\.\d+)?)$/i.exec(text);
  if (setMatch) {
    return {
      op: "set",
      value: Number(setMatch[1]),
      symbol: undefined
    };
  }

  // up_small / down_large 等符号操作，交给后续数值映射模块处理
  if (/^(up|down)_(small|medium|large)$/i.test(text)) {
    return {
      op: "symbolic",
      value: undefined,
      symbol: text
    };
  }

  // 其它情况：视为字符串值，使用 set
  return {
    op: "set",
    value: text,
    symbol: undefined
  };
}

/**
 * 从 greeting 消息文本中剥离 <CE_Init> 块，避免这些内部设定发送给 LLM。
 *
 * 约定：
 * - 仅处理当前 chat 中"第一条 AI 消息"（通常是 greeting）
 * - 只在第一次处理该消息时生效（通过 msg.ce_init_processed 标记防止重复）
 * - <CE_Init> 块之外的文本（正常人物台词）不会被修改
 * - 初始化逻辑已移至 getOrCreateEngineMeta() 中，本函数只负责剥离文本
 *
 * @param {Array<any>} chat
 */
export function applyCeInitFromGreeting(chat) {
  if (!Array.isArray(chat) || chat.length === 0) return;

  // 寻找第一条 AI 消息（is_user === false）
  let firstAiIndex = -1;
  for (let i = 0; i < chat.length; i++) {
    const msg = chat[i];
    if (msg && typeof msg === "object" && !msg.is_user) {
      firstAiIndex = i;
      break;
    }
  }
  if (firstAiIndex < 0) return;

  const msg = chat[firstAiIndex];

  // 避免重复处理同一条 greeting
  if (msg.ce_init_processed) {
    return;
  }

  const text = typeof msg.mes === "string" ? msg.mes : "";
  if (!text) {
    msg.ce_init_processed = true;
    return;
  }

  // 从文本中剥离 <CE_Init> ... </CE_Init> 块，避免发送给 LLM
  // - 大小写不敏感
  // - 允许块内包含任意文本（包括换行）
  const stripped = text.replace(/<CE_Init>[\s\S]*?<\/CE_Init>/gi, "").trim();

  if (stripped !== text) {
    msg.mes = stripped;
  }

  // 标记已处理，避免后续轮次重复扫描
  msg.ce_init_processed = true;
}