// 通用的折叠列表工具函数模块
// 提供折叠展开和拖拽排序的通用功能

/**
 * 创建折叠卡片的 DOM 结构
 * @param {Object} options - 配置选项
 * @param {string} options.rowId - 行唯一标识
 * @param {string} options.headerContent - 头部（紧凑视图）HTML 内容
 * @param {string} options.bodyContent - 主体（展开视图）HTML 内容
 * @param {boolean} [options.collapsed=false] - 是否默认折叠
 * @param {boolean} [options.draggable=true] - 是否可拖拽
 * @returns {HTMLElement}
 */
export function createCollapsibleCard(options) {
  const {
    rowId,
    headerContent,
    bodyContent,
    collapsed = false,
    draggable = true
  } = options;

  const card = document.createElement('div');
  card.className = 'ce-collapsible-card';
  card.dataset.rowId = rowId;
  // 不在卡片上设置 draggable，而是在拖拽手柄上设置

  const toggleIcon = collapsed ? 'fa-circle-chevron-right' : 'fa-circle-chevron-down';
  const contentDisplay = collapsed ? 'none' : 'block';

  card.innerHTML = `
    <div class="ce-collapsible-card-header">
      ${draggable ? '<i class="fa-solid fa-grip-vertical ce-drag-handle" draggable="true" title="拖拽排序"></i>' : ''}
      <i class="fa-solid ${toggleIcon} ce-collapsible-toggle interactable" data-ce-action="toggle-collapse" title="展开/折叠"></i>
      ${headerContent}
    </div>
    <div class="ce-collapsible-card-content" style="display: ${contentDisplay};">
      ${bodyContent}
    </div>
  `;

  return card;
}

/**
 * 切换折叠状态
 * @param {HTMLElement} card - 卡片元素
 * @returns {boolean} - 切换后的折叠状态（true=折叠，false=展开）
 */
export function toggleCollapse(card) {
  const content = card.querySelector('.ce-collapsible-card-content');
  const icon = card.querySelector('.ce-collapsible-toggle');
  
  if (!content || !icon) return false;

  const isCollapsed = content.style.display === 'none';
  
  if (isCollapsed) {
    // 展开
    content.style.display = 'block';
    icon.classList.remove('fa-circle-chevron-right');
    icon.classList.add('fa-circle-chevron-down');
    return false;
  } else {
    // 折叠
    content.style.display = 'none';
    icon.classList.remove('fa-circle-chevron-down');
    icon.classList.add('fa-circle-chevron-right');
    return true;
  }
}

/**
 * 获取卡片的折叠状态
 * @param {HTMLElement} card - 卡片元素
 * @returns {boolean} - true=折叠，false=展开
 */
export function isCollapsed(card) {
  const content = card.querySelector('.ce-collapsible-card-content');
  return content ? content.style.display === 'none' : false;
}

/**
 * 设置卡片的折叠状态
 * @param {HTMLElement} card - 卡片元素
 * @param {boolean} collapsed - 是否折叠
 */
export function setCollapsed(card, collapsed) {
  const content = card.querySelector('.ce-collapsible-card-content');
  const icon = card.querySelector('.ce-collapsible-toggle');
  
  if (!content || !icon) return;

  if (collapsed) {
    content.style.display = 'none';
    icon.classList.remove('fa-circle-chevron-down');
    icon.classList.add('fa-circle-chevron-right');
  } else {
    content.style.display = 'block';
    icon.classList.remove('fa-circle-chevron-right');
    icon.classList.add('fa-circle-chevron-down');
  }
}

/**
 * 拖拽排序管理器
 */
export class DragSortManager {
  constructor(container) {
    this.container = container;
    this.draggingElement = null;
    this.placeholder = null;
    
    this.onDragStart = this.onDragStart.bind(this);
    this.onDragOver = this.onDragOver.bind(this);
    this.onDragEnd = this.onDragEnd.bind(this);
    this.onDrop = this.onDrop.bind(this);
  }

  /**
   * 启用拖拽排序
   */
  enable() {
    this.container.addEventListener('dragstart', this.onDragStart);
    this.container.addEventListener('dragover', this.onDragOver);
    this.container.addEventListener('dragend', this.onDragEnd);
    this.container.addEventListener('drop', this.onDrop);
  }

  /**
   * 禁用拖拽排序
   */
  disable() {
    this.container.removeEventListener('dragstart', this.onDragStart);
    this.container.removeEventListener('dragover', this.onDragOver);
    this.container.removeEventListener('dragend', this.onDragEnd);
    this.container.removeEventListener('drop', this.onDrop);
  }

  /**
   * 拖拽开始
   * @param {DragEvent} ev
   */
  onDragStart(ev) {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    
    // 检查是否从拖拽手柄开始
    const dragHandle = target.closest('.ce-drag-handle');
    if (!dragHandle) return;
    
    // 找到对应的卡片
    const card = dragHandle.closest('.ce-collapsible-card');
    if (!card) return;

    this.draggingElement = card;
    card.classList.add('ce-dragging');
    
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', card.dataset.rowId || '');
    }
  }

  /**
   * 拖拽经过
   * @param {DragEvent} ev
   */
  onDragOver(ev) {
    if (!this.draggingElement) return;
    
    ev.preventDefault();
    if (ev.dataTransfer) {
      ev.dataTransfer.dropEffect = 'move';
    }

    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;

    const card = target.closest('.ce-collapsible-card');
    if (!card || card === this.draggingElement) return;

    // 清除之前的高亮
    this.clearDropTargets();
    
    // 高亮当前目标
    card.classList.add('ce-drag-over');

    // 计算插入位置
    const rect = card.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const insertBefore = ev.clientY < midpoint;

    // 获取容器中所有卡片的当前顺序
    const container = card.parentElement;
    if (!container) return;
    
    const allCards = Array.from(container.querySelectorAll('.ce-collapsible-card'));
    const dragIndex = allCards.indexOf(this.draggingElement);
    const targetIndex = allCards.indexOf(card);
    
    // 只有当需要移动时才执行插入操作
    if (dragIndex === -1 || targetIndex === -1) return;
    
    // 判断是否需要移动
    let shouldMove = false;
    if (insertBefore) {
      // 向上拖拽：只有当拖拽元素在目标元素下方时才移动
      shouldMove = dragIndex > targetIndex;
    } else {
      // 向下拖拽：只有当拖拽元素在目标元素上方时才移动
      shouldMove = dragIndex < targetIndex;
    }
    
    if (shouldMove) {
      if (insertBefore) {
        container.insertBefore(this.draggingElement, card);
      } else {
        container.insertBefore(this.draggingElement, card.nextSibling);
      }
    }
  }

  /**
   * 拖拽结束
   */
  onDragEnd() {
    if (this.draggingElement) {
      this.draggingElement.classList.remove('ce-dragging');
      this.draggingElement = null;
    }
    this.clearDropTargets();
  }

  /**
   * 放下
   * @param {DragEvent} ev
   */
  onDrop(ev) {
    ev.preventDefault();
    this.onDragEnd();
  }

  /**
   * 清除所有拖拽目标高亮
   */
  clearDropTargets() {
    const cards = this.container.querySelectorAll('.ce-collapsible-card');
    cards.forEach(card => {
      card.classList.remove('ce-drag-over');
    });
  }
}

/**
 * 批量展开所有卡片
 * @param {HTMLElement} container - 容器元素
 */
export function expandAll(container) {
  const cards = container.querySelectorAll('.ce-collapsible-card');
  cards.forEach(card => setCollapsed(card, false));
}

/**
 * 批量折叠所有卡片
 * @param {HTMLElement} container - 容器元素
 */
export function collapseAll(container) {
  const cards = container.querySelectorAll('.ce-collapsible-card');
  cards.forEach(card => setCollapsed(card, true));
}

/**
 * 收集所有卡片的折叠状态
 * @param {HTMLElement} container - 容器元素
 * @returns {Set<string>} - 折叠的卡片 rowId 集合
 */
export function collectCollapsedState(container) {
  const collapsedSet = new Set();
  const cards = container.querySelectorAll('.ce-collapsible-card');
  
  cards.forEach((card, index) => {
    if (isCollapsed(card)) {
      const rowId = card.dataset.rowId || String(index);
      collapsedSet.add(rowId);
    }
  });
  
  return collapsedSet;
}

/**
 * 恢复卡片的折叠状态
 * @param {HTMLElement} container - 容器元素
 * @param {Set<string>} collapsedSet - 折叠的卡片 rowId 集合
 */
export function restoreCollapsedState(container, collapsedSet) {
  if (!collapsedSet || collapsedSet.size === 0) return;
  
  const cards = container.querySelectorAll('.ce-collapsible-card');
  cards.forEach((card, index) => {
    const rowId = card.dataset.rowId || String(index);
    const shouldCollapse = collapsedSet.has(rowId);
    setCollapsed(card, shouldCollapse);
  });
}