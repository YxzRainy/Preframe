"use client";

import { useCallback, useEffect, useState } from "react";
import { CaretDown, Crosshair, FolderOpen, GearSix, ListChecks, MagnifyingGlass } from "@phosphor-icons/react";
import type { MediaAsset, ShotAssetLink } from "../../src/types/mediaAsset";
import { readJsonResponse } from "../lib/readJsonResponse";

// ── 前端使用的富化关系类型（含素材信息） ──
export interface EnrichedLink extends ShotAssetLink {
  asset?: MediaAsset;
}

interface MediaPreferences {
  watchedDirectories: Array<{ id: string; path: string; enabled: boolean }>;
}

interface BatchSuggestion {
  startOrder: number;
  endOrder: number;
  linkIds: string[];
  count: number;
}

interface EditPlanSummary {
  totalShots: number;
  shotsWithAsset: number;
  missingShots: number;
}

// =========================================================================
// 素材监听目录配置面板（全局一次性配置）
// =========================================================================
export function MediaPreferencesPanel() {
  const [prefs, setPrefs] = useState<MediaPreferences>({ watchedDirectories: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manualPath, setManualPath] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/media/preferences");
      const data = await readJsonResponse<{ preferences?: MediaPreferences; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "配置读取失败。");
      setPrefs(data.preferences || { watchedDirectories: [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "配置读取失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function pickDirectory() {
    try {
      setBusy(true);
      setError("");
      const res = await fetch("/api/media/pick-directory", { method: "POST" });
      const data = await readJsonResponse<{ data?: { directory?: string; canceled?: boolean }; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "目录选择失败。");
      if (data.data?.canceled) return;
      if (data.data?.directory) {
        await addDirectory(data.data.directory);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "目录选择失败。");
    } finally {
      setBusy(false);
    }
  }

  async function addDirectory(dirPath: string) {
    try {
      setBusy(true);
      setError("");
      const res = await fetch("/api/media/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", path: dirPath }),
      });
      const data = await readJsonResponse<{ preferences?: MediaPreferences; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "添加失败。");
      setPrefs(data.preferences || prefs);
      setManualPath("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加失败。");
    } finally {
      setBusy(false);
    }
  }

  async function removeDirectory(id: string) {
    try {
      setBusy(true);
      const res = await fetch("/api/media/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", id }),
      });
      const data = await readJsonResponse<{ preferences?: MediaPreferences; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "删除失败。");
      setPrefs(data.preferences || prefs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败。");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDirectory(id: string, enabled: boolean) {
    try {
      const res = await fetch("/api/media/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle", id, enabled }),
      });
      const data = await readJsonResponse<{ preferences?: MediaPreferences; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "切换失败。");
      setPrefs(data.preferences || prefs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换失败。");
    }
  }

  if (loading) return <div className="media-prefs-loading">载入监听目录...</div>;

  return (
    <div className="media-prefs-panel">
      <div className="media-prefs-header">
        <span className="media-section-title"><FolderOpen size={16} weight="fill" /> 素材监听目录</span>
        <div className="media-prefs-actions">
          <input
            type="text"
            className="media-path-input"
            placeholder="或手动输入绝对路径"
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            disabled={busy}
          />
          <button
            type="button"
            className="secondary-button media-mini-btn"
            disabled={busy || !manualPath.trim()}
            onClick={() => addDirectory(manualPath.trim())}
          >
            添加
          </button>
          <button
            type="button"
            className="secondary-button media-mini-btn"
            disabled={busy}
            onClick={pickDirectory}
          >
            选择目录
          </button>
        </div>
      </div>
      {error && <div className="media-prefs-error">{error}</div>}
      {prefs.watchedDirectories.length === 0 ? (
        <div className="media-prefs-empty">尚未配置监听目录。添加 DJI 导入目录、AirDrop 目录或项目拍摄目录。</div>
      ) : (
        <div className="media-dir-list">
          {prefs.watchedDirectories.map((dir) => (
            <div key={dir.id} className={`media-dir-row ${dir.enabled ? "" : "disabled"}`}>
              <span className="media-dir-path" title={dir.path}>{dir.path}</span>
              <button
                type="button"
                className="media-toggle-btn"
                onClick={() => toggleDirectory(dir.id, !dir.enabled)}
                title={dir.enabled ? "点击停用" : "点击启用"}
              >
                {dir.enabled ? "● 启用" : "○ 停用"}
              </button>
              <button
                type="button"
                className="media-remove-btn"
                onClick={() => removeDirectory(dir.id)}
                title="移除"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =========================================================================
// 素材控制栏：扫描 + 项目匹配 + 镜头匹配 + 批量确认 + 剪辑清单
// =========================================================================
interface ShotMediaBarProps {
  slug: string;
  batchSuggestions: BatchSuggestion[];
  onLinksRefresh: () => Promise<void> | void;
}

export function ShotMediaBar({ slug, batchSuggestions, onLinksRefresh }: ShotMediaBarProps) {
  const [scanning, setScanning] = useState(false);
  const [matching, setMatching] = useState(false);
  const [shotMatching, setShotMatching] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<EditPlanSummary | null>(null);

  async function handleScan() {
    try {
      setScanning(true);
      setError("");
      setNotice("");
      const res = await fetch("/api/media/assets?scan=1");
      const data = await readJsonResponse<{ newCount?: number; capability?: string; assets?: MediaAsset[]; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "扫描失败。");
      const cap = data.capability === "full" ? "（ffprobe 已启用）" : "（ffprobe 缺失，基础信息）";
      setNotice(`扫描完成：新增 ${data.newCount ?? 0} 个稳定素材 ${cap}`);
      await handleMatchProject();
      await handleShotMatch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "扫描失败。");
    } finally {
      setScanning(false);
    }
  }

  async function handleMatchProject() {
    try {
      setMatching(true);
      const res = await fetch("/api/media/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "auto" }) });
      const data = await readJsonResponse<{ matchedCount?: number; candidateCount?: number; unmatchedCount?: number; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "项目匹配失败。");
      await onLinksRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "项目匹配失败。");
    } finally {
      setMatching(false);
    }
  }

  async function handleShotMatch() {
    try {
      setShotMatching(true);
      setError("");
      const res = await fetch(`/api/media/projects/${encodeURIComponent(slug)}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "match" }),
      });
      const data = await readJsonResponse<{ batchSuggestions?: BatchSuggestion[]; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "镜头匹配失败。");
      const batches = data.batchSuggestions || [];
      setNotice(batches.length > 0 ? `镜头匹配完成，检测到 ${batches.length} 组连续素材可批量确认。` : "镜头匹配完成。");
      await onLinksRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "镜头匹配失败。");
    } finally {
      setShotMatching(false);
    }
  }

  async function handleBatchConfirm(linkIds: string[]) {
    try {
      setBusy(linkIds.length);
      setError("");
      const res = await fetch(`/api/media/projects/${encodeURIComponent(slug)}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "batch-confirm", linkIds }),
      });
      const data = await readJsonResponse<{ confirmedCount?: number; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "批量确认失败。");
      setNotice(`已批量确认 ${data.confirmedCount ?? linkIds.length} 个关系。`);
      await onLinksRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量确认失败。");
    } finally {
      setBusy(0);
    }
  }

  async function handleEditPlan() {
    try {
      setPlanBusy(true);
      setError("");
      const res = await fetch(`/api/media/projects/${encodeURIComponent(slug)}/edit-plan`, { method: "POST" });
      const data = await readJsonResponse<{ plan?: EditPlanSummary; jsonPath?: string; markdownPath?: string; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "剪辑清单生成失败。");
      setEditPlan(data.plan || null);
      setNotice(`剪辑准备清单已生成：${data.plan?.totalShots ?? 0} 镜头，缺失 ${data.plan?.missingShots ?? 0}。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "剪辑清单生成失败。");
    } finally {
      setPlanBusy(false);
    }
  }

  const [busy, setBusy] = useState(0);

  return (
    <div className="shot-media-bar">
      <div className="shot-media-controls">
        <button type="button" className="primary-button media-action-btn" disabled={scanning || matching || shotMatching} onClick={handleScan}>
          {scanning || matching || shotMatching ? <span className="spinner" /> : <><MagnifyingGlass size={15} weight="bold" /> 同步并匹配素材</>}
        </button>
        <details className="media-tools-menu">
          <summary><CaretDown size={14} weight="bold" /> 更多素材操作</summary>
          <div>
            <button type="button" disabled={shotMatching} onClick={handleShotMatch}>{shotMatching ? "匹配中…" : <><Crosshair size={15} weight="bold" />重新匹配镜头</>}</button>
            <button type="button" disabled={planBusy} onClick={handleEditPlan}>{planBusy ? "生成中…" : <><ListChecks size={15} weight="fill" />生成剪辑清单</>}</button>
            <button type="button" onClick={() => setPrefsOpen((v) => !v)}><GearSix size={15} weight="fill" />{prefsOpen ? "收起目录配置" : "设置监听目录"}</button>
          </div>
        </details>
      </div>

      {error && <div className="media-bar-error">{error}</div>}
      {notice && <div className="media-bar-notice">{notice}</div>}

      {prefsOpen && <MediaPreferencesPanel />}

      {editPlan && (
        <div className="media-edit-plan-summary">
          剪辑清单：{editPlan.totalShots} 镜头 · 已有素材 {editPlan.shotsWithAsset} · 缺失 {editPlan.missingShots}
          <span className="media-plan-hint">（已写入项目 editing/ 目录）</span>
        </div>
      )}

      {batchSuggestions.map((batch, idx) => (
        <div key={idx} className="media-batch-banner">
          <span>检测到 {batch.count} 个连续素材可能对应镜头 {String(batch.startOrder).padStart(2, "0")}–{String(batch.endOrder).padStart(2, "0")}</span>
          <div className="media-batch-actions">
            <button
              type="button"
              className="primary-button media-mini-btn"
              disabled={busy > 0}
              onClick={() => handleBatchConfirm(batch.linkIds)}
            >
              全部确认
            </button>
            <span className="media-batch-hint">或在下方逐个检查</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// =========================================================================
// 单镜头素材行：显示匹配的素材 + 真实系统动作 + 确认/更换
// =========================================================================
interface ShotAssetRowProps {
  slug: string;
  shotTaskId: string;
  shotOrder: number;
  links: EnrichedLink[];
  allAssets: MediaAsset[];
  onRefresh: () => Promise<void> | void;
}

export function ShotAssetRow({ slug, shotTaskId, links, allAssets, onRefresh }: ShotAssetRowProps) {
  const [busy, setBusy] = useState(false);
  const [reassignMode, setReassignMode] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<MediaAsset | null>(null);

  const shotLinks = links
    .filter((l) => l.shotTaskId === shotTaskId && l.status !== "rejected")
    .sort((a, b) => {
      if (a.primary && !b.primary) return -1;
      if (!a.primary && b.primary) return 1;
      if (a.status === "confirmed" && b.status !== "confirmed") return -1;
      if (a.status !== "confirmed" && b.status === "confirmed") return 1;
      return b.confidence - a.confidence;
    });

  async function doAction(assetId: string, action: "reveal" | "open" | "open-dir" | "copy-path") {
    try {
      setBusy(true);
      const res = await fetch(`/api/media/assets/${encodeURIComponent(assetId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "操作失败。");
    } catch {
      // 静默失败（轻量 toast）
    } finally {
      setBusy(false);
    }
  }

  async function confirmLink(linkId: string) {
    try {
      setBusy(true);
      const res = await fetch(`/api/media/projects/${encodeURIComponent(slug)}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", linkId, primary: true }),
      });
      const data = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "确认失败。");
      await onRefresh();
    } catch {
      setBusy(false);
    }
  }

  async function rejectLink(linkId: string) {
    try {
      setBusy(true);
      const res = await fetch(`/api/media/projects/${encodeURIComponent(slug)}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", linkId }),
      });
      const data = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "拒绝失败。");
      await onRefresh();
    } catch {
      setBusy(false);
    }
  }

  async function reassignToShot(linkId: string, newShotTaskId: string) {
    try {
      setBusy(true);
      const res = await fetch(`/api/media/projects/${encodeURIComponent(slug)}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reassign", linkId, shotTaskId: newShotTaskId }),
      });
      const data = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "重新指定失败。");
      setReassignMode(false);
      await onRefresh();
    } catch {
      setBusy(false);
    }
  }

  async function manualLinkAsset(assetId: string) {
    try {
      setBusy(true);
      const res = await fetch(`/api/media/projects/${encodeURIComponent(slug)}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "manual-link", shotTaskId, assetId }),
      });
      const data = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "指定失败。");
      await onRefresh();
    } catch {
      setBusy(false);
    }
  }

  // 预览：浏览器可播放 mp4/webm/m4v，mov 部分浏览器支持；图片直接显示
  function canPreviewInBrowser(asset: MediaAsset): boolean {
    return [".mp4", ".webm", ".m4v", ".mov", ".jpg", ".jpeg", ".png", ".webp"].includes(asset.ext.toLowerCase());
  }

  return (
    <div className="shot-asset-section">
      <div className="shot-asset-section-header">
        <span className="section-label">匹配素材</span>
        <button type="button" className="media-text-btn" onClick={() => setReassignMode((v) => !v)}>
          {reassignMode ? "取消更换" : "更换素材"}
        </button>
      </div>

      {shotLinks.length === 0 && !reassignMode && (
        <div className="shot-asset-empty">无匹配素材</div>
      )}

      <div className="shot-asset-rows">
        {shotLinks.map((link) => {
          const asset = link.asset;
          if (!asset) return null;
          const isConfirmed = link.status === "confirmed";
          const isPrimary = link.primary;
          const statusLabel = isPrimary ? "主素材" : isConfirmed ? "已确认" : "候选";
          const dur = asset.durationSeconds ? `${Math.round(asset.durationSeconds)}s` : "";
          const ori = asset.orientation === "portrait" ? "竖" : asset.orientation === "landscape" ? "横" : "";
          return (
            <div key={link.id} className={`shot-asset-row ${isConfirmed ? "confirmed" : "candidate"}`}>
              <span className={`asset-status-tag ${isPrimary ? "primary" : isConfirmed ? "confirmed" : "candidate"}`}>{statusLabel}</span>
              <span className="asset-filename" title={asset.path}>{asset.fileName}</span>
              {dur && <span className="asset-meta">{dur}</span>}
              {ori && <span className="asset-meta">{ori}</span>}
              {link.confidence > 0 && !isConfirmed && <span className="asset-meta">{Math.round(link.confidence)}%</span>}
              <div className="asset-actions">
                <button type="button" className="media-mini-link" disabled={busy} onClick={() => doAction(asset.id, "reveal")} title="Finder 中显示">Finder</button>
                <button type="button" className="media-mini-link" disabled={busy} onClick={() => canPreviewInBrowser(asset) ? setPreviewAsset(asset) : doAction(asset.id, "open")} title="预览">预览</button>
                <button type="button" className="media-mini-link" disabled={busy} onClick={() => doAction(asset.id, "copy-path")} title="复制路径">路径</button>
                {!isConfirmed && (
                  <button type="button" className="media-mini-link confirm" disabled={busy} onClick={() => confirmLink(link.id)}>确认</button>
                )}
                <button type="button" className="media-mini-link reject" disabled={busy} onClick={() => rejectLink(link.id)}>×</button>
              </div>
            </div>
          );
        })}
      </div>

      {reassignMode && (
        <div className="shot-asset-reassign">
          <small>从本项目素材中选择一个指定到当前镜头：</small>
          <div className="reassign-asset-list">
            {allAssets
              .filter((a) => a.projectSlug === slug)
              .slice(0, 30)
              .map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="reassign-asset-btn"
                  disabled={busy}
                  onClick={() => manualLinkAsset(a.id)}
                >
                  {a.fileName}
                </button>
              ))}
            {allAssets.filter((a) => a.projectSlug === slug).length === 0 && (
              <span className="muted-text">本项目暂无素材，先扫描并归项目。</span>
            )}
          </div>
        </div>
      )}

      {previewAsset && (
        <div className="media-preview-overlay" onClick={() => setPreviewAsset(null)}>
          <div className="media-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="media-preview-header">
              <span>{previewAsset.fileName}</span>
              <button type="button" className="media-preview-close" onClick={() => setPreviewAsset(null)}>关闭</button>
            </div>
            <div className="media-preview-body">
              {previewAsset.ext.toLowerCase().match(/\.(jpg|jpeg|png|webp)$/) ? (
                <img src={`file://${previewAsset.path}`} alt={previewAsset.fileName} className="media-preview-img" />
              ) : (
                <video src={`file://${previewAsset.path}`} controls className="media-preview-video" />
              )}
            </div>
            <div className="media-preview-footer">
              <button type="button" className="secondary-button media-mini-btn" onClick={() => doAction(previewAsset.id, "open")}>系统播放器打开</button>
              <button type="button" className="secondary-button media-mini-btn" onClick={() => doAction(previewAsset.id, "reveal")}>Finder 定位</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// 缺镜头统计条
// =========================================================================
interface MissingShotsBarProps {
  total: number;
  withAsset: number;
  missingCount: number;
  filterMissing: boolean;
  onToggleFilter: () => void;
}

export function MissingShotsBar({ total, withAsset, missingCount, filterMissing, onToggleFilter }: MissingShotsBarProps) {
  return (
    <div className="media-missing-bar">
      <span className="media-missing-text">
        <strong className={missingCount > 0 ? "missing-strong" : ""}>{missingCount > 0 ? `${missingCount} 个镜头缺素材` : "素材已齐"}</strong>
      </span>
      {missingCount > 0 && (
        <button
          type="button"
          className={`secondary-button media-mini-btn ${filterMissing ? "active" : ""}`}
          onClick={onToggleFilter}
        >
          {filterMissing ? "显示全部镜头" : "只看缺失镜头"}
        </button>
      )}
    </div>
  );
}
