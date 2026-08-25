"use client";

import { useEffect, useMemo, useState } from "react";
import { readJsonResponse } from "../../lib/readJsonResponse";
import {
  PLATFORM_PUBLISH_PROFILES,
  PUBLISHER_PLATFORM_LABELS,
} from "../../../src/types/publisher";
import {
  ASSISTED_PUBLISH_STATUS_LABELS,
  PUBLISH_SESSION_STATUS_LABELS,
  PUBLISH_SESSION_TARGET_STATUS_LABELS,
  type AssistedPublishStatus,
  type CoverCandidate,
  type PublishSession,
  type PublishSessionTarget,
  type ReadinessLevel,
} from "../../../src/types/publishSession";

interface PublishSessionPanelProps {
  session: PublishSession;
  onChanged: () => void;
  onToast: (message: string, tone?: "default" | "error") => void;
}

function basename(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

function clipPreview(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "（空）";
  const lines = trimmed.split(/\n/).filter((l) => l.trim());
  if (lines.length <= 1) return trimmed;
  return `${lines[0]}${lines.length > 1 ? ` 等 ${lines.length} 行` : ""}`;
}

const SOURCE_LABELS: Record<string, string> = {
  platform_doc: "平台专属",
  project_title_or_doc: "项目文档",
  generic_fallback: "通用兜底",
  ai_adapted: "AI 适配",
};

const READINESS_LABELS: Record<ReadinessLevel, string> = {
  ready: "已就绪",
  warning: "可继续",
  blocked: "无法发布",
};

/** 抖音半自动发布各步骤是否完成（依据当前 assisted 状态推断） */
function douyinStepStates(status: AssistedPublishStatus | undefined) {
  const order: AssistedPublishStatus[] = [
    "launching",
    "waiting_login",
    "uploading",
    "filling",
    "ready_for_confirmation",
  ];
  const idx = status ? order.indexOf(status) : -1;
  return {
    browser: idx >= 0,        // 浏览器已打开
    login: idx >= 2,          // 登录状态正常（过了 waiting_login）
    upload: idx >= 3,         // 视频上传完成（过了 uploading）
    fill: idx >= 4,           // 文案已填写（过了 filling）
    ready: idx >= 4,          // 到达 ready_for_confirmation
  };
}

export function PublishSessionPanel({ session, onChanged, onToast }: PublishSessionPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editingPlatform, setEditingPlatform] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  // 当切换当前平台时重置编辑草稿
  useEffect(() => {
    setEditingPlatform(null);
  }, [session.currentIndex, session.id]);

  const currentTarget = session.targets[session.currentIndex];
  const isCompleted = session.status === "completed";

  // 资产总览数据
  const selectedCover = useMemo(() => {
    return session.targets.find((t) => t.thumbnailPath)?.thumbnailPath || null;
  }, [session.targets]);
  const coverCandidates = session.coverCandidates || [];
  const readyCount = session.targets.filter((t) => t.title.trim() && t.description.trim()).length;
  const hasAdapted = session.targets.some((t) => t.adapted);
  const readiness = session.readiness;

  // 抖音半自动发布进行中时，加快轮询（2s）
  const assistedActive =
    currentTarget?.platform === "douyin" &&
    currentTarget.assistedStatus &&
    ["launching", "waiting_login", "uploading", "filling"].includes(currentTarget.assistedStatus);
  useEffect(() => {
    if (!assistedActive) return;
    const t = setInterval(() => onChanged(), 2000);
    return () => clearInterval(t);
  }, [assistedActive, onChanged]);

  async function callStart() {
    setError("");
    setBusy("start");
    try {
      const res = await fetch(`/api/publisher/sessions/${encodeURIComponent(session.id)}/start`, { method: "POST" });
      const data = await readJsonResponse<{ data?: { actions?: { clipboard?: { ok: boolean; error?: string }; backend?: { ok: boolean; url: string; error?: string }; finder?: { ok: boolean; error?: string } } }; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "开始发布失败。");
      const actions = data.data?.actions;
      if (actions?.clipboard?.ok) {
        onToast(`已复制${PUBLISHER_PLATFORM_LABELS[currentTarget.platform]}发布内容`);
      } else if (actions?.clipboard && !actions.clipboard.ok) {
        onToast(`剪贴板写入失败：${actions.clipboard.error || "未知错误"}`);
      }
      if (actions?.backend && !actions.backend.ok) {
        onToast(`后台打开失败：${actions.backend.error || "未知错误"}`);
      }
      if (actions?.finder && !actions.finder.ok) {
        onToast(`Finder 定位失败：${actions.finder.error || "未知错误"}`);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "开始发布失败。");
    } finally {
      setBusy(null);
    }
  }

  async function callAdvance() {
    setError("");
    setBusy("advance");
    try {
      const res = await fetch(`/api/publisher/sessions/${encodeURIComponent(session.id)}/advance`, { method: "POST" });
      const data = await readJsonResponse<{ data?: { completed?: boolean; actions?: { clipboard?: { ok: boolean; error?: string }; backend?: { ok: boolean; error?: string }; finder?: { ok: boolean; error?: string } } }; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "推进失败。");
      const payload = data.data;
      if (payload?.completed) {
        onToast("本次发布完成");
      } else if (payload?.actions) {
        const nextPlatform = session.targets[session.currentIndex + 1]?.platform;
        const acts = payload.actions;
        if (acts.clipboard?.ok) {
          onToast(`已复制下一平台${nextPlatform ? PUBLISHER_PLATFORM_LABELS[nextPlatform] : ""}发布内容`);
        } else if (acts.clipboard && !acts.clipboard.ok) {
          onToast(`剪贴板写入失败：${acts.clipboard.error || "未知错误"}`);
        }
        if (acts.backend && !acts.backend.ok) {
          onToast(`后台打开失败：${acts.backend.error || "未知错误"}`);
        }
        if (acts.finder && !acts.finder.ok) {
          onToast(`Finder 定位失败：${acts.finder.error || "未知错误"}`);
        }
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "推进失败。");
    } finally {
      setBusy(null);
    }
  }

  async function skipCurrent() {
    if (!currentTarget) return;
    setError("");
    setBusy("skip");
    try {
      const res = await fetch(`/api/publisher/sessions/${encodeURIComponent(session.id)}/targets/${encodeURIComponent(currentTarget.platform)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "skipped" }),
      });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "跳过失败。");
      await fetch(`/api/publisher/sessions/${encodeURIComponent(session.id)}/advance`, { method: "POST" }).catch(() => {});
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "跳过失败。");
    } finally {
      setBusy(null);
    }
  }

  async function pauseSession() {
    setError("");
    setBusy("pause");
    try {
      const res = await fetch(`/api/publisher/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "暂停失败。");
      onToast("已暂停发布会话");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "暂停失败。");
    } finally {
      setBusy(null);
    }
  }

  async function runAction(action: "clipboard" | "clipboard-title" | "clipboard-body" | "clipboard-tags" | "backend" | "finder" | "finder-cover" | "open-project") {
    if (!currentTarget) return;
    setError("");
    setBusy(action);
    try {
      const res = await fetch(`/api/publisher/sessions/${encodeURIComponent(session.id)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, platform: currentTarget.platform }),
      });
      const data = await readJsonResponse<{ data?: { result?: { ok: boolean; error?: string } }; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "操作失败。");
      const ok = data.data?.result?.ok;
      const actionLabel =
        action === "clipboard" ? "已复制全部文案"
        : action === "clipboard-title" ? "已复制标题"
        : action === "clipboard-body" ? "已复制正文"
        : action === "clipboard-tags" ? "已复制标签"
        : action === "backend" ? "已打开后台"
        : action === "finder" ? "已在 Finder 定位视频"
        : action === "finder-cover" ? "已在 Finder 定位封面"
        : "已打开项目目录";
      onToast(ok === false ? (data.data?.result?.error || "操作失败") : actionLabel);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败。");
    } finally {
      setBusy(null);
    }
  }

  // ── 封面操作 ────────────────────────────────────────────────────────
  async function pickCover() {
    setBusy("pick-cover");
    try {
      const res = await fetch("/api/publisher/pick-cover", { method: "POST" });
      const data = await readJsonResponse<{ data?: { coverPath?: string; canceled?: boolean }; error?: string }>(res);
      if (data.data?.canceled) return;
      if (!data.data?.coverPath) throw new Error(data.error || "封面选择失败。");
      await fetch(`/api/publisher/sessions/${encodeURIComponent(session.id)}/cover`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverPath: data.data.coverPath }),
      });
      onToast("封面已选择");
      onChanged();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "封面选择失败", "error");
    } finally {
      setBusy(null);
    }
  }

  async function selectCandidate(candidate: CoverCandidate) {
    setBusy("select-cover");
    try {
      await fetch(`/api/publisher/sessions/${encodeURIComponent(session.id)}/cover`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverPath: candidate.path }),
      });
      onToast("封面已切换");
      onChanged();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "封面切换失败", "error");
    } finally {
      setBusy(null);
    }
  }

  async function rescanCover() {
    setBusy("rescan-cover");
    try {
      const res = await fetch(`/api/publisher/sessions/${encodeURIComponent(session.id)}/cover`, { method: "POST" });
      const data = await readJsonResponse<{ data?: { candidates?: CoverCandidate[]; autoSelect?: CoverCandidate | null }; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "封面扫描失败。");
      if (data.data?.autoSelect) {
        onToast("已自动选中高置信度封面");
      } else {
        onToast(`扫描到 ${data.data?.candidates?.length || 0} 个候选`);
      }
      onChanged();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "封面扫描失败", "error");
    } finally {
      setBusy(null);
    }
  }

  // ── 智能适配 ────────────────────────────────────────────────────────
  async function adaptVariants() {
    setError("");
    setBusy("adapt");
    try {
      const res = await fetch(`/api/publisher/sessions/${encodeURIComponent(session.id)}/adapt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await readJsonResponse<{ success?: boolean; error?: string; data?: { adaptedPlatforms?: string[] } }>(res);
      if (!data.success) {
        onToast(data.error || "智能适配失败，已保留原版本", "error");
      } else {
        onToast(`已优化 ${data.data?.adaptedPlatforms?.length || 0} 个平台`);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "智能适配失败。");
    } finally {
      setBusy(null);
    }
  }

  async function revertAdapt() {
    setError("");
    setBusy("revert");
    try {
      const res = await fetch(`/api/publisher/sessions/${encodeURIComponent(session.id)}/adapt`, { method: "DELETE" });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "撤销失败。");
      onToast("已恢复原版本");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "撤销失败。");
    } finally {
      setBusy(null);
    }
  }

  // ── 抖音半自动发布操作 ────────────────────────────────────────────────
  async function startAssistedDouyin() {
    if (!currentTarget) return;
    setError("");
    setBusy("assisted-start");
    try {
      const res = await fetch(`/api/publisher/sessions/${encodeURIComponent(session.id)}/assisted-publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "douyin", profile: "primary" }),
      });
      const data = await readJsonResponse<{ data?: { processId?: string }; error?: string; code?: string }>(res);
      if (res.status === 409) {
        onToast("已有正在运行的抖音发布进程");
        onChanged();
        return;
      }
      if (!res.ok) throw new Error(data.error || "启动抖音发布失败。");
      onToast("已开始准备抖音发布");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动抖音发布失败。");
    } finally {
      setBusy(null);
    }
  }

  async function retryAssistedDouyin() {
    if (!currentTarget) return;
    setError("");
    setBusy("assisted-retry");
    try {
      const res = await fetch(`/api/publisher/sessions/${encodeURIComponent(session.id)}/assisted-publish`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "douyin", profile: "primary" }),
      });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "重试失败。");
      onToast("已重新开始准备抖音发布");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "重试失败。");
    } finally {
      setBusy(null);
    }
  }

  async function cancelAssistedDouyin() {
    if (!currentTarget) return;
    setError("");
    setBusy("assisted-cancel");
    try {
      const res = await fetch(`/api/publisher/sessions/${encodeURIComponent(session.id)}/assisted-publish/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "douyin" }),
      });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "取消失败。");
      onToast("已取消抖音发布准备");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "取消失败。");
    } finally {
      setBusy(null);
    }
  }

  async function confirmAssistedDouyin() {
    if (!currentTarget) return;
    setError("");
    setBusy("assisted-confirm");
    try {
      const res = await fetch(`/api/publisher/sessions/${encodeURIComponent(session.id)}/assisted-publish/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "douyin" }),
      });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "确认失败。");
      onToast("已标记抖音发布完成");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "确认失败。");
    } finally {
      setBusy(null);
    }
  }

  async function focusBrowser() {
    setBusy("focus");
    try {
      const res = await fetch("/api/publisher/browser-profile/douyin/focus", { method: "POST" });
      const data = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
      if (!data.ok) onToast(data.error || "未找到浏览器进程");
      else onToast("已切换到发布浏览器窗口");
    } catch {
      onToast("聚焦浏览器失败");
    } finally {
      setBusy(null);
    }
  }

  function startEdit(target: PublishSessionTarget) {
    setEditingPlatform(target.platform);
    setDraftTitle(target.title);
    setDraftDescription(target.description);
    setDraftTags(target.tags.join(", "));
  }

  async function saveEdit(target: PublishSessionTarget) {
    setError("");
    setBusy("save-edit");
    try {
      const res = await fetch(`/api/publisher/sessions/${encodeURIComponent(session.id)}/targets/${encodeURIComponent(target.platform)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draftTitle,
          description: draftDescription,
          tags: draftTags.split(/[,，\n、\s]+/).map((t) => t.replace(/^#+/, "").trim()).filter(Boolean),
        }),
      });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "保存失败。");
      setEditingPlatform(null);
      onToast("文案已保存");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败。");
    } finally {
      setBusy(null);
    }
  }

  if (isCompleted) {
    return (
      <div className="session-panel completed">
        <div className="session-panel-head">
          <h3>本次发布完成</h3>
          <span className="publish-status status-ready">{PUBLISH_SESSION_STATUS_LABELS[session.status]}</span>
        </div>
        <ul className="session-result-list">
          {session.targets.map((t) => (
            <li key={t.platform}>
              <strong>{PUBLISHER_PLATFORM_LABELS[t.platform]}</strong>
              <span className={`publish-status status-${t.status === "published" ? "ready" : t.status === "skipped" ? "muted" : "warning"}`}>
                {PUBLISH_SESSION_TARGET_STATUS_LABELS[t.status]}
              </span>
            </li>
          ))}
        </ul>
        <p className="publish-step-hint">这只是用户手动确认的结果，不代表平台 API 已验证成功。</p>
      </div>
    );
  }

  if (!currentTarget) {
    return (
      <div className="session-panel">
        <p className="publish-muted">当前无可用平台目标。</p>
      </div>
    );
  }

  const profile = PLATFORM_PUBLISH_PROFILES[currentTarget.platform];
  const clipboardPreview = clipPreview([currentTarget.title, currentTarget.description, currentTarget.tags.map((t) => `#${t}`).join(" ")].filter(Boolean).join("\n"));
  const isDouyin = currentTarget.platform === "douyin";
  const assisted = currentTarget.assistedStatus;
  const steps = douyinStepStates(assisted);
  const assistedRunning = assisted && ["launching", "waiting_login", "uploading", "filling"].includes(assisted);
  const assistedReady = assisted === "ready_for_confirmation";
  const assistedFailed = assisted === "failed";
  const assistedCancelled = assisted === "cancelled";
  // 改用手动发布后（target.status=opened）走手动流程
  const useManualFlow = !isDouyin || currentTarget.status === "opened" || (!assisted && currentTarget.status !== "pending");
  const notStarted = session.status === "ready" && session.targets.every((t) => t.status === "pending");

  return (
    <div className="session-panel">
      {error && <p className="publish-error">{error}</p>}

      <div className="session-panel-head">
        <h3>正在发布到：{PUBLISHER_PLATFORM_LABELS[currentTarget.platform]}</h3>
        <span className="session-step">{session.currentIndex + 1} / {session.targets.length}</span>
      </div>

      {/* ── 资产总览（默认收起，一行摘要 + 真实文件操作） ── */}
      <div className="session-asset-overview">
        <div className="session-asset-row"><span className="session-asset-label">视频</span><strong title={session.videoPath}>{basename(session.videoPath)}</strong></div>
        <div className="session-asset-row">
          <span className="session-asset-label">封面</span>
          <strong>{selectedCover ? basename(selectedCover) : "未找到封面"}</strong>
          {selectedCover && (
            <button type="button" className="publish-link-btn" disabled={busy === "finder-cover"} onClick={() => runAction("finder-cover")}>
              {busy === "finder-cover" ? "定位中…" : "Finder 定位"}
            </button>
          )}
        </div>
        <div className="session-asset-row"><span className="session-asset-label">平台</span><strong>{session.targets.map((t) => PUBLISHER_PLATFORM_LABELS[t.platform]).join(" · ")}</strong></div>
        <div className="session-asset-row"><span className="session-asset-label">文案</span><strong>{readyCount} / {session.targets.length} 已准备</strong></div>
        {readiness && (
          <div className="session-asset-row">
            <span className="session-asset-label">就绪</span>
            <span className={`publish-status status-${readiness.level === "ready" ? "ready" : readiness.level === "blocked" ? "warning" : "warning"}`}>
              {READINESS_LABELS[readiness.level]}
            </span>
            {readiness.warnings.length > 0 && (
              <span className="publish-muted">{readiness.warnings.length} 项提醒</span>
            )}
          </div>
        )}
        <div className="session-asset-actions">
          <button type="button" className="publish-link-btn" disabled={busy === "finder"} onClick={() => runAction("finder")}>
            {busy === "finder" ? "定位中…" : "Finder 视频"}
          </button>
          {session.projectSlug && (
            <button type="button" className="publish-link-btn" disabled={busy === "open-project"} onClick={() => runAction("open-project")}>
              {busy === "open-project" ? "打开中…" : "项目目录"}
            </button>
          )}
          <button type="button" className="publish-link-btn" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? "收起详情" : "查看详情"}
          </button>
        </div>
      </div>

      {/* ── 资产详情：各平台文案 + 封面候选 + 智能适配 ── */}
      {showDetails && (
        <div className="session-asset-detail">
          {/* 封面区 */}
          <div className="session-detail-section">
            <div className="session-detail-head">
              <span className="session-block-label">封面</span>
              <div className="session-detail-actions">
                <button type="button" className="publish-link-btn" disabled={busy === "rescan-cover"} onClick={rescanCover}>
                  {busy === "rescan-cover" ? "扫描中…" : "重新扫描"}
                </button>
                <button type="button" className="publish-link-btn" disabled={busy === "pick-cover"} onClick={pickCover}>
                  {busy === "pick-cover" ? "选择中…" : "选择封面"}
                </button>
              </div>
            </div>
            {selectedCover ? (
              <p className="session-detail-cover" title={selectedCover}>当前：{basename(selectedCover)}</p>
            ) : (
              <p className="publish-muted">未找到封面（不影响发布，可手动选择）</p>
            )}
            {coverCandidates.length > 0 && (
              <ul className="cover-candidate-list">
                {coverCandidates.slice(0, 3).map((c) => (
                  <li key={c.path} className={`cover-candidate-row ${selectedCover === c.path ? "active" : ""}`}>
                    <button type="button" className="cover-candidate-pick" disabled={busy === "select-cover"} onClick={() => selectCandidate(c)} title={c.path}>
                      <strong>{basename(c.path)}</strong>
                      <span className="publish-muted">匹配 {c.score.toFixed(0)} · {c.reasons[0] || ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 智能适配 */}
          <div className="session-detail-section">
            <div className="session-detail-head">
              <span className="session-block-label">智能适配</span>
              <div className="session-detail-actions">
                {hasAdapted ? (
                  <button type="button" className="secondary-button" disabled={busy === "revert"} onClick={revertAdapt}>
                    {busy === "revert" ? "恢复中…" : "撤销适配"}
                  </button>
                ) : (
                  <button type="button" className="secondary-button" disabled={busy === "adapt"} onClick={adaptVariants}>
                    {busy === "adapt" ? "优化中…" : "优化各平台版本"}
                  </button>
                )}
              </div>
            </div>
            <p className="publish-muted">主动点击才会调用模型，一次优化全部平台。失败保留原版本。</p>
          </div>

          {/* 各平台文案 */}
          <div className="session-detail-section">
            <span className="session-block-label">各平台文案</span>
            <ul className="platform-variant-list">
              {session.targets.map((t) => (
                <li key={t.platform} className={`platform-variant-row ${t.platform === currentTarget.platform ? "active" : ""}`}>
                  <div className="platform-variant-head">
                    <strong>{PUBLISHER_PLATFORM_LABELS[t.platform]}</strong>
                    {t.adapted && <span className="publish-status status-ready">已适配</span>}
                    {t.source && (
                      <span className="publish-muted">{SOURCE_LABELS[t.source.title] || t.source.title}</span>
                    )}
                  </div>
                  <div className="platform-variant-body">
                    <div><span>标题</span><strong>{t.title || "（空）"}</strong></div>
                    <div><span>正文</span><strong>{clipPreview(t.description)}</strong></div>
                    <div><span>标签</span><strong>{t.tags.length > 0 ? t.tags.join("、") : "（无）"}</strong></div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="session-block">
        <div className="session-block-head">
          <span className="session-block-label">视频</span>
          <strong title={session.videoPath}>{basename(session.videoPath)}</strong>
        </div>
        <button type="button" className="publish-link-btn" disabled={busy === "finder"} onClick={() => runAction("finder")}>
          {busy === "finder" ? "定位中…" : "在 Finder 中显示"}
        </button>
      </div>

      <div className="session-block">
        <div className="session-block-head">
          <span className="session-block-label">已复制</span>
          <strong className="session-clip-preview" title={clipboardPreview}>{clipboardPreview}</strong>
        </div>
        <div className="session-block-actions">
          <button type="button" className="publish-link-btn" disabled={busy === "clipboard-title"} onClick={() => runAction("clipboard-title")}>复制标题</button>
          <button type="button" className="publish-link-btn" disabled={busy === "clipboard-body"} onClick={() => runAction("clipboard-body")}>复制正文</button>
          <button type="button" className="publish-link-btn" disabled={busy === "clipboard-tags"} onClick={() => runAction("clipboard-tags")}>复制标签</button>
          <button type="button" className="publish-link-btn" disabled={busy === "clipboard"} onClick={() => runAction("clipboard")}>重新复制全部</button>
        </div>
      </div>

      <div className="session-block">
        <div className="session-block-head">
          <span className="session-block-label">文案摘要</span>
          <button type="button" className="publish-link-btn" onClick={() => editingPlatform === currentTarget.platform ? setEditingPlatform(null) : startEdit(currentTarget)}>
            {editingPlatform === currentTarget.platform ? "收起" : "编辑"}
          </button>
        </div>
        <div className="session-copy-summary">
          <div><span>标题</span><strong>{currentTarget.title || "（空）"}</strong></div>
          <div><span>标签</span><strong>{currentTarget.tags.length > 0 ? currentTarget.tags.join("、") : "（无）"}</strong></div>
        </div>
        {editingPlatform === currentTarget.platform && (
          <div className="session-edit-form">
            <label className="prep-field"><span>标题</span>
              <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
            </label>
            <label className="prep-field"><span>描述/文案</span>
              <textarea rows={3} value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} />
            </label>
            <label className="prep-field"><span>标签（逗号分隔）</span>
              <input value={draftTags} onChange={(e) => setDraftTags(e.target.value)} />
            </label>
            <div className="session-edit-actions">
              <button type="button" className="primary-button" disabled={busy === "save-edit"} onClick={() => saveEdit(currentTarget)}>
                {busy === "save-edit" ? "保存中…" : "保存"}
              </button>
              <button type="button" className="secondary-button" onClick={() => setEditingPlatform(null)}>取消</button>
            </div>
          </div>
        )}
      </div>

      {/* 抖音半自动发布状态区 */}
      {isDouyin && (assistedRunning || assistedReady || assistedFailed || assistedCancelled) && (
        <div className="assisted-publish-status" role="status" aria-live="polite">
          <div className="assisted-publish-head">
            <span className="assisted-publish-title">{ASSISTED_PUBLISH_STATUS_LABELS[assisted as AssistedPublishStatus]}</span>
            {assistedRunning && <span className="assisted-spinner" aria-hidden="true" />}
          </div>

          {assisted === "waiting_login" && (
            <div className="assisted-login-hint">
              <p>请在打开的抖音窗口中扫码登录。</p>
              <p className="assisted-subtext">系统将在登录完成后自动继续，无需手动点击。</p>
            </div>
          )}

          {assisted === "uploading" && (
            <div className="assisted-progress-row">
              <span>视频上传中</span>
              <strong>{typeof currentTarget.assistedProgress === "number" ? `${currentTarget.assistedProgress}%` : "进行中"}</strong>
            </div>
          )}

          {(assistedReady || assistedRunning) && (
            <ul className="assisted-checklist">
              <li className={steps.browser ? "done" : "pending"}>{steps.browser ? "✓" : "○"} 浏览器已打开</li>
              <li className={steps.login ? "done" : "pending"}>{steps.login ? "✓" : "○"} 登录状态正常</li>
              <li className={steps.upload ? "done" : "pending"}>{steps.upload ? "✓" : "○"} 视频上传完成</li>
              <li className={steps.fill ? "done" : "pending"}>{steps.fill ? "✓" : "○"} 标题、正文与标签已填写</li>
              {currentTarget.thumbnailPath && (
                <li className={steps.fill ? "done" : "pending"}>{steps.fill ? "✓" : "○"} 封面已上传</li>
              )}
              {assistedReady && <li className="pending">○ 等待你检查并发布</li>}
            </ul>
          )}

          {assistedFailed && currentTarget.assistedError && (
            <p className="assisted-error">{currentTarget.assistedError}</p>
          )}
          {assistedCancelled && (
            <p className="assisted-subtext">已取消，可重新开始或改用手动发布。</p>
          )}

          <div className="assisted-actions">
            {assistedRunning && (
              <>
                <button type="button" className="secondary-button" disabled={busy === "focus"} onClick={focusBrowser}>
                  {busy === "focus" ? "切换中…" : "查看浏览器"}
                </button>
                <button type="button" className="secondary-button" disabled={busy === "assisted-cancel"} onClick={cancelAssistedDouyin}>
                  {busy === "assisted-cancel" ? "取消中…" : "取消准备"}
                </button>
              </>
            )}
            {assistedReady && (
              <>
                <button type="button" className="primary-button" disabled={busy === "assisted-confirm"} onClick={confirmAssistedDouyin}>
                  {busy === "assisted-confirm" ? "处理中…" : "我已发布"}
                </button>
                <button type="button" className="secondary-button" disabled={busy === "focus"} onClick={focusBrowser}>
                  {busy === "focus" ? "切换中…" : "查看浏览器"}
                </button>
              </>
            )}
            {assistedFailed && (
              <button type="button" className="primary-button" disabled={busy === "assisted-retry"} onClick={retryAssistedDouyin}>
                {busy === "assisted-retry" ? "重试中…" : "重试失败步骤"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 抖音入口：未开始 / 已取消时显示半自动发布按钮 */}
      {isDouyin && !assistedRunning && !assistedReady && (
        <div className="session-block">
          <button
            type="button"
            className="primary-button session-open-backend"
            disabled={busy === "assisted-start" || busy === "assisted-retry"}
            onClick={assistedFailed || assistedCancelled ? retryAssistedDouyin : startAssistedDouyin}
          >
            {busy === "assisted-start" || busy === "assisted-retry" ? "启动中…" : "开始发布到抖音"}
          </button>
          {!profile.creatorBackendUrl && <span className="prep-backend-note">{profile.creatorBackendNote}</span>}
        </div>
      )}

      <div className="session-foot">
        {useManualFlow ? (
          session.status === "paused" ? (
            <button type="button" className="primary-button" disabled={busy === "start"} onClick={callStart}>
              {busy === "start" ? "继续中…" : "继续发布"}
            </button>
          ) : currentTarget.status === "opened" ? (
            <>
              <button type="button" className="primary-button" disabled={busy === "advance"} onClick={callAdvance}>
                {busy === "advance" ? "处理中…" : "标记已发布并进入下一个"}
              </button>
              <button type="button" className="secondary-button" disabled={busy === "skip"} onClick={skipCurrent}>跳过</button>
              <button type="button" className="secondary-button" disabled={busy === "pause"} onClick={pauseSession}>暂停</button>
            </>
          ) : (
            <>
              <button type="button" className="primary-button" disabled={busy === "start"} onClick={callStart}>
                {busy === "start" ? "启动中…" : notStarted ? "开始发布" : "开始发布"}
              </button>
              <button type="button" className="secondary-button" disabled={busy === "skip"} onClick={skipCurrent}>跳过</button>
            </>
          )
        ) : (
          // 抖音半自动进行中：提供手动兜底入口
          <button type="button" className="secondary-button" disabled={busy === "start"} onClick={callStart}>
            {busy === "start" ? "切换中…" : "改用手动发布"}
          </button>
        )}
      </div>
    </div>
  );
}
