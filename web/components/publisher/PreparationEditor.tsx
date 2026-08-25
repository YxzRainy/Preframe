"use client";

import { useMemo, useState } from "react";
import { readJsonResponse } from "../../lib/readJsonResponse";
import {
  PLATFORM_PUBLISH_PROFILES,
  PUBLISHER_PLATFORM_LABELS,
  PUBLISH_PREPARATION_STATUS_LABELS,
  type PreparationCheckResult,
  type PreparationCheckLevel,
  type PublishDraftTarget,
  type PublishPreparation,
  type PublisherPlatform,
} from "../../../src/types/publisher";

interface PreparationEditorProps {
  preparation: PublishPreparation;
  onChanged: () => void;
}

interface TargetDraft {
  title: string;
  description: string;
  tagsStr: string;
  thumbnailPath: string;
}

interface ResultDraft {
  result: "pending" | "published" | "failed";
  publishUrl: string;
  publishNote: string;
}

function toDraft(target: PublishDraftTarget): TargetDraft {
  return {
    title: target.title,
    description: target.description,
    tagsStr: target.tags.join(", "),
    thumbnailPath: target.thumbnailPath || "",
  };
}

function toResultDraft(target: PublishDraftTarget): ResultDraft {
  return {
    result: target.publishResult || (target.manuallyPublished ? "published" : "pending"),
    publishUrl: target.publishUrl || "",
    publishNote: target.publishNote || "",
  };
}

function splitTags(raw: string): string[] {
  return raw
    .split(/[,，\n、\s]+/u)
    .map((t) => t.replace(/^#+/u, "").trim())
    .filter(Boolean);
}

function buildCopyText(prep: PublishPreparation, target: PublishDraftTarget): string {
  const profile = PLATFORM_PUBLISH_PROFILES[target.platform];
  const lines: string[] = [
    `【${PUBLISHER_PLATFORM_LABELS[target.platform]}】`,
    `标题：${target.title}`,
    `描述：${target.description}`,
    `标签：${target.tags.length > 0 ? target.tags.join(", ") : "（无）"}`,
  ];
  if (target.thumbnailPath) lines.push(`封面：${target.thumbnailPath}`);
  lines.push(`视频：${prep.videoPath}`);
  if (profile.creatorBackendUrl) lines.push(`后台：${profile.creatorBackendUrl}`);
  return lines.join("\n");
}

const LEVEL_TONE: Record<PreparationCheckLevel, string> = {
  ready: "ready",
  warning: "warning",
  blocked: "warning",
};

const LEVEL_LABEL: Record<PreparationCheckLevel, string> = {
  ready: "可准备",
  warning: "有警告",
  blocked: "无法继续",
};

function formatTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

export function PreparationEditor({ preparation, onChanged }: PreparationEditorProps) {
  const [drafts, setDrafts] = useState<Record<string, TargetDraft>>(() => {
    const map: Record<string, TargetDraft> = {};
    for (const t of preparation.targets) map[t.id] = toDraft(t);
    return map;
  });
  const [resultDrafts, setResultDrafts] = useState<Record<string, ResultDraft>>(() => {
    const map: Record<string, ResultDraft> = {};
    for (const target of preparation.targets) map[target.id] = toResultDraft(target);
    return map;
  });
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [checkResult, setCheckResult] = useState<PreparationCheckResult | null>(null);
  const [exportCopyVideo, setExportCopyVideo] = useState(false);
  const [copiedTargetId, setCopiedTargetId] = useState<string | null>(null);

  const enabledTargets = useMemo(
    () => preparation.targets.filter((t) => t.enabled),
    [preparation.targets],
  );

  function patchDraft(targetId: string, patch: Partial<TargetDraft>) {
    setDrafts((prev) => ({ ...prev, [targetId]: { ...(prev[targetId] ?? { title: "", description: "", tagsStr: "", thumbnailPath: "" }), ...patch } }));
  }

  function patchResultDraft(targetId: string, patch: Partial<ResultDraft>) {
    setResultDrafts((prev) => ({
      ...prev,
      [targetId]: { ...(prev[targetId] ?? { result: "pending", publishUrl: "", publishNote: "" }), ...patch },
    }));
  }

  async function saveTarget(target: PublishDraftTarget) {
    setError("");
    const draft = drafts[target.id];
    if (!draft) return;
    setBusyAction(`save-${target.id}`);
    try {
      const res = await fetch(`/api/publisher/preparations/${encodeURIComponent(preparation.id)}/targets/${encodeURIComponent(target.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          description: draft.description,
          tags: splitTags(draft.tagsStr),
          thumbnailPath: draft.thumbnailPath || undefined,
        }),
      });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "保存失败。");
      setNotice(`已保存 ${PUBLISHER_PLATFORM_LABELS[target.platform]} 文案。`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败。");
    } finally {
      setBusyAction(null);
    }
  }

  function copyFromMaster(target: PublishDraftTarget) {
    setDrafts((prev) => ({
      ...prev,
      [target.id]: {
        title: preparation.masterContent.title,
        description: preparation.masterContent.description,
        tagsStr: preparation.masterContent.tags.join(", "),
        thumbnailPath: preparation.masterContent.thumbnailPath || "",
      },
    }));
    setNotice(`已从母版复制到 ${PUBLISHER_PLATFORM_LABELS[target.platform]}（点击「保存」生效）。`);
  }

  function resetToMaster(target: PublishDraftTarget) {
    copyFromMaster(target);
  }

  function toggleEnabled(target: PublishDraftTarget, enabled: boolean) {
    setBusyAction(`toggle-${target.id}`);
    fetch(`/api/publisher/preparations/${encodeURIComponent(preparation.id)}/targets/${encodeURIComponent(target.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    })
      .then((res) => readJsonResponse<{ error?: string }>(res))
      .then((data) => { if (data.error) throw new Error(data.error); onChanged(); })
      .catch((err) => setError(err instanceof Error ? err.message : "切换失败。"))
      .finally(() => setBusyAction(null));
  }

  async function copyPlatformText(target: PublishDraftTarget) {
    setError("");
    setBusyAction(`copy-${target.id}`);
    try {
      const text = buildCopyText(preparation, target);
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
      setCopiedTargetId(target.id);
      setNotice(`已复制 ${PUBLISHER_PLATFORM_LABELS[target.platform]} 全部文案到剪贴板。`);
      window.setTimeout(() => setCopiedTargetId(null), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "复制失败。");
    } finally {
      setBusyAction(null);
    }
  }

  async function runCheck() {
    setError("");
    setBusyAction("check");
    try {
      const res = await fetch(`/api/publisher/preparations/${encodeURIComponent(preparation.id)}/check`, { method: "POST" });
      const data = await readJsonResponse<{ data?: { check?: PreparationCheckResult }; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "检查失败。");
      setCheckResult(data.data?.check || null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "检查失败。");
    } finally {
      setBusyAction(null);
    }
  }

  async function exportPackage() {
    setError("");
    setBusyAction("export");
    try {
      const res = await fetch(`/api/publisher/preparations/${encodeURIComponent(preparation.id)}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ copyVideo: exportCopyVideo }),
      });
      const data = await readJsonResponse<{ data?: { export?: { exportDir: string; copiedVideo: boolean; files: string[] }; canceled?: boolean }; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "导出失败。");
      if (data.data?.canceled) { setNotice("已取消目录选择。"); return; }
      const exp = data.data?.export;
      if (exp) {
        setNotice(`已导出发布包到：${exp.exportDir}（${exp.files.length} 个文件，视频${exp.copiedVideo ? "已复制" : "仅保存路径引用"}）`);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败。");
    } finally {
      setBusyAction(null);
    }
  }

  async function openBackend(platform: PublisherPlatform) {
    setError("");
    setBusyAction(`open-${platform}`);
    try {
      const res = await fetch(`/api/publisher/preparations/${encodeURIComponent(preparation.id)}/open-backend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      const data = await readJsonResponse<{ data?: { result?: { opened: boolean; error?: string; url: string } }; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "打开后台失败。");
      const result = data.data?.result;
      if (result?.error) setNotice(`${PUBLISHER_PLATFORM_LABELS[platform]}：${result.error}`);
      else setNotice(`已使用系统默认浏览器打开 ${PUBLISHER_PLATFORM_LABELS[platform]} 创作者后台。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "打开后台失败。");
    } finally {
      setBusyAction(null);
    }
  }

  async function savePublishResult(target: PublishDraftTarget) {
    setError("");
    setBusyAction(`mark-${target.id}`);
    try {
      const draft = resultDrafts[target.id] || toResultDraft(target);
      const res = await fetch(`/api/publisher/preparations/${encodeURIComponent(preparation.id)}/targets/${encodeURIComponent(target.id)}/manual-publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          published: draft.result === "published",
          result: draft.result === "pending" ? undefined : draft.result,
          publishUrl: draft.publishUrl,
          publishNote: draft.publishNote,
        }),
      });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "标记失败。");
      setNotice(`已记录 ${PUBLISHER_PLATFORM_LABELS[target.platform]} 的发布结果。`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "标记失败。");
    } finally {
      setBusyAction(null);
    }
  }

  async function remove() {
    setError("");
    if (!confirm("确定删除该发布准备任务？")) return;
    setBusyAction("delete");
    try {
      const res = await fetch(`/api/publisher/preparations/${encodeURIComponent(preparation.id)}`, { method: "DELETE" });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "删除失败。");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败。");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="prep-editor">
      {error && <p className="publish-error">{error}</p>}
      {notice && <p className="publish-notice">{notice}</p>}

      <div className="prep-video-row">
        <div className="prep-video-info">
          <strong title={preparation.videoPath}>{preparation.videoPath.split(/[/\\]/).pop() || preparation.videoPath}</strong>
          <code>{preparation.videoPath}</code>
        </div>
        <span className={`publish-status status-${preparation.status === "ready" || preparation.status === "exported" || preparation.status === "manually_published" ? "ready" : preparation.status === "checking" ? "working" : "muted"}`}>
          {PUBLISH_PREPARATION_STATUS_LABELS[preparation.status]}
        </span>
        {preparation.exportDir && (
          <span className="prep-export-dir" title={preparation.exportDir}>导出：{preparation.exportDir}</span>
        )}
      </div>

      <div className="prep-master">
        <h3>母版内容</h3>
        <div className="prep-master-grid">
          <div><span>标题</span><strong>{preparation.masterContent.title || "（空）"}</strong></div>
          <div><span>描述</span><strong>{preparation.masterContent.description || "（空）"}</strong></div>
          <div><span>标签</span><strong>{preparation.masterContent.tags.length > 0 ? preparation.masterContent.tags.join(", ") : "（无）"}</strong></div>
          {preparation.masterContent.thumbnailPath && (
            <div><span>封面</span><code>{preparation.masterContent.thumbnailPath}</code></div>
          )}
        </div>
      </div>

      <div className="prep-actions">
        <button type="button" className="primary-button" disabled={busyAction === "check"} onClick={runCheck}>
          {busyAction === "check" ? "检查中…" : "发布前检查"}
        </button>
        <label className="prep-export-copy">
          <input type="checkbox" checked={exportCopyVideo} onChange={(e) => setExportCopyVideo(e.target.checked)} />
          <span>同时复制视频文件（默认关闭，只保存路径引用）</span>
        </label>
        <button type="button" className="secondary-button" disabled={busyAction === "export"} onClick={exportPackage}>
          {busyAction === "export" ? "导出中…" : "导出发布包"}
        </button>
        <button type="button" className="publish-icon-btn" disabled={busyAction === "delete"} aria-label="删除" onClick={remove}>×</button>
      </div>

      {checkResult && (
        <div className={`prep-check-result level-${LEVEL_TONE[checkResult.level]}`}>
          <div className="prep-check-head">
            <strong>检查结果：{LEVEL_LABEL[checkResult.level]}</strong>
            <span>视频：{checkResult.videoExists ? `存在${checkResult.videoSizeLabel ? `（${checkResult.videoSizeLabel}${checkResult.videoExt ? ` · ${checkResult.videoExt}` : ""}）` : ""}${checkResult.videoFormatValid ? "" : " · 格式不支持"}` : "不存在"}</span>
          </div>
          {checkResult.blankDuplicationWarning && <p className="publish-warn-line">{checkResult.blankDuplicationWarning}</p>}
          <ul className="prep-check-targets">
            {checkResult.targets.map((tc) => (
              <li key={tc.targetId} className={`level-${LEVEL_TONE[tc.level]}`}>
                <strong>{PUBLISHER_PLATFORM_LABELS[tc.platform]}</strong>
                <span className={`publish-status status-${LEVEL_TONE[tc.level]}`}>{LEVEL_LABEL[tc.level]}</span>
                <small>账号{tc.accountConfigured ? "已就绪" : "待确认"} · 封面{tc.coverPresent ? "已就绪" : "待确认"}</small>
                {tc.errors.length > 0 && <span className="prep-check-msg">{tc.errors.join("；")}</span>}
                {tc.warnings.length > 0 && <span className="prep-check-msg warn">{tc.warnings.join("；")}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="prep-targets-edit">
        <h3>各平台文案（独立编辑）</h3>
        {enabledTargets.map((target) => {
          const draft = drafts[target.id] ?? toDraft(target);
          const profile = PLATFORM_PUBLISH_PROFILES[target.platform];
          const busy = busyAction === `save-${target.id}` || busyAction === `toggle-${target.id}` || busyAction === `copy-${target.id}` || busyAction === `mark-${target.id}`;
          const copied = copiedTargetId === target.id;
          const resultDraft = resultDrafts[target.id] || toResultDraft(target);
          return (
            <div key={target.id} className={`prep-target-edit${target.manuallyPublished ? " is-published" : ""}`}>
              <div className="prep-target-head">
                <strong>{PUBLISHER_PLATFORM_LABELS[target.platform]}</strong>
                <span className="publish-account-platform">{profile.autoPublishStatus === "experimental" ? "实验性" : "未验证"}</span>
                {target.manuallyPublished && (
                  <span className="publish-status status-ready">已手动标记发布 · {formatTime(target.manuallyPublishedAt)}</span>
                )}
                {target.publishResult === "failed" && <span className="publish-status status-warning">发布失败</span>}
                <button type="button" className="publish-link-btn" disabled={busy} onClick={() => toggleEnabled(target, false)}>禁用</button>
              </div>

              <label className="prep-field"><span>标题{profile.titleRequired ? "（必填）" : ""}</span>
                <input value={draft.title} onChange={(e) => patchDraft(target.id, { title: e.target.value })} />
              </label>
              {profile.descriptionSupported && (
                <label className="prep-field"><span>描述/文案</span>
                  <textarea rows={2} value={draft.description} onChange={(e) => patchDraft(target.id, { description: e.target.value })} />
                </label>
              )}
              {profile.tagsSupported && (
                <label className="prep-field"><span>标签（逗号分隔）</span>
                  <input value={draft.tagsStr} onChange={(e) => patchDraft(target.id, { tagsStr: e.target.value })} />
                </label>
              )}
              {profile.thumbnailSupported && (
                <label className="prep-field"><span>封面路径</span>
                  <input value={draft.thumbnailPath} onChange={(e) => patchDraft(target.id, { thumbnailPath: e.target.value })} />
                </label>
              )}

              <div className="prep-target-actions">
                <button type="button" className="secondary-button" disabled={busy} onClick={() => copyFromMaster(target)}>从母版复制</button>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => resetToMaster(target)}>重置为母版</button>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => copyPlatformText(target)}>
                  {copied ? "已复制 ✓" : "复制本平台文案"}
                </button>
                <button type="button" className="primary-button" disabled={busy} onClick={() => saveTarget(target)}>
                  {busyAction === `save-${target.id}` ? "保存中…" : "保存"}
                </button>
              </div>

              <div className="prep-target-foot">
                <button type="button" className="publish-link-btn" disabled={busyAction === `open-${target.platform}`} onClick={() => openBackend(target.platform)}>
                  {busyAction === `open-${target.platform}` ? "打开中…" : "打开官方后台"}
                </button>
                {!profile.creatorBackendUrl && (
                  <span className="prep-backend-note">{profile.creatorBackendNote}</span>
                )}
              </div>
              <div className="prep-result-row" aria-label={`${PUBLISHER_PLATFORM_LABELS[target.platform]}发布结果`}>
                <select value={resultDraft.result} onChange={(e) => patchResultDraft(target.id, { result: e.target.value as ResultDraft["result"] })}>
                  <option value="pending">待发布</option>
                  <option value="published">已发布</option>
                  <option value="failed">发布失败</option>
                </select>
                <input type="url" value={resultDraft.publishUrl} onChange={(e) => patchResultDraft(target.id, { publishUrl: e.target.value })} placeholder="发布链接（可选）" />
                <input value={resultDraft.publishNote} onChange={(e) => patchResultDraft(target.id, { publishNote: e.target.value })} placeholder="结果备注（可选）" />
                <button type="button" className="secondary-button" disabled={busy} onClick={() => savePublishResult(target)}>
                  {busyAction === `mark-${target.id}` ? "记录中…" : "记录结果"}
                </button>
              </div>
            </div>
          );
        })}

        {preparation.targets.some((t) => !t.enabled) && (
          <div className="prep-disabled-list">
            <h4>已禁用平台</h4>
            <ul>
              {preparation.targets.filter((t) => !t.enabled).map((target) => (
                <li key={target.id}>
                  <strong>{PUBLISHER_PLATFORM_LABELS[target.platform]}</strong>
                  <button type="button" className="publish-link-btn" disabled={busyAction === `toggle-${target.id}`} onClick={() => toggleEnabled(target, true)}>重新启用</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
