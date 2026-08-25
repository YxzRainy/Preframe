"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowsClockwise, Camera, CheckCircle, FilmSlate, FlagCheckered, Scissors, WarningDiamond } from "@phosphor-icons/react";
import type { ShotTask, ShotTaskStatus } from "../../src/types/shotTask";
import type { MediaAsset } from "../../src/types/mediaAsset";
import type { ShootingFeedback } from "../../src/types/shootingFeedback";
import { readJsonResponse } from "../lib/readJsonResponse";
import {
  MissingShotsBar,
  ShotAssetRow,
  ShotMediaBar,
  type EnrichedLink,
} from "./ShotMediaAssets";
import { EditingWorkbench } from "./EditingWorkbench";
import { ShootingFeedbackPanel } from "./ShootingFeedbackPanel";

interface ShotExecutionWorkspaceProps {
  slug: string;
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

export function ShotExecutionWorkspace({ slug }: ShotExecutionWorkspaceProps) {
  const [shotTasks, setShotTasks] = useState<ShotTask[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  // 镜头视图 / 剪辑准备工作台 视图切换
  const [view, setView] = useState<"shots" | "editing">("shots");

  // 临时编辑状态
  const [editingNotes, setEditingNotes] = useState("");

  // 素材相关状态
  const [links, setLinks] = useState<EnrichedLink[]>([]);
  const [allAssets, setAllAssets] = useState<MediaAsset[]>([]);
  const [batchSuggestions, setBatchSuggestions] = useState<BatchSuggestion[]>([]);
  const [filterMissing, setFilterMissing] = useState(false);
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

  // 快捷操作：标记素材已齐
  function markAssetsReady() {
    if (!selectedTask) return;
    const allAssets = selectedTask.requiredAssets || [];
    const nextStatus = selectedTask.status === "todo" ? "ready" : selectedTask.status;
    patchTask(selectedTask.id, {
      existingAssets: [...allAssets],
      missingAssets: [],
      status: nextStatus,
    });
  }

  // 快捷操作：标记已拍摄
  function markShot() {
    if (!selectedTask) return;
    patchTask(selectedTask.id, { status: "shot" });
  }

  // 快捷操作：标记已完成
  function markDone() {
    if (!selectedTask) return;
    patchTask(selectedTask.id, { status: "done" });
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
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  // 素材统计：已确认主素材的镜头数 / 缺失镜头数
  const confirmedShots = new Set(links.filter((l) => l.status === "confirmed").map((l) => l.shotTaskId));
  const withAssetCount = shotTasks.filter((t) => confirmedShots.has(t.id)).length;
  const missingAssetCount = totalCount - withAssetCount;
  const reshootCount = shotTasks.filter((task) => reshootShotIds.has(task.id) || reshootShotIds.has(`order:${task.order}`)).length;
  const visibleShotTasks = filterMissing
    ? shotTasks.filter((t) => !confirmedShots.has(t.id))
    : shotTasks;

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
    <div className="shot-workspace">
      {/* 顶部指标与控制栏 */}
      <header className="shot-topbar">
        <div className="shot-topbar-title">
          <span>PRODUCTION BOARD</span>
          <h2><FilmSlate size={23} weight="fill" /> 镜头执行</h2>
          <p>从分镜到素材确认，按镜头推进拍摄进度。</p>
        </div>
        <div className="shot-metrics">
          <div className="metric-chip">
            <small>镜头总数</small>
            <strong>{totalCount}</strong>
          </div>
          <div className="metric-chip">
            <small>已完成</small>
            <strong>{doneCount} / {totalCount}</strong>
          </div>
          <div className="metric-chip">
            <small>准备进度</small>
            <strong>{progressPct}%</strong>
            <span className="metric-progress-bar">
              <i style={{ width: `${progressPct}%` }} />
            </span>
          </div>
          <div className="metric-chip sub">
            <small>素材就绪</small>
            <span>{withAssetCount} / {totalCount} 镜头{reshootCount ? ` · ${reshootCount} 需补拍` : ""}</span>
          </div>
        </div>

        <div className="shot-topbar-actions">
          <button
            type="button"
            className={view === "editing" ? "primary-button" : "secondary-button"}
            onClick={() => setView((v) => (v === "editing" ? "shots" : "editing"))}
            title="进入剪辑准备工作台：素材整理 / Proxy / 路径管理（不做剪辑）"
          >
            {view === "editing" ? <ArrowLeft size={16} weight="bold" /> : <Scissors size={16} weight="bold" />}
            <span>{view === "editing" ? "返回镜头" : "准备剪辑"}</span>
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={rebuilding}
            onClick={handleRebuild}
            title="从当前 Markdown 文档重新解析镜头任务（不修改 Markdown 文档）"
          >
            {rebuilding ? <span className="spinner dark" /> : <><ArrowsClockwise size={16} weight="bold" /><span>重新构建</span></>}
          </button>
        </div>
      </header>

      {view === "editing" ? (
        <EditingWorkbench slug={slug} onBack={() => setView("shots")} />
      ) : (
        <>
      {/* 素材控制栏：扫描 / 归项目 / 匹配镜头 / 批量确认 / 剪辑清单 */}
      <ShotMediaBar
        slug={slug}
        batchSuggestions={batchSuggestions}
        onLinksRefresh={fetchLinks}
      />

      {/* 缺镜头统计 */}
      {totalCount > 0 && (
        <MissingShotsBar
          total={totalCount}
          withAsset={withAssetCount}
          missingCount={missingAssetCount}
          filterMissing={filterMissing}
          onToggleFilter={() => setFilterMissing((v) => !v)}
        />
      )}

      {error && (
        <div className="product-alert alert-warning">
          <span>!</span>
          <p>{error}</p>
        </div>
      )}
      {notice && (
        <div className="product-alert alert-success">
          <span>✓</span>
          <p>{notice}</p>
        </div>
      )}

      {/* 空状态处理 */}
      {totalCount === 0 ? (
        <div className="shot-empty-card">
          <div className="empty-icon">🎬</div>
          <h3>未检测到镜头分镜数据</h3>
          <p>
            镜头执行任务依赖于 <code>04_分镜与剪辑节奏.md</code> 等策划文档的解析。
            <br />
            若您已通过文档区生成或修改了分镜文档，可直接点击下方按钮触发构建。
          </p>
          <button type="button" className="primary-button inline" disabled={rebuilding} onClick={handleRebuild}>
            {rebuilding ? <span className="spinner" /> : "重新构建镜头任务"}
          </button>
        </div>
      ) : (
        <div className="shot-dual-pane">
          {/* 左侧：紧凑镜头列表 */}
          <div className={`shot-list-panel ${mobileDetailOpen ? "mobile-hidden" : ""}`}>
            <div className="shot-list-header">
              <span>镜头顺序列表 ({visibleShotTasks.length}{filterMissing ? ` 缺失` : ""})</span>
            </div>

            <div className="shot-compact-list">
              {visibleShotTasks.length === 0 && filterMissing ? (
                <div className="shot-list-empty-hint">所有镜头都已有素材</div>
              ) : null}
              {visibleShotTasks.map((t) => {
                const isActive = t.id === selectedId;
                const hasAsset = confirmedShots.has(t.id);
                const hasCandidate = links.some((l) => l.shotTaskId === t.id && l.status === "suggested");
                const needsReshoot = reshootShotIds.has(t.id) || reshootShotIds.has(`order:${t.order}`);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`shot-compact-item ${isActive ? "active" : ""}`}
                    onClick={() => {
                      setSelectedId(t.id);
                      setMobileDetailOpen(true);
                    }}
                  >
                    <div className="shot-item-top">
                      <span className="shot-order">#{String(t.order).padStart(2, "0")}</span>
                      <span className="shot-type-chip">{t.shotType || "镜头"}</span>
                      {t.durationSeconds ? <span className="shot-duration">{t.durationSeconds}s</span> : null}
                      <span className={`status-badge ${STATUS_CLASSES[t.status]}`}>
                        <i />
                        {STATUS_LABELS[t.status]}
                      </span>
                      {needsReshoot && <span className="status-badge status-warning"><WarningDiamond size={11} weight="fill" /> 需补拍</span>}
                      {hasAsset && <span className="shot-asset-dot has" title="已有素材">●</span>}
                      {!hasAsset && hasCandidate && <span className="shot-asset-dot candidate" title="有候选素材">●</span>}
                      {!hasAsset && !hasCandidate && <span className="shot-asset-dot missing" title="缺素材">○</span>}
                    </div>

                    <div className="shot-item-narration">
                      {t.narration ? t.narration.slice(0, 36) + (t.narration.length > 36 ? "..." : "") : "（无口播内容）"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 右侧：当前镜头详情 */}
          <div className={`shot-detail-panel ${!mobileDetailOpen ? "mobile-hidden" : ""}`}>
            {selectedTask ? (
              <div className="shot-detail-content">
                {/* 移动端返回列表 */}
                <button type="button" className="mobile-back-btn" onClick={() => setMobileDetailOpen(false)}>
                  ← 返回镜头列表
                </button>

                {/* 详情头部导航 */}
                <div className="shot-detail-header">
                  <div className="shot-title-group">
                    <h2>镜头 #{String(selectedTask.order).padStart(2, "0")}</h2>
                    <select
                      className="shot-status-select"
                      value={selectedTask.status}
                      disabled={saving}
                      onChange={(e) => patchTask(selectedTask.id, { status: e.target.value as ShotTaskStatus })}
                    >
                      <option value="todo">待办 (todo)</option>
                      <option value="ready">素材已齐 (ready)</option>
                      <option value="shot">已拍摄 (shot)</option>
                      <option value="done">已完成 (done)</option>
                    </select>
                  </div>

                  <div className="shot-nav-buttons">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!prevTask}
                      onClick={() => prevTask && setSelectedId(prevTask.id)}
                    >
                      上一个镜头
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!nextTask}
                      onClick={() => nextTask && setSelectedId(nextTask.id)}
                    >
                      下一个镜头
                    </button>
                  </div>
                </div>

                {/* 快捷操作区 */}
                <div className="shot-quick-actions">
                  <span className="actions-label">快捷标记：</span>
                  <button type="button" className="action-pill ready-pill" onClick={markAssetsReady}>
                    <CheckCircle size={14} weight="fill" /> 标记素材已齐
                  </button>
                  <button type="button" className="action-pill shot-pill" onClick={markShot}>
                    <Camera size={14} weight="fill" /> 标记已拍摄
                  </button>
                  <button type="button" className="action-pill done-pill" onClick={markDone}>
                    <FlagCheckered size={14} weight="fill" /> 标记已完成
                  </button>
                </div>

                {/* 核心只读信息区 */}
                <div className="shot-section">
                  <label className="section-label">口播内容（只读）</label>
                  <div className="readonly-box narration-box">{selectedTask.narration || "（空）"}</div>
                </div>

                <div className="shot-section">
                  <label className="section-label">画面说明（只读）</label>
                  <div className="readonly-box visual-box">{selectedTask.visualDescription || "（空）"}</div>
                </div>

                <div className="shot-field-row">
                  <div>
                    <label className="section-label">景别</label>
                    <div className="readonly-badge">{selectedTask.shotType || "标准"}</div>
                  </div>
                  <div>
                    <label className="section-label">预估时长</label>
                    <div className="readonly-badge">
                      {selectedTask.durationSeconds ? `${selectedTask.durationSeconds} 秒` : "未设定"}
                    </div>
                  </div>
                </div>

                {/* 素材管理区 */}
                <div className="shot-section">
                  <label className="section-label">素材管理（点击可在已有/缺失间切换）</label>
                  <div className="assets-grid">
                    <div className="asset-column">
                      <small className="asset-column-title">所需素材 ({selectedTask.requiredAssets.length})</small>
                      <div className="tag-cloud">
                        {selectedTask.requiredAssets.map((asset) => (
                          <span key={asset} className="asset-tag required">
                            {asset}
                          </span>
                        ))}
                        {selectedTask.requiredAssets.length === 0 && <span className="muted-text">无明确限制</span>}
                      </div>
                    </div>

                    <div className="asset-column">
                      <small className="asset-column-title ready-title">
                        已有素材 ({selectedTask.existingAssets.length})
                      </small>
                      <div className="tag-cloud">
                        {selectedTask.existingAssets.map((asset) => (
                          <button
                            key={asset}
                            type="button"
                            className="asset-tag existing clickable"
                            title="点击设为缺失"
                            onClick={() => toggleAssetStatus(asset)}
                          >
                            ✓ {asset}
                          </button>
                        ))}
                        {selectedTask.existingAssets.length === 0 && <span className="muted-text">暂无记录</span>}
                      </div>
                    </div>

                    <div className="asset-column">
                      <small className="asset-column-title missing-title">
                        缺失素材 ({selectedTask.missingAssets.length})
                      </small>
                      <div className="tag-cloud">
                        {selectedTask.missingAssets.map((asset) => (
                          <button
                            key={asset}
                            type="button"
                            className="asset-tag missing clickable"
                            title="点击设为已有"
                            onClick={() => toggleAssetStatus(asset)}
                          >
                            ✗ {asset}
                          </button>
                        ))}
                        {selectedTask.missingAssets.length === 0 && <span className="muted-text">已全部就绪</span>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 匹配的真实素材文件（Finder / 预览 / 确认 / 更换） */}
                <ShotAssetRow
                  slug={slug}
                  shotTaskId={selectedTask.id}
                  shotOrder={selectedTask.order}
                  links={links}
                  allAssets={allAssets}
                  onRefresh={fetchLinks}
                />

                {/* AI 提示词区 */}
                {selectedTask.aiPrompt ? (
                  <div className="shot-section">
                    <div className="section-label-with-action">
                      <label className="section-label">AI 画面生成提示词</label>
                      <button
                        type="button"
                        className="text-link-btn"
                        onClick={() => navigator.clipboard.writeText(selectedTask.aiPrompt || "")}
                      >
                        复制提示词
                      </button>
                    </div>
                    <pre className="prompt-box">{selectedTask.aiPrompt}</pre>
                  </div>
                ) : null}

                {/* 备注编辑区 */}
                <div className="shot-section">
                  <label className="section-label">备注 / 拍摄避坑点</label>
                  <textarea
                    rows={3}
                    placeholder="输入该镜头的拍摄注意事项、机位要求、备用方案等..."
                    value={editingNotes}
                    onChange={(e) => setEditingNotes(e.target.value)}
                    onBlur={saveNotes}
                  />
                  <div className="notes-footer">
                    <small>修改失去焦点或点击保存后自动保存回 project.json</small>
                    <button type="button" className="secondary-button" disabled={saving} onClick={saveNotes}>
                      {saving ? "保存中..." : "保存备注"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="shot-none-selected">请从左侧选择一个镜头查看详情</div>
            )}
          </div>
        </div>
      )}
      <ShootingFeedbackPanel slug={slug} shotTasks={shotTasks} onChanged={() => { void fetchFeedbackState(); void loadShots(); }} />
        </>
      )}
    </div>
  );
}
