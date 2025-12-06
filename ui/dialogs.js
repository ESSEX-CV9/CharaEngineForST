/**
 * ST风格的弹窗工具函数
 * 用于替代浏览器原生的 alert、confirm、prompt
 */

/**
 * 显示ST风格的提示弹窗（替代alert）
 * @param {string} message - 提示消息
 * @returns {Promise<void>}
 */
export function showAlert(message) {
  return new Promise((resolve) => {
    const backdrop = createDialogBackdrop();
    const dialog = document.createElement('div');
    dialog.className = 'ce-dialog ce-dialog-alert';
    
    dialog.innerHTML = `
      <div class="ce-dialog-header">
        <div class="ce-dialog-title">提示</div>
      </div>
      <div class="ce-dialog-body">
        <div class="ce-dialog-message">${escapeHtml(message)}</div>
      </div>
      <div class="ce-dialog-footer">
        <button class="ce-btn ce-btn-primary" data-action="ok">确定</button>
      </div>
    `;
    
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    
    // 聚焦到确定按钮
    setTimeout(() => {
      const okBtn = dialog.querySelector('[data-action="ok"]');
      if (okBtn) okBtn.focus();
    }, 100);
    
    // 绑定事件
    const okBtn = dialog.querySelector('[data-action="ok"]');
    const handleClose = () => {
      backdrop.remove();
      resolve();
    };
    
    if (okBtn) {
      okBtn.addEventListener('click', handleClose);
    }
    
    // 支持ESC键关闭
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', handleKeydown);
        handleClose();
      }
    };
    document.addEventListener('keydown', handleKeydown);
    
    // 点击背景关闭
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        document.removeEventListener('keydown', handleKeydown);
        handleClose();
      }
    });
  });
}

/**
 * 显示ST风格的确认弹窗（替代confirm）
 * @param {string} message - 确认消息
 * @param {string} [title='确认'] - 弹窗标题
 * @returns {Promise<boolean>} - 用户是否确认
 */
export function showConfirm(message, title = '确认') {
  return new Promise((resolve) => {
    const backdrop = createDialogBackdrop();
    const dialog = document.createElement('div');
    dialog.className = 'ce-dialog ce-dialog-confirm';
    
    dialog.innerHTML = `
      <div class="ce-dialog-header">
        <div class="ce-dialog-title">${escapeHtml(title)}</div>
      </div>
      <div class="ce-dialog-body">
        <div class="ce-dialog-message">${escapeHtml(message)}</div>
      </div>
      <div class="ce-dialog-footer">
        <button class="ce-btn ce-btn-secondary" data-action="cancel">取消</button>
        <button class="ce-btn ce-btn-primary" data-action="confirm">确定</button>
      </div>
    `;
    
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    
    // 聚焦到确定按钮
    setTimeout(() => {
      const confirmBtn = dialog.querySelector('[data-action="confirm"]');
      if (confirmBtn) confirmBtn.focus();
    }, 100);
    
    // 绑定事件
    const confirmBtn = dialog.querySelector('[data-action="confirm"]');
    const cancelBtn = dialog.querySelector('[data-action="cancel"]');
    
    const handleClose = (result) => {
      backdrop.remove();
      document.removeEventListener('keydown', handleKeydown);
      resolve(result);
    };
    
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => handleClose(true));
    }
    
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => handleClose(false));
    }
    
    // 支持ESC键取消
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        handleClose(false);
      } else if (e.key === 'Enter') {
        handleClose(true);
      }
    };
    document.addEventListener('keydown', handleKeydown);
    
    // 点击背景取消
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        handleClose(false);
      }
    });
  });
}

/**
 * 显示ST风格的输入弹窗（替代prompt）
 * @param {string} message - 提示消息
 * @param {string} [defaultValue=''] - 默认值
 * @param {string} [title='输入'] - 弹窗标题
 * @returns {Promise<string|null>} - 用户输入的值，取消则返回null
 */
export function showPrompt(message, defaultValue = '', title = '输入') {
  return new Promise((resolve) => {
    const backdrop = createDialogBackdrop();
    const dialog = document.createElement('div');
    dialog.className = 'ce-dialog ce-dialog-prompt';
    
    dialog.innerHTML = `
      <div class="ce-dialog-header">
        <div class="ce-dialog-title">${escapeHtml(title)}</div>
      </div>
      <div class="ce-dialog-body">
        <div class="ce-dialog-message">${escapeHtml(message)}</div>
        <input type="text" class="ce-dialog-input" value="${escapeHtml(defaultValue)}" />
      </div>
      <div class="ce-dialog-footer">
        <button class="ce-btn ce-btn-secondary" data-action="cancel">取消</button>
        <button class="ce-btn ce-btn-primary" data-action="confirm">确定</button>
      </div>
    `;
    
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    
    const input = dialog.querySelector('.ce-dialog-input');
    const confirmBtn = dialog.querySelector('[data-action="confirm"]');
    const cancelBtn = dialog.querySelector('[data-action="cancel"]');
    
    // 聚焦到输入框并选中文本
    setTimeout(() => {
      if (input) {
        input.focus();
        input.select();
      }
    }, 100);
    
    const handleClose = (result) => {
      backdrop.remove();
      document.removeEventListener('keydown', handleKeydown);
      resolve(result);
    };
    
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        handleClose(input ? input.value : null);
      });
    }
    
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => handleClose(null));
    }
    
    // 支持Enter确认和ESC取消
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        handleClose(null);
      } else if (e.key === 'Enter' && document.activeElement === input) {
        handleClose(input ? input.value : null);
      }
    };
    document.addEventListener('keydown', handleKeydown);
    
    // 点击背景取消
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        handleClose(null);
      }
    });
  });
}

/**
 * 显示ST风格的多行输入弹窗
 * @param {string} message - 提示消息
 * @param {string} [defaultValue=''] - 默认值
 * @param {string} [title='输入'] - 弹窗标题
 * @returns {Promise<string|null>} - 用户输入的值，取消则返回null
 */
export function showTextAreaPrompt(message, defaultValue = '', title = '输入') {
  return new Promise((resolve) => {
    const backdrop = createDialogBackdrop();
    const dialog = document.createElement('div');
    dialog.className = 'ce-dialog ce-dialog-prompt ce-dialog-textarea';
    
    dialog.innerHTML = `
      <div class="ce-dialog-header">
        <div class="ce-dialog-title">${escapeHtml(title)}</div>
      </div>
      <div class="ce-dialog-body">
        <div class="ce-dialog-message">${escapeHtml(message)}</div>
        <textarea class="ce-dialog-textarea" rows="5">${escapeHtml(defaultValue)}</textarea>
      </div>
      <div class="ce-dialog-footer">
        <button class="ce-btn ce-btn-secondary" data-action="cancel">取消</button>
        <button class="ce-btn ce-btn-primary" data-action="confirm">确定</button>
      </div>
    `;
    
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    
    const textarea = dialog.querySelector('.ce-dialog-textarea');
    const confirmBtn = dialog.querySelector('[data-action="confirm"]');
    const cancelBtn = dialog.querySelector('[data-action="cancel"]');
    
    // 聚焦到文本框并选中文本
    setTimeout(() => {
      if (textarea) {
        textarea.focus();
        textarea.select();
      }
    }, 100);
    
    const handleClose = (result) => {
      backdrop.remove();
      document.removeEventListener('keydown', handleKeydown);
      resolve(result);
    };
    
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        handleClose(textarea ? textarea.value : null);
      });
    }
    
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => handleClose(null));
    }
    
    // 支持ESC取消（不支持Enter确认，因为多行输入需要换行）
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        handleClose(null);
      }
    };
    document.addEventListener('keydown', handleKeydown);
    
    // 点击背景取消
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        handleClose(null);
      }
    });
  });
}

/**
 * 创建弹窗背景遮罩
 * @returns {HTMLElement}
 */
function createDialogBackdrop() {
  const backdrop = document.createElement('div');
  backdrop.className = 'ce-dialog-backdrop';
  return backdrop;
}

/**
 * 转义HTML特殊字符
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}