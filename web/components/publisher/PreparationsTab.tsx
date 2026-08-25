"use client";

import { useState } from "react";
import { PreparationEditor } from "./PreparationEditor";
import {
  PUBLISHER_PLATFORM_LABELS,
  PUBLISH_PREPARATION_STATUS_LABELS,
  type PublishPreparation,
} from "../../../src/types/publisher";

interface PreparationsTabProps {
  preparations: PublishPreparation[];
  loading: boolean;
  onChanged: () => void;
  onCreate: () => void;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function basename(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

export function PreparationsTab({ preparations, loading, onChanged, onCreate }: PreparationsTabProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) return <p className="publish-muted">读取中…</p>;

  if (preparations.length === 0) {
    return (
      <div className="publish-empty">
        <p>还没有发布准备任务。</p>
        <p className="publish-muted">无需连接平台账号，选择一个成片视频即可开始为多个平台准备文案。</p>
        <button type="button" className="primary-button" onClick={onCreate}>创建发布准备</button>
      </div>
    );
  }

  return (
    <section className="publish-jobs" aria-label="发布准备列表">
      <ul className="publish-job-list">
        {preparations.map((prep) => {
          const expanded = expandedId === prep.id;
          const enabled = prep.targets.filter((t) => t.enabled);
          const publishedCount = enabled.filter((t) => t.manuallyPublished).length;
          return (
            <li key={prep.id} className="publisher-card publish-job-row">
              <div className="publish-job-summary">
                <button
                  type="button"
                  className="publish-job-video"
                  onClick={() => setExpandedId(expanded ? null : prep.id)}
                  title={prep.videoPath}
                >
                  <span className="publish-job-video-name">{basename(prep.videoPath)}</span>
                  {prep.projectSlug && <span className="publish-job-project">关联项目</span>}
                </button>
                <span className="publish-job-meta">
                  {enabled.length} 个平台{publishedCount > 0 ? ` · ${publishedCount} 已手动发布` : ""}
                </span>
                <span className="publish-job-platforms">
                  {enabled.slice(0, 4).map((t) => PUBLISHER_PLATFORM_LABELS[t.platform]).join(" / ")}
                  {enabled.length > 4 ? " …" : ""}
                </span>
                <span className={`publish-status status-${prep.status === "ready" || prep.status === "exported" || prep.status === "manually_published" ? "ready" : prep.status === "checking" ? "working" : "muted"}`}>
                  {PUBLISH_PREPARATION_STATUS_LABELS[prep.status]}
                </span>
                <span className="publish-job-time">{formatTime(prep.updatedAt)}</span>
                <div className="publish-job-actions">
                  <button type="button" className="secondary-button" onClick={() => setExpandedId(expanded ? null : prep.id)}>
                    {expanded ? "收起" : "编辑"}
                  </button>
                </div>
              </div>
              {expanded && <PreparationEditor preparation={prep} onChanged={onChanged} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
