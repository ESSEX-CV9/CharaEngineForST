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
    
    <!-- 短期状态选项 -->
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

    <!-- Cast 管理配置 -->
    <div class="ce-section-header" style="margin-top:20px;">
      <span>Cast 管理配置</span>
    </div>
    <div class="ce-form-grid">
      <div class="ce-small-hint" style="margin-bottom:12px;">
        配置角色 Cast 的层级上限。这些上限决定了同时可以加载多少角色的完整人设与变量解析。
        根据你的 token 预算和游戏复杂度调整这些值。
      </div>
      
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px;">
        <div>
          <label style="display:block;margin-bottom:4px;font-weight:500;">Focus 层上限</label>
          <input type="number"
                 data-ce-cast-limit="maxFocus"
                 min="1"
                 max="10"
                 value="3"
                 style="width:100%;box-sizing:border-box;font-size:0.85rem;background-color:#202020;color:#f5f5f5;border:1px solid var(--SmartThemeBorderColor,#555);padding:4px 6px;border-radius:3px;" />
          <div class="ce-small-hint" style="margin-top:2px;">
            主视角角色（完整加载）
          </div>
        </div>
        
        <div>
          <label style="display:block;margin-bottom:4px;font-weight:500;">Supporting 层上限</label>
          <input type="number"
                 data-ce-cast-limit="maxPresentSupporting"
                 min="0"
                 max="20"
                 value="5"
                 style="width:100%;box-sizing:border-box;font-size:0.85rem;background-color:#202020;color:#f5f5f5;border:1px solid var(--SmartThemeBorderColor,#555);padding:4px 6px;border-radius:3px;" />
          <div class="ce-small-hint" style="margin-top:2px;">
            在场配角（压缩加载）
          </div>
        </div>
        
        <div>
          <label style="display:block;margin-bottom:4px;font-weight:500;">Offstage 层上限</label>
          <input type="number"
                 data-ce-cast-limit="maxOffstageRelated"
                 min="0"
                 max="30"
                 value="10"
                 style="width:100%;box-sizing:border-box;font-size:0.85rem;background-color:#202020;color:#f5f5f5;border:1px solid var(--SmartThemeBorderColor,#555);padding:4px 6px;border-radius:3px;" />
          <div class="ce-small-hint" style="margin-top:2px;">
            场外相关角色（仅索引）
          </div>
        </div>
      </div>
    </div>

    <!-- 地点 Cast 配置 -->
    <div class="ce-section-header" style="margin-top:20px;">
      <span>地点 Cast 配置</span>
    </div>
    <div class="ce-form-grid">
      <div class="ce-small-hint" style="margin-bottom:12px;">
        配置地点 Cast 的候选地点上限。当前地点会完整加载，候选地点仅注入名称。
      </div>
      
      <div style="max-width:300px;">
        <label style="display:block;margin-bottom:4px;font-weight:500;">候选地点上限</label>
        <input type="number"
               data-ce-location-limit="maxCandidate"
               min="0"
               max="50"
               value="10"
               style="width:100%;box-sizing:border-box;font-size:0.85rem;background-color:#202020;color:#f5f5f5;border:1px solid var(--SmartThemeBorderColor,#555);padding:4px 6px;border-radius:3px;" />
        <div class="ce-small-hint" style="margin-top:2px;">
          除当前地点外，可以保留多少个候选地点
        </div>
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
  // 短期状态选项
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

  // Cast 层级上限配置
  const castConfig = options.castConfig || {};
  const characterCast = castConfig.characterCast || {};
  
  const maxFocusEl = /** @type {HTMLInputElement|null} */ (
    root.querySelector('[data-ce-cast-limit="maxFocus"]')
  );
  const maxSupportingEl = /** @type {HTMLInputElement|null} */ (
    root.querySelector('[data-ce-cast-limit="maxPresentSupporting"]')
  );
  const maxOffstageEl = /** @type {HTMLInputElement|null} */ (
    root.querySelector('[data-ce-cast-limit="maxOffstageRelated"]')
  );
  
  if (maxFocusEl) {
    maxFocusEl.value = String(characterCast.maxFocus ?? 3);
  }
  if (maxSupportingEl) {
    maxSupportingEl.value = String(characterCast.maxPresentSupporting ?? 5);
  }
  if (maxOffstageEl) {
    maxOffstageEl.value = String(characterCast.maxOffstageRelated ?? 10);
  }

  // 地点 Cast 配置
  const locationCast = castConfig.locationCast || {};
  
  const maxCandidateEl = /** @type {HTMLInputElement|null} */ (
    root.querySelector('[data-ce-location-limit="maxCandidate"]')
  );
  
  if (maxCandidateEl) {
    maxCandidateEl.value = String(locationCast.maxCandidate ?? 10);
  }
}

/**
 * 从 UI 收集选项数据
 * @param {HTMLElement} root
 * @returns {{
 *   disableShortTermEmotion: boolean,
 *   disableShortTermIntent: boolean,
 *   castConfig: {
 *     characterCast: {
 *       maxFocus: number,
 *       maxPresentSupporting: number,
 *       maxOffstageRelated: number
 *     },
 *     locationCast: {
 *       maxCandidate: number
 *     }
 *   }
 * }}
 */
export function collectOptions(root) {
  // 短期状态选项
  const emotionEl = /** @type {HTMLInputElement|null} */ (
    root.querySelector('[data-ce-option="disableShortTermEmotion"]')
  );
  const intentEl = /** @type {HTMLInputElement|null} */ (
    root.querySelector('[data-ce-option="disableShortTermIntent"]')
  );

  // Cast 层级上限
  const maxFocusEl = /** @type {HTMLInputElement|null} */ (
    root.querySelector('[data-ce-cast-limit="maxFocus"]')
  );
  const maxSupportingEl = /** @type {HTMLInputElement|null} */ (
    root.querySelector('[data-ce-cast-limit="maxPresentSupporting"]')
  );
  const maxOffstageEl = /** @type {HTMLInputElement|null} */ (
    root.querySelector('[data-ce-cast-limit="maxOffstageRelated"]')
  );

  // 地点 Cast 上限
  const maxCandidateEl = /** @type {HTMLInputElement|null} */ (
    root.querySelector('[data-ce-location-limit="maxCandidate"]')
  );

  return {
    disableShortTermEmotion: !!emotionEl?.checked,
    disableShortTermIntent: !!intentEl?.checked,
    castConfig: {
      characterCast: {
        maxFocus: parseInt(maxFocusEl?.value || "3", 10),
        maxPresentSupporting: parseInt(maxSupportingEl?.value || "5", 10),
        maxOffstageRelated: parseInt(maxOffstageEl?.value || "10", 10)
      },
      locationCast: {
        maxCandidate: parseInt(maxCandidateEl?.value || "10", 10)
      }
    }
  };
}