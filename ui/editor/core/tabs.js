// Tab 切换逻辑

/**
 * 切换 Tab
 * @param {HTMLElement} root
 * @param {string} tab
 * @param {Function} collectConfigFn - 收集配置的函数
 * @param {Function} renderInitialParamsFn - 渲染初始参数面板的函数
 */
export function switchTab(root, tab, collectConfigFn, renderInitialParamsFn) {
  const tabButtons = root.querySelectorAll(".ce-tab-btn");
  tabButtons.forEach((btn) => {
    if (btn.dataset.tab === tab) {
      btn.classList.add("ce-tab-btn-active");
    } else {
      btn.classList.remove("ce-tab-btn-active");
    }
  });

  const panels = root.querySelectorAll(".ce-tab-panel");
  panels.forEach((panel) => {
    if (panel.dataset.tabPanel === tab) {
      panel.style.display = "";
    } else {
      panel.style.display = "none";
    }
  });

  // 每次切换到"初始参数"页时，基于当前 UI 状态重建一份临时配置并刷新该页内容，
  // 确保最新的参数列表与实体绑定立即生效。
  if (tab === "initialParams") {
    const cfg = collectConfigFn();
    renderInitialParamsFn(cfg);
  }
}

/**
 * 绑定 Tab 切换事件
 * @param {HTMLElement} root
 * @param {Function} collectConfigFn - 收集配置的函数
 * @param {Function} renderInitialParamsFn - 渲染初始参数面板的函数
 */
export function wireTabEvents(root, collectConfigFn, renderInitialParamsFn) {
  const tabButtons = root.querySelectorAll(".ce-tab-btn");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      switchTab(root, tab, collectConfigFn, renderInitialParamsFn);
    });
  });
}