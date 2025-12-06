// 参数与提示配置的导出/导入工具

import { logDebug } from "./dom.js";

/**
 * 将配置导出为 JSON 格式
 * @param {import("../../../integration/card-storage.js").CeCharacterConfig} config
 * @returns {string}
 */
function exportToJson(config) {
  return JSON.stringify(config, null, 2);
}

/**
 * 从 JSON 字符串导入配置
 * @param {string} jsonStr
 * @returns {import("../../../integration/card-storage.js").CeCharacterConfig}
 * @throws {Error} 如果 JSON 格式无效
 */
function importFromJson(jsonStr) {
  try {
    const config = JSON.parse(jsonStr);
    return validateAndNormalizeConfig(config);
  } catch (err) {
    throw new Error(`JSON 解析失败: ${err.message}`);
  }
}


/**
 * 验证并规范化配置对象
 * @param {any} config
 * @returns {import("../../../integration/card-storage.js").CeCharacterConfig}
 * @throws {Error} 如果配置格式无效
 */
function validateAndNormalizeConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("配置必须是一个对象");
  }
  
  return {
    parameters: Array.isArray(config.parameters) ? config.parameters : [],
    promptTypes: Array.isArray(config.promptTypes) ? config.promptTypes : [],
    prompts: Array.isArray(config.prompts) ? config.prompts : [],
    entities: Array.isArray(config.entities) ? config.entities : [],
    initialState: config.initialState && typeof config.initialState === "object" 
      ? config.initialState 
      : {},
    options: config.options && typeof config.options === "object"
      ? config.options
      : {}
  };
}

/**
 * 导出配置到文件（JSON格式）
 * @param {import("../../../integration/card-storage.js").CeCharacterConfig} config
 * @param {string} [filename] - 可选的文件名（不含扩展名）
 */
export function exportConfig(config, filename) {
  const content = exportToJson(config);
  const defaultFilename = filename || `character-engine-config-${Date.now()}`;
  const fullFilename = `${defaultFilename}.json`;
  
  // 创建 Blob 并触发下载
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fullFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  logDebug(`配置已导出为 ${fullFilename}`);
}

/**
 * 从文件导入配置（仅支持JSON格式）
 * @param {File} file
 * @returns {Promise<import("../../../integration/card-storage.js").CeCharacterConfig>}
 */
export async function importConfig(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const content = e.target.result;
        const config = importFromJson(content);
        
        logDebug(`配置已从 ${file.name} 导入`);
        resolve(config);
      } catch (err) {
        reject(new Error(`导入失败: ${err.message}`));
      }
    };
    
    reader.onerror = () => {
      reject(new Error("文件读取失败"));
    };
    
    reader.readAsText(file);
  });
}

/**
 * 直接导出配置为JSON文件（无需对话框）
 * @param {import("../../../integration/card-storage.js").CeCharacterConfig} config
 * @param {string} characterName - 当前角色名称
 */
export function showExportDialog(config, characterName) {
  const safeCharName = characterName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_");
  const defaultFilename = `${safeCharName}_config`;
  
  try {
    exportConfig(config, defaultFilename);
  } catch (err) {
    showAlert(`导出失败: ${err.message}`);
  }
}

/**
 * 显示导入对话框（仅支持JSON格式）
 * @param {Function} onImport - 导入成功后的回调函数，接收导入的配置对象
 */
export function showImportDialog(onImport) {
  const dialog = document.createElement("div");
  dialog.className = "ce-modal-backdrop";
  dialog.style.zIndex = "10001";
  dialog.style.display = "flex"; // 确保显示
  
  dialog.innerHTML = `
    <div class="ce-modal" style="width: 500px; max-width: 90vw;">
      <div class="ce-modal-header">
        <div class="ce-modal-title">导入配置</div>
        <button class="ce-modal-close" type="button">×</button>
      </div>
      <div class="ce-modal-body" style="padding: 20px;">
        <div style="margin-bottom: 15px;">
          <label style="display: block; margin-bottom: 10px; font-weight: bold;">
            选择配置文件：
          </label>
          <input type="file" accept=".json" data-import-file
                 style="width: 100%;">
          <div class="ce-small-hint" style="margin-top: 10px;">
            仅支持 JSON (.json) 格式
          </div>
        </div>
        <div class="ce-warning-box" style="margin-top: 15px; padding: 10px;
             background: rgba(255, 193, 7, 0.15); border: 1px solid rgba(255, 193, 7, 0.5); border-radius: 4px; color: var(--SmartThemeBodyColor, #e9e9e9);">
          <strong style="color: #ffc107;">⚠️ 注意：</strong>导入配置将<strong>完全替换</strong>当前角色的所有参数、提示类型、提示条目和实体定义。
          建议在导入前先导出当前配置作为备份。
        </div>
      </div>
      <div class="ce-modal-footer">
        <div class="ce-modal-message" data-import-message style="flex: 1; margin-right: 10px; color: var(--SmartThemeBodyColor, #e9e9e9);"></div>
        <div class="ce-modal-footer-buttons">
          <button class="ce-btn ce-btn-secondary" data-action="select-file">选择文件并导入</button>
          <button class="ce-btn ce-btn-secondary" data-action="cancel">取消</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(dialog);
  
  const closeDialog = () => {
    document.body.removeChild(dialog);
  };
  
  const fileInput = dialog.querySelector('[data-import-file]');
  const selectBtn = dialog.querySelector('[data-action="select-file"]');
  const messageEl = dialog.querySelector('[data-import-message]');
  
  // 文件选择事件 - 选择后自动导入
  fileInput.addEventListener("change", async (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) {
      messageEl.textContent = "";
      messageEl.style.color = "";
      return;
    }
    
    // 禁用按钮，显示导入中状态
    selectBtn.disabled = true;
    selectBtn.textContent = "导入中...";
    messageEl.textContent = `正在导入 ${selectedFile.name}...`;
    messageEl.dataset.ceMessageType = "info";
    messageEl.style.color = "#0066cc"; // 蓝色文本
    
    try {
      const config = await importConfig(selectedFile);
      messageEl.textContent = "导入成功！";
      messageEl.dataset.ceMessageType = "success";
      messageEl.style.color = "#28a745"; // 绿色文本
      
      setTimeout(() => {
        closeDialog();
        onImport(config);
      }, 500);
    } catch (err) {
      messageEl.textContent = err.message;
      messageEl.dataset.ceMessageType = "error";
      messageEl.style.color = "#dc3545"; // 红色文本
      selectBtn.disabled = false;
      selectBtn.textContent = "选择文件并导入";
      // 清空文件输入，允许重新选择
      fileInput.value = "";
    }
  });
  
  // 关闭按钮
  dialog.querySelector(".ce-modal-close").addEventListener("click", closeDialog);
  
  // 背景点击关闭
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) closeDialog();
  });
  
  // 按钮事件
  dialog.querySelector('[data-action="cancel"]').addEventListener("click", closeDialog);
  
  // 选择文件按钮点击事件 - 触发文件选择器
  selectBtn.addEventListener("click", () => {
    fileInput.click();
  });
}