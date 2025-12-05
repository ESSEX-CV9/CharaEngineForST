import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../../script.js";
import { openCeEditorPanel } from "./ui/editor-panel.js";
import { openCeStateObserverPanel } from "./ui/state-observer.js";
import { ceGenerateInterceptor } from "./orchestration/interceptor.js";
import { getCallGenerateService, handleGenerateRequest } from "./services/call-generate.js";

// ⭐ 条件导入RAG子系统
let ragSystem = null;

const EXT_ID = "CharacterEngine";
const EXT_NAME = "角色引擎";
const extensionFolderPath = `scripts/extensions/third-party/${EXT_ID}`;

// 初始化扩展设置（持久化在 ST 侧）
extension_settings[EXT_ID] = extension_settings[EXT_ID] || {
  enabled: true,
  useEarlyParse: true,
  useSceneAndCast: true,  // 强制启用，核心功能
  useWorldRag: false,
  parseStreaming: true  // 强制启用，核心功能
};

// 强制启用核心功能（即使用户之前关闭过）
extension_settings[EXT_ID].useSceneAndCast = true;
extension_settings[EXT_ID].parseStreaming = true;

const settings = extension_settings[EXT_ID];
let isEnabled = !!settings.enabled;

/**
 * 初始化RAG子系统（如果启用）
 */
async function initializeRagIfEnabled() {
  if (!settings.useWorldRag) {
    console.log('[CharacterEngine] RAG功能未启用');
    return;
  }

  try {
    console.log('[CharacterEngine] 正在加载RAG子系统...');
    ragSystem = await import('./rag/index.js');
    await ragSystem.initializeRagSystem();
    console.log('[CharacterEngine] RAG子系统加载成功');
  } catch (err) {
    console.error('[CharacterEngine] RAG子系统加载失败:', err);
    ragSystem = null;
  }
}

function logDebug(...args) {
  // eslint-disable-next-line no-console
  console.debug("[CharacterEngine]", ...args);
}

async function setupSettingsPanel() {
  try {
    const root = document.querySelector("#extensions_settings");
    if (!root) return;

    // 避免重复注入
    if (root.querySelector('[data-ce-settings-root="true"]')) {
      return;
    }

    const resp = await fetch(`${extensionFolderPath}/settings.html`);
    if (!resp.ok) {
      return;
    }
    const html = await resp.text();
    const container = document.createElement("div");
    container.dataset.ceSettingsRoot = "true";
    container.innerHTML = html;
    root.appendChild(container);

    wireSettingsForm(container);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[CharacterEngine] 初始化设置面板失败", err);
  }
}

function wireSettingsForm(container) {
  const enableCheckbox = container.querySelector("#ce_enabled");
  const earlyParseCheckbox = container.querySelector("#ce_use_early_parse");
  const worldRagCheckbox = container.querySelector("#ce_use_world_rag");
  const openEditorBtn = container.querySelector("#ce_open_editor");
  const openStateObserverBtn = container.querySelector("#ce_open_state_observer");

  if (enableCheckbox) {
    enableCheckbox.checked = !!settings.enabled;
    enableCheckbox.addEventListener("change", () => {
      settings.enabled = enableCheckbox.checked;
      isEnabled = settings.enabled;
      saveSettingsDebounced();
    });
  }

  if (earlyParseCheckbox) {
    earlyParseCheckbox.checked = settings.useEarlyParse !== false;
    earlyParseCheckbox.addEventListener("change", () => {
      settings.useEarlyParse = earlyParseCheckbox.checked;
      saveSettingsDebounced();
    });
  }

  // parseStreaming 和 useSceneAndCast 已强制启用，不再提供用户控制

  if (worldRagCheckbox) {
    worldRagCheckbox.checked = !!settings.useWorldRag;
    worldRagCheckbox.addEventListener("change", async () => {
      const wasEnabled = settings.useWorldRag;
      settings.useWorldRag = worldRagCheckbox.checked;
      saveSettingsDebounced();
      
      // 如果从未启用变为启用，尝试初始化
      if (!wasEnabled && settings.useWorldRag && !ragSystem) {
        await initializeRagIfEnabled();
      }
    });
  }

  // ⭐ RAG管理按钮（无论是否启用RAG都可以打开）
  const openLoreManagerBtn = container.querySelector("#ce_open_lore_manager");
  if (openLoreManagerBtn) {
    openLoreManagerBtn.addEventListener("click", async () => {
      try {
        // 确保RAG系统已加载（无论是否启用）
        if (!ragSystem) {
          console.log('[CharacterEngine] 加载RAG子系统...');
          ragSystem = await import('./rag/index.js');
          await ragSystem.initializeRagSystem();
        }
        
        // 打开管理器
        ragSystem.openLoreManager();
      } catch (err) {
        console.error('[CharacterEngine] 打开世界观设定管理器失败', err);
        alert(`打开失败: ${err.message}`);
      }
    });
  }

  // ⭐ RAG检索测试器按钮
  const openRetrievalTesterBtn = container.querySelector("#ce_open_retrieval_tester");
  if (openRetrievalTesterBtn) {
    openRetrievalTesterBtn.addEventListener("click", async () => {
      try {
        // 确保RAG系统已加载（无论是否启用）
        if (!ragSystem) {
          console.log('[CharacterEngine] 加载RAG子系统...');
          ragSystem = await import('./rag/index.js');
          await ragSystem.initializeRagSystem();
        }
        
        // 打开检索测试器
        ragSystem.openRetrievalTester();
      } catch (err) {
        console.error('[CharacterEngine] 打开RAG检索测试器失败', err);
        alert(`打开失败: ${err.message}`);
      }
    });
  }

  if (openEditorBtn) {
    openEditorBtn.addEventListener("click", () => {
      try {
        openCeEditorPanel();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[CharacterEngine] 打开参数/提示编辑器失败", err);
      }
    });
  }

  if (openStateObserverBtn) {
    openStateObserverBtn.addEventListener("click", () => {
      try {
        openCeStateObserverPanel();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[CharacterEngine] 打开参数/状态观察器失败", err);
      }
    });
  }
}

function registerEvents() {
  try {
    if (!eventSource || !event_types) return;

    eventSource.on(event_types.APP_READY, () => {
      logDebug("APP_READY");
      setupSettingsPanel();
    });

    // MESSAGE_RECEIVED 监听器已删除
    // ChangeSet 现在在拦截器中立即存储到 changeSetsByIndex，不再需要后续绑定
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[CharacterEngine] 注册事件失败", err);
  }
}

// 在全局挂载拦截器，供 ST 按 manifest.generate_interceptor 调用
globalThis.ceGenerateInterceptor = ceGenerateInterceptor;

// ===== 全局 API 暴露：CharacterEngine.callGenerate =====
// 创建命名空间
if (typeof window !== 'undefined') {
  window.CharacterEngine = window.CharacterEngine || {};
  
  /**
   * 全局 callGenerate 函数
   * 使用方式与小白X完全一致，但使用独立命名空间
   *
   * @param {Object} options - 生成选项
   * @returns {Promise<Object>} 生成结果
   *
   * @example
   * const res = await window.CharacterEngine.callGenerate({
   *     components: { list: ['ALL_PREON'] },
   *     userInput: '你好',
   *     streaming: { enabled: true },
   *     api: { inherit: true }
   * });
   */
  window.CharacterEngine.callGenerate = async function(options) {
    return new Promise((resolve, reject) => {
      const requestId = `ce-global-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const streamingEnabled = options?.streaming?.enabled !== false;
      
      // 处理流式回调
      let onChunkCallback = null;
      if (streamingEnabled && typeof options?.streaming?.onChunk === 'function') {
        onChunkCallback = options.streaming.onChunk;
      }
      
      // 监听响应
      const listener = (event) => {
        const data = event.data;
        if (!data || data.source !== 'character-engine-cg' || data.id !== requestId) return;
        
        if (data.type === 'generateStreamChunk' && onChunkCallback) {
          // 流式文本块回调
          try {
            onChunkCallback(data.chunk, data.accumulated);
          } catch (err) {
            console.error('[CharacterEngine] onChunk callback error:', err);
          }
        } else if (data.type === 'generateStreamComplete') {
          window.removeEventListener('message', listener);
          resolve(data.result);
        } else if (data.type === 'generateResult') {
          window.removeEventListener('message', listener);
          resolve(data.result);
        } else if (data.type === 'generateStreamError' || data.type === 'generateError') {
          window.removeEventListener('message', listener);
          reject(data.error);
        }
      };
      
      window.addEventListener('message', listener);
      
      // 发送请求
      handleGenerateRequest(options, requestId, window).catch(err => {
        window.removeEventListener('message', listener);
        reject(err);
      });
    });
  };
  
  /**
   * 取消指定会话
   * @param {string} sessionId - 会话 ID（如 'ce1', 'ce2' 等）
   */
  window.CharacterEngine.callGenerate.cancel = function(sessionId) {
    const service = getCallGenerateService();
    service.cancel(sessionId);
  };
  
  /**
   * 清理所有会话
   */
  window.CharacterEngine.callGenerate.cleanup = function() {
    const service = getCallGenerateService();
    service.cleanup();
  };
  
  // 保留内部接口（用于调试和高级用法）
  window.CharacterEngine._internal = window.CharacterEngine._internal || {};
  window.CharacterEngine._internal.callGenerateService = getCallGenerateService();
  window.CharacterEngine._internal.handleGenerateRequest = handleGenerateRequest;
  
  logDebug("全局 API 已注册: window.CharacterEngine.callGenerate");
}

// 入口初始化：尽早注册事件
(function init() {
  logDebug(`${EXT_NAME} 扩展初始化`);
  registerEvents();

  // 在某些情况下 APP_READY 可能已经触发，这里兜底调用一次
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setupSettingsPanel().then(() => {
      // 设置面板加载后，初始化RAG（如果启用）
      initializeRagIfEnabled();
    });
  } else {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        setupSettingsPanel().then(() => {
          initializeRagIfEnabled();
        });
      },
      { once: true }
    );
  }
})();

export { ceGenerateInterceptor, getCallGenerateService, handleGenerateRequest };