"use client";

import { useState } from "react";
import { readJsonResponse } from "../../lib/readJsonResponse";
import {
  PUBLISHER_PLATFORM_LABELS,
  PUBLISH_JOB_STATUS_LABELS,
  PUBLISH_TARGET_STATUS_LABELS,
  type PublishJob,
  type PublishTargetStatus,
  type PublisherAccount,
} from "../../../src/types/publisher";

interface JobListProps {
  jobs: PublishJob[];
  loading: boolean;
  accounts: PublisherAccount[];
  tab: "pending" | "running" | "history";
  onChanged: () => void;
  onCreate: () => void;
}

const TARGET_TONE: Record<PublishTargetStatus, string> = {
  pending: "muted",
  validating: "working",
  ready: "ready",
  running: "working",
  success: "ready",
  failed: "warning",
  requires_login: "warning",
  cancelled: "muted",
};

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

export function JobList({ jobs, loading, accounts, tab, onChanged, onCreate }: JobListProps) {
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const accountNameById = new Map(accounts.map((a) => [a.id, a.displayName || a.accountName]));

  async function dryRun(job: PublishJob) {
    setError("");
    setBusyJobId(job.id);
    try {
      const res = await fetch(`/api/publisher/jobs/${encodeURIComponent(job.id)}/dry-run`, { method: "POST" });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Dry Run 失败。");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dry Run 失败。");
    } finally {
      setBusyJobId(null);
    }
  }

  async function remove(job: PublishJob) {
    setError("");
    if (!confirm("确定删除该发布任务？")) return;
    setBusyJobId(job.id);
    try {
      const res = await fetch(`/api/publisher/jobs/${encodeURIComponent(job.id)}`, { method: "DELETE" });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "删除失败。");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败。");
    } finally {
      setBusyJobId(null);
    }
  }

  async function retryTarget(job: PublishJob) {
    // 单账号重新检查：对整个任务再次 dry-run（失败账号会被重新检查，已 ready 的保持）
    setError("");
    setBusyJobId(job.id);
    try {
      const res = await fetch(`/api/publisher/jobs/${encodeURIComponent(job.id)}/dry-run`, { method: "POST" });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "重新检查失败。");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "重新检查失败。");
    } finally {
      setBusyJobId(null);
    }
  }

  if (loading) return <p className="publish-muted">读取中…</p>;

  if (jobs.length === 0) {
    const emptyText = tab === "pending"
      ? "还没有待发布的任务。"
      : tab === "running"
        ? "当前没有发布中的任务。"
        : "还没有发布记录。";
    return (
      <div className="publish-empty">
        <p>{emptyText}</p>
        {tab === "pending" && (
          <button type="button" className="primary-button" onClick={onCreate}>创建发布任务</button>
        )}
      </div>
    );
  }

  return (
    <section className="publish-jobs" aria-label="发布任务列表">
      {error && <p className="publish-error">{error}</p>}
      <ul className="publish-job-list">
        {jobs.map((job) => {
          const expanded = expandedId === job.id;
          const busy = busyJobId === job.id;
          const hasTargets = job.targets.length > 0;
          const readyCount = job.targets.filter((t) => t.status === "ready" || t.status === "success").length;
          return (
            <li key={job.id} className="publisher-card publish-job-row">
              <div className="publish-job-summary">
                <button
                  type="button"
                  className="publish-job-video"
                  onClick={() => setExpandedId(expanded ? null : job.id)}
                  title={job.videoPath}
                >
                  <span className="publish-job-video-name">{basename(job.videoPath)}</span>
                  {job.projectSlug && <span className="publish-job-project">关联项目</span>}
                </button>
                <span className="publish-job-meta">{hasTargets ? `${job.targets.length} 个账号` : "无账号"}</span>
                <span className={`publish-status status-${job.status === "ready" || job.status === "completed" ? "ready" : job.status === "failed" || job.status === "partial" ? "warning" : "working"}`}>
                  {PUBLISH_JOB_STATUS_LABELS[job.status]}
                  {hasTargets && job.status === "validating" ? ` ${readyCount}/${job.targets.length}` : ""}
                </span>
                <span className="publish-job-time">{formatTime(job.updatedAt)}</span>
                <div className="publish-job-actions">
                  {tab === "pending" && (
                    <button
                      type="button"
                      className="primary-button"
                      disabled={busy}
                      onClick={() => dryRun(job)}
                    >
                      {busy ? "检查中…" : "发布前检查"}
                    </button>
                  )}
                  {hasTargets && (
                    <button type="button" className="secondary-button" onClick={() => setExpandedId(expanded ? null : job.id)}>
                      {expanded ? "收起" : "详情"}
                    </button>
                  )}
                  <button type="button" className="publish-icon-btn" disabled={busy} aria-label="删除" onClick={() => remove(job)}>×</button>
                </div>
              </div>

              {expanded && hasTargets && (
                <ul className="publish-target-list">
                  {job.targets.map((t) => (
                    <li key={t.id} className="publish-target-row">
                      <div className="publish-target-main">
                        <strong>{accountNameById.get(t.accountId) || t.accountId}</strong>
                        <span className="publish-account-platform">{PUBLISHER_PLATFORM_LABELS[t.platform as keyof typeof PUBLISHER_PLATFORM_LABELS] || t.platform}</span>
                        <span className={`publish-status status-${TARGET_TONE[t.status]}`}>
                          {PUBLISH_TARGET_STATUS_LABELS[t.status]}
                        </span>
                        {t.error && <span className="publish-target-error" title={t.error}>{t.error}</span>}
                      </div>
                      {(t.status === "failed" || t.status === "requires_login") && tab === "pending" && (
                        <button type="button" className="secondary-button" disabled={busy} onClick={() => retryTarget(job)}>
                          重新检查
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
