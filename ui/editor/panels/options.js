// 角色卡选项面板

/**
 * 初始化选项面板 DOM 结构
 * @param {HTMLElement} panel
 */
export function initOptionsPanel(panel) {
  panel.innerHTML = `
    <div class="ce-section-header">
      <span>角色卡级选项</span>
    </div>
    <div class="ce-form-grid">
      <label class="ce-checkbox-row">
        <input type="checkbox" data-ce-option="disableShortTermEmotion" />
        <span>禁用该角色卡的短期情绪（short-term emotion）</span>
      </label>
      <label class="ce-checkbox-row">
        <input type="checkbox" data-ce-option="disableShortTermIntent" />
        <span>禁用该角色卡的短期意图（short-term intent）</span>
      </label>
      <div class="ce-small-hint">
        若勾选，本角色卡下的所有角色与实体都不会要求解析模型输出对应的短期变量。
      </div>
    </div>
  `;
}

/**
 * 渲染选项数据
 * @param {HTMLElement} root
 * @param {any} options
 */
export function renderOptions(root, options) {
  const emotionEl = /** @type {HTMLInputElement|null} */ (
    root.querySelector('[data-ce-option="disableShortTermEmotion"]')
  );
  const intentEl = /** @type {HTMLInputElement|null} */ (
    root.querySelector('[data-ce-option="disableShortTermIntent"]')
  );
  if (emotionEl) {
    emotionEl.checked = !!options.disableShortTermEmotion;
  }
  if (intentEl) {
    intentEl.checked = !!options.disableShortTermIntent;
  }
}

/**
 * 从 UI 收集选项数据
 * @param {HTMLElement} root
 * @returns {{disableShortTermEmotion: boolean, disableShortTermIntent: boolean}}
 */
export function collectOptions(root) {
  const emotionEl = /** @type {HTMLInputElement|null} */ (
    root.querySelector('[data-ce-option="disableShortTermEmotion"]')
  );
  const intentEl = /** @type {HTMLInputElement|null} */ (
    root.querySelector('[data-ce-option="disableShortTermIntent"]')
  );
  return {
    disableShortTermEmotion: !!emotionEl?.checked,
    disableShortTermIntent: !!intentEl?.checked
  };
}