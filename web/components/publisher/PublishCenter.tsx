"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Flask, FolderOpen, PaperPlaneTilt, VideoCamera } from "@phosphor-icons/react";
import { AccountsTab } from "./AccountsTab";
import { CreateJobModal } from "./CreateJobModal";
import { CreatePreparationModal } from "./CreatePreparationModal";
import { JobList } from "./JobList";
import { PreparationsTab } from "./PreparationsTab";
import { PublishSessionPanel } from "./PublishSessionPanel";
import { Modal } from "../Modal";
import { readJsonResponse } from "../../lib/readJsonResponse";
import {
  PUBLISHER_PLATFORM_LABELS,
  type PublisherAccount,
  type PublisherPlatform,
  type PublishJob,
  type PublishPreparation,
} from "../../../src/types/publisher";
import type {
  ProjectMatchCandidate,
  PublishSession,
  PublisherPreferences,
  WatchedDirectory,
} from "../../../src/types/publishSession";

interface FinalVideo {
  path: string;
  name: string;
  sizeBytes: number;
  mtime: string;
  normalizedName?: string;
}

interface DirectoryInfo {
  path: string;
  resolved: string;
  enabled: boolean;
  exists: boolean;
  error?: string;
  fileCount: number;
}

interface ToastState {
  id: number;
  message: string;
  tone?: "default" | "error";
}

interface MatchCacheEntry {
  candidates: ProjectMatchCandidate[];
  autoSelect: string | null;
  loading: boolean;
}

const POLL_INTERVAL_MS = 5000;
const LAB_POLL_INTERVAL_MS = 2000;
const TOAST_LIFE_MS = 2800;

const AUTO_TABS = [
  { id: "accounts", label: "平台账号" },
  { id: "pending", label: "待发布" },
  { id: "running", label: "发布中" },
  { id: "history", label: "发布记录" },
  { id: "preparations", label: "发布准备" },
] as const;
type AutoTab = (typeof AUTO_TABS)[number]["id"];

function jobStatusGroup(status: PublishJob["status"]): "pending" | "running" | "history" | null {
  if (status === "draft" || status === "validating" || status === "ready") return "pending";
  if (status === "running") return "running";
  if (status === "partial" || status === "completed" || status === "failed" || status === "cancelled") return "history";
  return null;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 MB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function formatMtime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 60_000) return "刚刚导出";
    if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`;
    if (d.toDateString() === now.toDateString()) {
      return `今天 ${d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
    }
    return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function basename(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

export function PublishCenter() {
  // 成片 + 会话
  const [finalVideos, setFinalVideos] = useState<FinalVideo[]>([]);
  const [directories, setDirectories] = useState<DirectoryInfo[]>([]);
  const [sessions, setSessions] = useState<PublishSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [matchCache, setMatchCache] = useState<Map<string, MatchCacheEntry>>(new Map());
  const [matchState, setMatchState] = useState<{
    videoPath: string;
    candidates: ProjectMatchCandidate[];
  } | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const toastIdRef = useRef(0);

  // 预设
  const [preferences, setPreferences] = useState<PublisherPreferences | null>(null);
  const [prefOpen, setPrefOpen] = useState(false);

  // 实验功能
  const [labOpen, setLabOpen] = useState(false);
  const [labTab, setLabTab] = useState<AutoTab>("accounts");
  const [labJobs, setLabJobs] = useState<PublishJob[]>([]);
  const [labAccounts, setLabAccounts] = useState<PublisherAccount[]>([]);
  const [labPreparations, setLabPreparations] = useState<PublishPreparation[]>([]);
  const [labLoading, setLabLoading] = useState(false);
  const [createJobOpen, setCreateJobOpen] = useState(false);
  const [createPrepOpen, setCreatePrepOpen] = useState(false);
  const [presetSlug, setPresetSlug] = useState<string | undefined>(undefined);

  const pushToast = useCallback((message: string, tone: "default" | "error" = "default") => {
    const id = ++toastIdRef.current;
    setToasts((list) => [...list, { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), TOAST_LIFE_MS);
  }, []);

  const loadFinalVideos = useCallback(async () => {
    try {
      const res = await fetch("/api/publisher/final-videos", { cache: "no-store" });
      const data = await readJsonResponse<{
        data?: { videos?: FinalVideo[]; directories?: DirectoryInfo[] };
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error || "成片扫描失败。");
      setFinalVideos(data.data?.videos || []);
      setDirectories(data.data?.directories || []);
    } catch {
      // 静默
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/publisher/sessions", { cache: "no-store" });
      const data = await readJsonResponse<{ data?: { sessions?: PublishSession[] }; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "会话读取失败。");
      const list = data.data?.sessions || [];
      setSessions(list);
      setCurrentSessionId((prev) => {
        if (prev && list.find((s) => s.id === prev)) return prev;
        // 首屏优先级：进行中 > 待开始 > 最近
        const running = list.find((s) => s.status === "running");
        if (running) return running.id;
        const paused = list.find((s) => s.status === "paused");
        if (paused) return paused.id;
        const ready = list.find((s) => s.status === "ready");
        if (ready) return ready.id;
        return list[0]?.id || null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "会话读取失败。");
    }
  }, []);

  const loadPreferences = useCallback(async () => {
    try {
      const res = await fetch("/api/publisher/preferences", { cache: "no-store" });
      const data = await readJsonResponse<{ data?: { preferences?: PublisherPreferences }; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "预设读取失败。");
      setPreferences(data.data?.preferences || null);
    } catch {
      // 静默
    }
  }, []);

  useEffect(() => {
    loadFinalVideos();
    loadSessions();
    loadPreferences();
  }, [loadFinalVideos, loadSessions, loadPreferences]);

  // 5s 轮询成片，页面隐藏时暂停
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }
      loadFinalVideos().finally(() => {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
      });
    };
    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [loadFinalVideos]);

  // 自动为新成片匹配项目（每个视频只匹配一次）
  useEffect(() => {
    for (const video of finalVideos.slice(0, 3)) {
      if (matchCache.has(video.path)) continue;
      // 标记为 loading
      setMatchCache((prev) => {
        const next = new Map(prev);
        next.set(video.path, { candidates: [], autoSelect: null, loading: true });
        return next;
      });
      fetch("/api/publisher/match-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoPath: video.path }),
      })
        .then((res) => readJsonResponse<{ data?: { candidates?: ProjectMatchCandidate[]; autoSelect?: string | null }; error?: string }>(res))
        .then((data) => {
          setMatchCache((prev) => {
            const next = new Map(prev);
            next.set(video.path, {
              candidates: data.data?.candidates || [],
              autoSelect: data.data?.autoSelect || null,
              loading: false,
            });
            return next;
          });
        })
        .catch(() => {
          setMatchCache((prev) => {
            const next = new Map(prev);
            next.set(video.path, { candidates: [], autoSelect: null, loading: false });
            return next;
          });
        });
    }
  }, [finalVideos, matchCache]);

  // 进入时若带 ?new=1&project=slug → 打开实验功能中的发布准备
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      setPresetSlug(params.get("project") || undefined);
      setLabOpen(true);
      setLabTab("preparations");
      setCreatePrepOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("new");
      url.searchParams.delete("project");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  // 实验功能数据加载
  const loadLabData = useCallback(async () => {
    setLabLoading(true);
    try {
      const [jobsRes, accountsRes, prepRes] = await Promise.all([
        fetch("/api/publisher/jobs", { cache: "no-store" }),
        fetch("/api/publisher/accounts", { cache: "no-store" }),
        fetch("/api/publisher/preparations", { cache: "no-store" }),
      ]);
      const [jobsData, accountsData, prepData] = await Promise.all([
        readJsonResponse<{ data?: { jobs?: PublishJob[] }; error?: string }>(jobsRes),
        readJsonResponse<{ data?: { accounts?: PublisherAccount[] }; error?: string }>(accountsRes),
        readJsonResponse<{ data?: { preparations?: PublishPreparation[] }; error?: string }>(prepRes),
      ]);
      setLabJobs(jobsData.data?.jobs || []);
      setLabAccounts(accountsData.data?.accounts || []);
      setLabPreparations(prepData.data?.preparations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "实验功能数据读取失败。");
    } finally {
      setLabLoading(false);
    }
  }, []);

  useEffect(() => {
    if (labOpen) loadLabData();
  }, [labOpen, loadLabData]);

  const hasActiveLab =
    labAccounts.some((a) => a.status === "checking") ||
    labJobs.some((j) => j.status === "validating" || j.status === "running");

  useEffect(() => {
    if (!labOpen || !hasActiveLab) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) {
        timer = setTimeout(tick, LAB_POLL_INTERVAL_MS);
        return;
      }
      loadLabData().finally(() => {
        timer = setTimeout(tick, LAB_POLL_INTERVAL_MS);
      });
    };
    timer = setTimeout(tick, LAB_POLL_INTERVAL_MS);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [labOpen, hasActiveLab, loadLabData]);

  const currentSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId) || null,
    [sessions, currentSessionId],
  );
  const ongoingSessions = useMemo(
    () => sessions.filter((s) => s.status === "running" || s.status === "paused" || s.status === "ready"),
    [sessions],
  );
  const historySessions = useMemo(
    () => sessions.filter((s) => s.status === "completed" || s.status === "archived"),
    [sessions],
  );

  async function startPublishForVideo(videoPath: string, projectSlug?: string) {
    setBusyPath(videoPath);
    setError("");
    try {
      // 如果未指定 projectSlug，尝试自动匹配
      let slug = projectSlug;
      if (!slug) {
        const cached = matchCache.get(videoPath);
        if (cached?.autoSelect) {
          slug = cached.autoSelect;
        }
      }
      await createSessionFor(videoPath, slug);
    } finally {
      setBusyPath(null);
    }
  }

  async function createSessionFor(videoPath: string, projectSlug?: string) {
    setCreatingSession(true);
    setError("");
    try {
      const res = await fetch("/api/publisher/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoPath, projectSlug: projectSlug || undefined }),
      });
      const data = await readJsonResponse<{
        data?: { session?: PublishSession; missingFields?: string[] };
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error || "会话创建失败。");
      const session = data.data?.session;
      if (session) {
        setCurrentSessionId(session.id);
        pushToast("发布会话已创建");
      }
      if (data.data?.missingFields && data.data.missingFields.length > 0) {
        pushToast(`缺少：${data.data.missingFields.join("、")}`, "error");
      }
      setMatchState(null);
      // 清除该视频的匹配缓存
      setMatchCache((prev) => {
        const next = new Map(prev);
        next.delete(videoPath);
        return next;
      });
      await loadSessions();
      await loadFinalVideos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "会话创建失败。");
      pushToast(err instanceof Error ? err.message : "会话创建失败", "error");
    } finally {
      setCreatingSession(false);
    }
  }

  async function ignoreVideo(videoPath: string) {
    try {
      await fetch("/api/publisher/final-videos/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoPath }),
      });
      setMatchCache((prev) => {
        const next = new Map(prev);
        next.delete(videoPath);
        return next;
      });
      await loadFinalVideos();
    } catch {
      // 静默
    }
  }

  async function savePreferences(next: Partial<PublisherPreferences>) {
    try {
      const res = await fetch("/api/publisher/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await readJsonResponse<{ data?: { preferences?: PublisherPreferences }; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "预设保存失败。");
      setPreferences(data.data?.preferences || null);
      pushToast("发布偏好已保存");
      // 保存后立即刷新成片（目录可能变化）
      await loadFinalVideos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "预设保存失败。");
      pushToast(err instanceof Error ? err.message : "预设保存失败", "error");
    }
  }

  function onSessionChanged() {
    loadSessions();
    loadFinalVideos();
  }

  function showMatchPanel(videoPath: string) {
    const cached = matchCache.get(videoPath);
    setMatchState({
      videoPath,
      candidates: cached?.candidates || [],
    });
  }

  // 实验功能
  const loggedInLabAccounts = labAccounts.filter((a) => a.status === "logged_in");
  function openCreateJob() {
    setPresetSlug(undefined);
    setCreateJobOpen(true);
  }
  function openCreatePrep() {
    setPresetSlug(undefined);
    setCreatePrepOpen(true);
  }
  const filteredLabJobs = useMemo(() => {
    if (labTab === "pending") return labJobs.filter((j) => jobStatusGroup(j.status) === "pending");
    if (labTab === "running") return labJobs.filter((j) => jobStatusGroup(j.status) === "running");
    if (labTab === "history") return labJobs.filter((j) => jobStatusGroup(j.status) === "history");
    return [];
  }, [labJobs, labTab]);

  const enabledCount = preferences
    ? preferences.platformOrder.filter((p) => preferences.enabledPlatforms.includes(p)).length
    : 0;
  const enabledDirCount = directories.filter((d) => d.enabled).length;
  const missingDirs = directories.filter((d) => d.enabled && !d.exists);

  return (
    <div className="publish-shell">
      <header className="publish-header">
        <div className="publish-title-block">
          <p className="eyebrow">发布中心</p>
          <h1>发布会话</h1>
          <p className="publish-subtitle">
            {enabledDirCount > 0
              ? `监听 ${enabledDirCount} 个目录 · 启用 ${enabledCount} 个平台`
              : "选择成片即可开始，自动复制文案、打开后台、定位视频"}
          </p>
        </div>
        <div className="publish-header-actions">
          <button
            type="button"
            className="secondary-button publish-pref-trigger"
            aria-haspopup="dialog"
            aria-expanded={prefOpen}
            onClick={() => setPrefOpen((v) => !v)}
          >
            <FolderOpen size={15} /> 平台与目录
          </button>
          <button
            type="button"
            className="secondary-button publish-lab-trigger"
            onClick={() => setLabOpen(true)}
          >
            <Flask size={15} /> 实验功能
          </button>
          {prefOpen && preferences && (
            <PreferencesPopover
              preferences={preferences}
              directories={directories}
              onClose={() => setPrefOpen(false)}
              onSave={savePreferences}
            />
          )}
        </div>
      </header>

      {error && <p className="publish-error">{error}</p>}

      {missingDirs.length > 0 && (
        <p className="publish-notice publish-dir-warning">
          以下监听目录不存在或无权限：{missingDirs.map((d) => d.path).join("、")}。请在「平台与目录」中修正。
        </p>
      )}

      {toasts.length > 0 && (
        <div className="publish-toast-stack" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`publish-toast ${t.tone === "error" ? "is-error" : ""}`}>
              {t.message}
            </div>
          ))}
        </div>
      )}

      {matchState && (
        <ProjectMatchPanel
          videoPath={matchState.videoPath}
          candidates={matchState.candidates}
          onPick={(slug) => createSessionFor(matchState.videoPath, slug)}
          onSkip={() => createSessionFor(matchState.videoPath, undefined)}
          creating={creatingSession}
        />
      )}

      {/* 首屏优先级：进行中的会话 > 新发现的成片 > 最近完成记录 */}
      {currentSession && (
        <PublishSessionPanel
          key={currentSession.id}
          session={currentSession}
          onChanged={onSessionChanged}
          onToast={pushToast}
        />
      )}

      {!matchState && finalVideos.length > 0 && (
        <section className="final-inbox" aria-label="成片收件箱">
          <h2 className="final-inbox-title">发现新成片</h2>
          <ul className="final-inbox-list">
            {finalVideos.map((v) => {
              const cached = matchCache.get(v.path);
              const matched = cached?.autoSelect
                ? cached.candidates.find((c) => c.projectSlug === cached.autoSelect)
                : null;
              return (
                <li key={v.path} className="final-inbox-row">
                  <div className="final-inbox-main" title={v.path}>
                    <strong>{v.name}</strong>
                    <span className="final-inbox-meta">
                      {formatBytes(v.sizeBytes)} · {formatMtime(v.mtime)}
                    </span>
                    {cached?.loading && <span className="final-inbox-match">匹配项目中…</span>}
                    {matched && (
                      <span className="final-inbox-match final-inbox-match-ok">
                        匹配项目：{matched.projectName}
                      </span>
                    )}
                    {!cached?.loading && !matched && cached && cached.candidates.length > 0 && (
                      <span className="final-inbox-match">{cached.candidates.length} 个候选项目</span>
                    )}
                  </div>
                  <div className="final-inbox-actions">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={busyPath === v.path || creatingSession || cached?.loading}
                      onClick={() => startPublishForVideo(v.path, cached?.autoSelect || undefined)}
                    >
                      {busyPath === v.path || creatingSession ? "创建中…" : cached?.loading ? "匹配项目中…" : "开始发布"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busyPath === v.path}
                      onClick={() => showMatchPanel(v.path)}
                    >
                      更换项目
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busyPath === v.path}
                      onClick={() => ignoreVideo(v.path)}
                    >
                      忽略
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!currentSession && !matchState && finalVideos.length === 0 && (
        <div className="publish-empty">
          <div className="publish-empty-icon"><PaperPlaneTilt size={27} weight="fill" /></div>
          <span className="empty-kicker">READY TO PUBLISH</span>
          <h2>成片到位后，从这里开始发布</h2>
          <p className="publish-muted">
            将成片视频放入监听目录后会自动出现。
            {directories.length > 0 && ` 当前监听：${directories.filter((d) => d.enabled).map((d) => d.path).join("、")}`}
          </p>
          <button type="button" className="primary-button" onClick={() => setPrefOpen(true)}>
            <VideoCamera size={16} weight="fill" /> 配置成片目录 <ArrowRight size={15} weight="bold" />
          </button>
        </div>
      )}

      {ongoingSessions.length > 1 && (
        <section className="session-list" aria-label="其他进行中的会话">
          <h3 className="session-list-title">其他进行中</h3>
          <ul className="session-list-items">
            {ongoingSessions
              .filter((s) => s.id !== currentSessionId)
              .map((s) => (
                <li key={s.id} className="session-list-row">
                  <button
                    type="button"
                    className="session-list-pick"
                    onClick={() => setCurrentSessionId(s.id)}
                  >
                    <strong>{basename(s.videoPath)}</strong>
                    <span className="publish-muted">
                      {s.projectName ? `${s.projectName} · ` : ""}
                      {s.targets.length} 个平台 · {s.targets.filter((t) => t.status === "published").length}/
                      {s.targets.length} 已发布
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      )}

      {historySessions.length > 0 && (
        <section className="session-list" aria-label="历史会话">
          <h3 className="session-list-title">历史会话</h3>
          <ul className="session-list-items">
            {historySessions.map((s) => (
              <li key={s.id} className="session-list-row">
                <button
                  type="button"
                  className="session-list-pick"
                  onClick={() => setCurrentSessionId(s.id)}
                >
                  <strong>{basename(s.videoPath)}</strong>
                  <span className="publish-muted">
                    {s.projectName ? `${s.projectName} · ` : ""}
                    {s.targets.filter((t) => t.status === "published").length}/{s.targets.length} 已发布
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 实验功能 */}
      <Modal
        open={labOpen}
        title="实验功能"
        description="自动发布 Beta 与发布准备（旧流程），不影响主流程"
        onClose={() => setLabOpen(false)}
        size="xl"
      >
        <div className="publish-beta-banner">
          <strong>自动发布 Beta</strong>
          <p>尚未完成端到端账号验证，建议优先使用主流程的「发布会话」。</p>
        </div>
        <nav className="publish-tabs" role="tablist" aria-label="实验功能分类">
          {AUTO_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={labTab === item.id}
              className={labTab === item.id ? "publish-tab active" : "publish-tab"}
              onClick={() => setLabTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {labTab === "accounts" && <AccountsTab accounts={labAccounts} onChange={loadLabData} />}

        {labTab === "preparations" && (
          <>
            <div className="lab-section-head">
              <p className="publish-muted">无需连接账号，按平台准备文案、导出发布包、打开官方后台。</p>
              <button type="button" className="primary-button" onClick={openCreatePrep}>
                ＋ 创建发布准备
              </button>
            </div>
            <PreparationsTab
              preparations={labPreparations}
              loading={labLoading}
              onChanged={loadLabData}
              onCreate={openCreatePrep}
            />
          </>
        )}

        {(labTab === "pending" || labTab === "running" || labTab === "history") && (
          <>
            <div className="lab-section-head">
              <p className="publish-muted">基于已连接账号的发布任务（需先在「平台账号」中连接账号）。</p>
              <button
                type="button"
                className="primary-button"
                disabled={loggedInLabAccounts.length === 0}
                onClick={openCreateJob}
                title={loggedInLabAccounts.length > 0 ? "创建发布任务" : "请先连接账号"}
              >
                ＋ 创建发布任务
              </button>
            </div>
            <JobList
              jobs={filteredLabJobs}
              loading={labLoading}
              accounts={labAccounts}
              tab={labTab}
              onChanged={loadLabData}
              onCreate={openCreateJob}
            />
          </>
        )}
      </Modal>

      <CreateJobModal
        open={createJobOpen}
        onClose={() => setCreateJobOpen(false)}
        presetProjectSlug={presetSlug}
        accounts={loggedInLabAccounts}
        onCreated={() => {
          setCreateJobOpen(false);
          setLabTab("pending");
          loadLabData();
        }}
      />
      <CreatePreparationModal
        open={createPrepOpen}
        onClose={() => setCreatePrepOpen(false)}
        presetProjectSlug={presetSlug}
        onCreated={() => {
          setCreatePrepOpen(false);
          loadLabData();
        }}
      />
    </div>
  );
}

function PreferencesPopover({
  preferences,
  directories,
  onClose,
  onSave,
}: {
  preferences: PublisherPreferences;
  directories: DirectoryInfo[];
  onClose: () => void;
  onSave: (next: Partial<PublisherPreferences>) => void;
}) {
  const [enabled, setEnabled] = useState<Set<PublisherPlatform>>(new Set(preferences.enabledPlatforms));
  const [order, setOrder] = useState<PublisherPlatform[]>(preferences.platformOrder);
  const [dirs, setDirs] = useState<WatchedDirectory[]>(preferences.watchedVideoDirectories);
  const [newDirPath, setNewDirPath] = useState("");
  const [picking, setPicking] = useState(false);

  function toggle(p: PublisherPlatform) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function move(p: PublisherPlatform, delta: -1 | 1) {
    setOrder((prev) => {
      const idx = prev.indexOf(p);
      if (idx === -1) return prev;
      const nextIdx = idx + delta;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[nextIdx]] = [next[nextIdx], next[idx]];
      return next;
    });
  }

  function toggleDir(idx: number) {
    setDirs((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], enabled: !next[idx].enabled };
      return next;
    });
  }

  function removeDir(idx: number) {
    setDirs((prev) => prev.filter((_, i) => i !== idx));
  }

  function addDir() {
    const p = newDirPath.trim();
    if (!p) return;
    if (dirs.some((d) => d.path === p)) return;
    setDirs((prev) => [...prev, { path: p, enabled: true }]);
    setNewDirPath("");
  }

  async function pickDir() {
    setPicking(true);
    try {
      const res = await fetch("/api/publisher/pick-directory", { method: "POST" });
      const data = await readJsonResponse<{ data?: { directory?: string; canceled?: boolean }; error?: string }>(res);
      if (data.data?.canceled) return;
      if (data.data?.directory) {
        const p = data.data.directory;
        if (!dirs.some((d) => d.path === p)) {
          setDirs((prev) => [...prev, { path: p, enabled: true }]);
        }
      }
    } catch {
      // 静默
    } finally {
      setPicking(false);
    }
  }

  function save() {
    const enabledInOrder = order.filter((p) => enabled.has(p));
    if (enabledInOrder.length === 0) return;
    onSave({ enabledPlatforms: enabledInOrder, platformOrder: order, watchedVideoDirectories: dirs });
    onClose();
  }

  const enabledCount = order.filter((p) => enabled.has(p)).length;

  return (
    <div className="pref-popover pref-popover-wide" role="dialog" aria-label="平台与目录预设">
      <div className="pref-popover-head">
        <strong>平台与目录</strong>
        <button type="button" className="publish-icon-btn" aria-label="关闭" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="pref-popover-section">
        <p className="pref-popover-section-title">监听目录</p>
        <ul className="pref-popover-list">
          {dirs.map((d, idx) => {
            const info = directories.find((di) => di.path === d.path);
            const exists = info?.exists ?? true;
            return (
              <li key={d.path} className={`pref-popover-row ${d.enabled ? "on" : ""}`}>
                <label className="pref-popover-toggle">
                  <input
                    type="checkbox"
                    checked={d.enabled}
                    onChange={() => toggleDir(idx)}
                  />
                  <span className="pref-popover-dir-path" title={d.path}>{d.path}</span>
                </label>
                <div className="pref-popover-dir-status">
                  {!exists && <span className="pref-popover-dir-missing">不存在</span>}
                  {info && exists && info.fileCount > 0 && (
                    <span className="publish-muted">{info.fileCount} 个视频</span>
                  )}
                  <button
                    type="button"
                    className="publish-icon-btn"
                    aria-label="删除目录"
                    onClick={() => removeDir(idx)}
                  >
                    ×
                  </button>
                </div>
              </li>
            );
          })}
          {dirs.length === 0 && <li className="pref-popover-empty">未配置监听目录</li>}
        </ul>
        <div className="pref-popover-add-dir">
          <input
            value={newDirPath}
            onChange={(e) => setNewDirPath(e.target.value)}
            placeholder="输入或粘贴目录路径"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDir(); } }}
          />
          <button type="button" className="secondary-button" disabled={picking} onClick={pickDir}>
            {picking ? "选择中…" : "选择"}
          </button>
          <button type="button" className="secondary-button" onClick={addDir} disabled={!newDirPath.trim()}>
            添加
          </button>
        </div>
      </div>

      <div className="pref-popover-section">
        <p className="pref-popover-section-title">启用平台（顺序即发布顺序）</p>
        <ul className="pref-popover-list">
          {order.map((p, idx) => {
            const on = enabled.has(p);
            return (
              <li key={p} className={`pref-popover-row ${on ? "on" : ""}`}>
                <label className="pref-popover-toggle">
                  <input type="checkbox" checked={on} onChange={() => toggle(p)} />
                  <span>{PUBLISHER_PLATFORM_LABELS[p]}</span>
                </label>
                <div className="pref-popover-move">
                  <button
                    type="button"
                    className="publish-icon-btn"
                    aria-label="上移"
                    disabled={idx === 0}
                    onClick={() => move(p, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="publish-icon-btn"
                    aria-label="下移"
                    disabled={idx === order.length - 1}
                    onClick={() => move(p, 1)}
                  >
                    ↓
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="pref-popover-foot">
        <span className="publish-muted">已启用 {enabledCount} 个平台 · {dirs.filter((d) => d.enabled).length} 个目录</span>
        <div className="pref-popover-foot-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={enabledCount === 0}
            onClick={save}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectMatchPanel({
  videoPath,
  candidates,
  onPick,
  onSkip,
  creating,
}: {
  videoPath: string;
  candidates: ProjectMatchCandidate[];
  onPick: (slug?: string) => void;
  onSkip: () => void;
  creating: boolean;
}) {
  return (
    <section className="match-panel" aria-label="项目匹配">
      <div className="match-panel-head">
        <h2>关联项目</h2>
        <p className="publish-muted">
          为「{basename(videoPath)}」选择关联项目，自动读取 06/10 文档生成发布文案
        </p>
      </div>
      {candidates.length === 0 ? (
        <p className="publish-muted">未找到匹配的项目，可直接选择无关联项目继续。</p>
      ) : (
        <ul className="match-candidate-list">
          {candidates.map((c) => (
            <li key={c.projectSlug} className="match-candidate-row">
              <button
                type="button"
                className="match-candidate-pick"
                disabled={creating}
                onClick={() => onPick(c.projectSlug)}
              >
                <div className="match-candidate-head">
                  <strong>{c.projectName}</strong>
                  <span className="publish-status status-muted">匹配度 {c.score.toFixed(0)}</span>
                </div>
                {c.reasons.length > 0 && (
                  <ul className="match-reasons">
                    {c.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="match-panel-foot">
        <button type="button" className="secondary-button" disabled={creating} onClick={() => onSkip()}>
          无关联项目
        </button>
      </div>
    </section>
  );
}
