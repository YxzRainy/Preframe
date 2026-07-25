/**
 * AutomationProgress — 单行流程状态标记，高度 ≤ 44px
 */
export function AutomationProgress({ loading, ready }: { loading: boolean; ready: boolean }) {
  // 组件保留，但主工作台已换为 doc-flow-line 内联展示。
  // 此组件仍用于其他可能引用它的地方。
  void loading; void ready;
  return null;
}
