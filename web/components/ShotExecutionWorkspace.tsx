"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowsClockwise, CaretDown, CaretLeft, CaretRight, CheckCircle, DotsThree, WarningDiamond } from "@phosphor-icons/react";
import type { ShotTask, ShotTaskStatus } from "../../src/types/shotTask";
import type { MediaAsset } from "../../src/types/mediaAsset";
import type { ShootingFeedback } from "../../src/types/shootingFeedback";
import { readJsonResponse } from "../lib/readJsonResponse";
import {
  ShotAssetRow,
  ShotMediaBar,
  type EnrichedLink,
} from "./ShotMediaAssets";
import { EditingWorkbench } from "./EditingWorkbench";
import { ShootingFeedbackPanel } from "./ShootingFeedbackPanel";
import { ShootingMode } from "./ShootingMode";

interface ShotExecutionWorkspaceProps {
  slug: string;
  resumeRequested?: boolean;
  onResumeHandled?: () => void;
  onBackToDocuments?: () => void;
}

interface BatchSuggestion {
  startOrder: number;
  endOrder: number;
  linkIds: string[];
  count: number;
}

const STATUS_LABELS: Record<ShotTaskStatus, string> = {
  todo: "待办",
  ready: "素材已齐",
  shot: "已拍摄",
  done: "已完成",
};

const STATUS_CLASSES: Record<ShotTaskStatus, string> = {
  todo: "status-muted",
  ready: "status-working",
  shot: "status-warning",
  done: "status-ready",
};

export function ShotExecutionWorkspace({ slug, resumeRequested = false, onResumeHandled, onBackToDocuments }: ShotExecutionWorkspaceProps) {
  const [shotTasks, setShotTasks] = useState<ShotTask[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  // 镜头视图 / 剪辑准备工作台 视图切换
  const [view, setView] = useState<"shots" | "shooting" | "feedback" | "editing">("shots");

  // 临时编辑状态
  const [editingNotes, setEditingNotes] = useState("");

  // 素材相关状态
  const [links, setLinks] = useState<EnrichedLink[]>([]);
  const [allAssets, setAllAssets] = useState<MediaAsset[]>([]);
  const [batchSuggestions, setBatchSuggestions] = useState<BatchSuggestion[]>([]);
  const [reshootShotIds, setReshootShotIds] = useState<Set<string>>(new Set());

  const loadShots = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/shots`);
      const data = await readJsonResponse<{ shotTasks?: ShotTask[]; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "镜头数据读取失败。");
      const tasks = data.shotTasks || [];
      setShotTasks(tasks);
      if (tasks.length > 0) {
        setSelectedId((prev) => (tasks.some((t) => t.id === prev) ? prev : tasks[0].id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "镜头数据读取失败。");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  const fetchLinks = useCallback(async () => {
    try {
      const [linksRes, assetsRes] = await Promise.all([
        fetch(`/api/media/projects/${encodeURIComponent(slug)}/links`),
        fetch("/api/media/assets"),
      ]);
      const linksData = await readJsonResponse<{ links?: EnrichedLink[]; batchSuggestions?: BatchSuggestion[]; error?: string }>(linksRes);
      const assetsData = await readJsonResponse<{ assets?: MediaAsset[]; error?: string }>(assetsRes);
      setLinks(linksData.links || []);
      setBatchSuggestions(linksData.batchSuggestions || []);
      setAllAssets(assetsData.assets || []);
    } catch {
      // 素材关系非阻塞
    }
  }, [slug]);

  const fetchFeedbackState = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/feedback`, { cache: "no-store" });
      const data = await readJsonResponse<{ feedback?: ShootingFeedback[] }>(response);
      const latest = data.feedback?.[0];
      setReshootShotIds(new Set((latest?.shotRecords || [])
        .filter((record) => record.outcome === "reshoot")
        .map((record) => record.shotTaskId || `order:${record.order}`)));
    } catch {
      setReshootShotIds(new Set());
    }
  }, [slug]);

  useEffect(() => {
    loadShots();
    fetchLinks();
    fetchFeedbackState();
  }, [loadShots, fetchLinks, fetchFeedbackState]);

  useEffect(() => {
    if (!resumeRequested || !shotTasks.length) return;
    let active = true;
    fetch(`/api/projects/${encodeURIComponent(slug)}/shooting-session`, { cache: "no-store" })
      .then((response) => readJsonResponse<{ session?: { shotTaskId?: string } | null; error?: string }>(response))
      .then((data) => {
        if (!active) return;
        const restoredId = data.session?.shotTaskId;
        const restored = restoredId ? shotTasks.find((task) => task.id === restoredId) : undefined;
        setSelectedId(restored?.id || shotTasks[0].id);
        setView("shooting");
        setNotice(restored ? `已恢复至镜头 ${String(restored.order).padStart(2, "0")} 的现场。` : "未找到上次现场，已从第一个镜头开始。");
        onResumeHandled?.();
      })
      .catch(() => { if (active) { setView("shooting"); onResumeHandled?.(); } });
    return () => { active = false; };
  }, [onResumeHandled, resumeRequested, shotTasks, slug]);

  useEffect(() => {
    if (view !== "shooting" || !selectedId) return;
    const timer = window.setTimeout(() => {
      fetch(`/api/projects/${encodeURIComponent(slug)}/shooting-session`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shotTaskId: selectedId }),
      }).catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [selectedId, slug, view]);

  const selectedTask = shotTasks.find((t) => t.id === selectedId) || shotTasks[0];

  useEffect(() => {
    if (selectedTask) {
      setEditingNotes(selectedTask.notes || "");
    }
  }, [selectedTask?.id, selectedTask?.notes]);

  // 重新构建镜头任务
  async function handleRebuild() {
    try {
      setRebuilding(true);
      setError("");
      setNotice("");
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/shots`, { method: "POST" });
      const data = await readJsonResponse<{ shotTasks?: ShotTask[]; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "重新构建镜头任务失败。");
      const tasks = data.shotTasks || [];
      setShotTasks(tasks);
      if (tasks.length > 0) {
        setSelectedId(tasks[0].id);
      }
      setNotice(`镜头任务重新构建完成，共包含 ${tasks.length} 个镜头。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重新构建镜头任务失败。");
    } finally {
      setRebuilding(false);
    }
  }

  // 保存补丁
  async function patchTask(taskId: string, patch: Partial<ShotTask>) {
    try {
      setSaving(true);
      setError("");
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/shots`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, ...patch }),
      });
      const data = await readJsonResponse<{ shotTasks?: ShotTask[]; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "持久化修改失败。");
      if (data.shotTasks) {
        setShotTasks(data.shotTasks);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "持久化修改失败。");
    } finally {
      setSaving(false);
    }
  }

  // 切换素材在 existing/missing 之间
  function toggleAssetStatus(assetName: string) {
    if (!selectedTask) return;
    const isExisting = selectedTask.existingAssets.includes(assetName);
    let nextExisting: string[];
    let nextMissing: string[];

    if (isExisting) {
      nextExisting = selectedTask.existingAssets.filter((a) => a !== assetName);
      nextMissing = Array.from(new Set([...selectedTask.missingAssets, assetName]));
    } else {
      nextExisting = Array.from(new Set([...selectedTask.existingAssets, assetName]));
      nextMissing = selectedTask.missingAssets.filter((a) => a !== assetName);
    }

    patchTask(selectedTask.id, {
      existingAssets: nextExisting,
      missingAssets: nextMissing,
    });
  }

  // 保存备注
  function saveNotes() {
    if (!selectedTask) return;
    patchTask(selectedTask.id, { notes: editingNotes });
  }

  // 快捷导航
  const selectedIndex = shotTasks.findIndex((t) => t.id === selectedId);
  const prevTask = selectedIndex > 0 ? shotTasks[selectedIndex - 1] : null;
  const nextTask = selectedIndex >= 0 && selectedIndex < shotTasks.length - 1 ? shotTasks[selectedIndex + 1] : null;

  // 统计数据
  const totalCount = shotTasks.length;
  const doneCount = shotTasks.filter((t) => t.status === "done").length;

  // 素材统计：已确认主素材的镜头数 / 缺失镜头数
  const confirmedShots = new Set(links.filter((l) => l.status === "confirmed").map((l) => l.shotTaskId));
  const withAssetCount = shotTasks.filter((t) => confirmedShots.has(t.id)).length;
  const missingAssetCount = totalCount - withAssetCount;
  const reshootCount = shotTasks.filter((task) => task.needsReshoot || reshootShotIds.has(task.id) || reshootShotIds.has(`order:${task.order}`)).length;

  async function completeAndAdvance() {
    if (!selectedTask) return;
    if (selectedTask.status !== "done") await patchTask(selectedTask.id, { status: "done" });
    if (nextTask) {
      setSelectedId(nextTask.id);
      setMobileDetailOpen(true);
    }
  }

  if (loading) {
    return (
      <div className="shot-workspace-loading">
        <div className="agent-loader">
          <span />
          <span />
          <span />
        </div>
        <p>正在载入镜头执行任务...</p>
      </div>
    );
  }

  return (
    <div className="shot-workspace shot-workspace-refined project-surface-enter">
      <header className="shot-topbar shot-refined-topbar">
        <div className="shot-topbar-heading">
          {onBackToDocuments && (
            <button type="button" className="shot-project-back" onClick={onBackToDocuments}>
              <ArrowLeft size={15} weight="bold" />
              策划
            </button>
          )}
          <div className="shot-topbar-title">
            <h2>拍摄清单</h2>
            <span>{doneCount}/{totalCount} 完成{reshootCount > 0 ? ` · ${reshootCount} 补拍` : ""}</span>
          </div>
        </div>

        <div className="shot-topbar-actions">
          <div className="shot-view-tabs" role="tablist" aria-label="拍摄工作区">
            <button type="button" role="tab" aria-selected={view === "shots"} className={view === "shots" ? "active" : ""} onClick={() => setView("shots")}>清单</button>
            <button type="button" role="tab" aria-selected={view === "shooting"} className={view === "shooting" ? "active" : ""} onClick={() => setView("shooting")}>拍摄</button>
            <button type="button" role="tab" aria-selected={view === "feedback"} className={view === "feedback" ? "active" : ""} onClick={() => setView("feedback")}>复盘</button>
            <button type="button" role="tab" aria-selected={view === "editing"} className={view === "editing" ? "active" : ""} onClick={() => setView("editing")}>剪辑</button>
          </div>
          <details className="shot-topbar-menu">
            <summary aria-label="更多操作" title="更多操作"><DotsThree size={19} weight="bold" /></summary>
            <button type="button" disabled={rebuilding} onClick={handleRebuild}>
              {rebuilding ? <span className="spinner dark" /> : <><ArrowsClockwise size={16} weight="bold" />重新构建镜头</>}
            </button>
          </details>
        </div>
      </header>

      {view === "shooting" ? (
        <ShootingMode tasks={shotTasks} selectedId={selectedId} saving={saving} onSelect={setSelectedId} onPatch={patchTask} />
      ) : view === "editing" ? (
        <EditingWorkbench slug={slug} onBack={() => setView("shots")} />
      ) : view === "feedback" ? (
        <ShootingFeedbackPanel slug={slug} shotTasks={shotTasks} onChanged={() => { void fetchFeedbackState(); void loadShots(); }} />
      ) : (
        <div className="shot-execution-panel shot-plan">
          {error && <div className="product-alert alert-warning"><span>!</span><p>{error}</p></div>}
          {notice && <div className="product-alert alert-success"><span>✓</span><p>{notice}</p></div>}

          {totalCount === 0 ? (
            <div className="shot-empty-card">
              <h3>还没有拍摄清单</h3>
              <p>从拍摄执行稿生成镜头后，这里只保留拍摄时真正需要的信息。</p>
              <button type="button" className="primary-button inline" disabled={rebuilding} onClick={handleRebuild}>
                {rebuilding ? <span className="spinner" /> : "生成拍摄清单"}
              </button>
            </div>
          ) : (
            <div className="shot-plan-layout">
              <aside className={`shot-plan-list ${mobileDetailOpen ? "mobile-hidden" : ""}`} aria-label="拍摄顺序">
                <header>
                  <strong>拍摄顺序</strong>
                  <span>{totalCount} 个镜头</span>
                </header>
                <div className="shot-plan-items">
                  {shotTasks.map((task) => {
                    const isActive = task.id === selectedId;
                    const needsReshoot = task.needsReshoot || reshootShotIds.has(task.id) || reshootShotIds.has(`order:${task.order}`);
                    return (
                      <button
                        key={task.id}
                        type="button"
                        className={`shot-plan-item${isActive ? " is-active" : ""}${task.status === "done" ? " is-done" : ""}`}
                        onClick={() => { setSelectedId(task.id); setMobileDetailOpen(true); }}
                      >
                        <span className="shot-plan-index">{String(task.order).padStart(2, "0")}</span>
                        <span className="shot-plan-copy">
                          <strong>{task.narration || task.visualDescription || `镜头 ${task.order}`}</strong>
                          <small>{task.shotType || "标准镜头"}{task.durationSeconds ? ` · ${task.durationSeconds} 秒` : ""}</small>
                        </span>
                        <span className="shot-plan-state" aria-label={needsReshoot ? "需补拍" : STATUS_LABELS[task.status]}>
                          {needsReshoot ? <WarningDiamond size={15} weight="fill" /> : task.status === "done" ? <CheckCircle size={16} weight="fill" /> : <i />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <main className={`shot-focus ${!mobileDetailOpen ? "mobile-hidden" : ""}`}>
                {selectedTask ? (
                  <>
                    <button type="button" className="mobile-back-btn" onClick={() => setMobileDetailOpen(false)}>← 返回拍摄顺序</button>

                    <header className="shot-focus-header">
                      <div>
                        <span className="shot-focus-kicker">镜头 {String(selectedTask.order).padStart(2, "0")} / {String(totalCount).padStart(2, "0")}</span>
                        <h2>{selectedTask.shotType || "标准镜头"}{selectedTask.durationSeconds ? <small>约 {selectedTask.durationSeconds} 秒</small> : null}</h2>
                      </div>
                      <div className="shot-focus-nav" aria-label="切换镜头">
                        <button type="button" disabled={!prevTask} onClick={() => prevTask && setSelectedId(prevTask.id)} aria-label="上一个镜头"><CaretLeft size={19} weight="bold" /></button>
                        <button type="button" disabled={!nextTask} onClick={() => nextTask && setSelectedId(nextTask.id)} aria-label="下一个镜头"><CaretRight size={19} weight="bold" /></button>
                      </div>
                    </header>

                    <div className="shot-focus-body">
                      <section className="shot-focus-script">
                        <span>口播</span>
                        <p>{selectedTask.narration || "此镜头无需口播。"}</p>
                      </section>

                      <section className="shot-focus-visual">
                        <span>画面</span>
                        <p>{selectedTask.visualDescription || "按现场情况完成画面。"}</p>
                      </section>

                      {selectedTask.notes && <p className="shot-focus-note">备注：{selectedTask.notes}</p>}
                    </div>

                    <div className="shot-focus-actions">
                      <span className={`shot-focus-status ${STATUS_CLASSES[selectedTask.status]}`}><i />{STATUS_LABELS[selectedTask.status]}</span>
                      <button type="button" className="shot-complete-button" disabled={saving || (selectedTask.status === "done" && !nextTask)} onClick={() => void completeAndAdvance()}>
                        {saving ? "保存中…" : selectedTask.status === "done" ? (nextTask ? "下一个镜头" : "全部完成") : (nextTask ? "完成并继续" : "完成拍摄清单")}
                        {!(selectedTask.status === "done" && !nextTask) && <ArrowRight size={17} weight="bold" />}
                      </button>
                    </div>

                    <details className="shot-support-disclosure">
                      <summary>
                        <span>素材与备注</span>
                        <small>{confirmedShots.has(selectedTask.id) ? "已匹配素材" : selectedTask.requiredAssets.length ? `${selectedTask.existingAssets.length}/${selectedTask.requiredAssets.length} 就绪` : "无需额外素材"}</small>
                        <CaretDown size={15} weight="bold" />
                      </summary>
                      <div className="shot-support-content">
                        <section className="shot-support-section">
                          <div className="shot-support-heading">
                            <strong>所需素材</strong>
                            <span>{selectedTask.requiredAssets.length ? "点击切换是否就绪" : "此镜头没有额外素材要求"}</span>
                          </div>
                          {selectedTask.requiredAssets.length > 0 && (
                            <div className="shot-support-assets">
                              {selectedTask.requiredAssets.map((asset) => {
                                const ready = selectedTask.existingAssets.includes(asset);
                                return <button key={asset} type="button" className={ready ? "is-ready" : ""} onClick={() => toggleAssetStatus(asset)}>{ready ? "✓ " : "○ "}{asset}</button>;
                              })}
                            </div>
                          )}
                          <ShotAssetRow slug={slug} shotTaskId={selectedTask.id} shotOrder={selectedTask.order} links={links} allAssets={allAssets} onRefresh={fetchLinks} />
                        </section>

                        <section className="shot-support-section">
                          <div className="shot-support-heading"><strong>备注</strong><span>失焦自动保存</span></div>
                          <textarea rows={3} placeholder="机位、道具或现场注意事项…" value={editingNotes} onChange={(event) => setEditingNotes(event.target.value)} onBlur={saveNotes} />
                        </section>

                        <details className="shot-advanced-disclosure">
                          <summary>高级信息 <CaretDown size={14} weight="bold" /></summary>
                          <div>
                            <label>
                              <span>镜头状态</span>
                              <select value={selectedTask.status} disabled={saving} onChange={(event) => void patchTask(selectedTask.id, { status: event.target.value as ShotTaskStatus })}>
                                <option value="todo">待办</option>
                                <option value="ready">素材已齐</option>
                                <option value="shot">已拍摄</option>
                                <option value="done">已完成</option>
                              </select>
                            </label>
                            {selectedTask.aiPrompt && <div className="shot-ai-prompt"><span>AI 画面提示词</span><p>{selectedTask.aiPrompt}</p><button type="button" onClick={() => navigator.clipboard.writeText(selectedTask.aiPrompt || "")}>复制</button></div>}
                            <ShotMediaBar slug={slug} batchSuggestions={batchSuggestions} onLinksRefresh={fetchLinks} />
                          </div>
                        </details>
                      </div>
                    </details>
                  </>
                ) : <div className="shot-none-selected">选择一个镜头开始</div>}
              </main>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
