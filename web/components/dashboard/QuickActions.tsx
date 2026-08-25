"use client";

import Link from "next/link";

interface QuickActionsProps {
  onCreateProject: () => void;
  onRecordIdea: () => void;
  recentProjectSlug?: string;
}

export function QuickActions({ onCreateProject, onRecordIdea, recentProjectSlug }: QuickActionsProps) {
  return (
    <section className="quick-actions" aria-label="快捷动作">
      <header className="quick-actions-head"><h2>快捷动作</h2></header>
      <div className="quick-actions-grid">
        <button type="button" className="quick-action primary" onClick={onCreateProject}>
          <span className="quick-action-icon">＋</span>
          <span className="quick-action-label">创建内容项目</span>
        </button>
        <button type="button" className="quick-action" onClick={onRecordIdea}>
          <span className="quick-action-icon">✶</span>
          <span className="quick-action-label">记录灵感</span>
        </button>
        {recentProjectSlug ? (
          <Link className="quick-action" href={`/projects/${encodeURIComponent(recentProjectSlug)}`}>
            <span className="quick-action-icon">↩</span>
            <span className="quick-action-label">打开最近项目</span>
          </Link>
        ) : (
          <Link className="quick-action disabled" href="/projects" aria-disabled="true">
            <span className="quick-action-icon">↩</span>
            <span className="quick-action-label">打开最近项目</span>
          </Link>
        )}
        <Link className="quick-action" href="/projects?view=execution">
          <span className="quick-action-icon">▶</span>
          <span className="quick-action-label">进入拍摄执行</span>
        </Link>
        <Link className="quick-action" href="/projects">
          <span className="quick-action-icon">▦</span>
          <span className="quick-action-label">查看历史项目</span>
        </Link>
        <button
          type="button"
          className="quick-action"
          onClick={() => window.dispatchEvent(new CustomEvent("piance-open-model-config"))}
        >
          <span className="quick-action-icon">⚙</span>
          <span className="quick-action-label">配置模型</span>
        </button>
      </div>
    </section>
  );
}
