"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle,
  Copy,
  FilmStrip,
  FolderOpen,
  HardDrives,
  Play,
  Scissors,
  ShieldCheck,
  TextAa,
  WarningCircle,
} from "@phosphor-icons/react";
import type { EditingManifest, EditingManifestEntry } from "../../src/types/editingManifest";
import type { ProxyPreset, ProxyStatus } from "../../src/types/editingManifest";
import { readJsonResponse } from "../lib/readJsonResponse";

// ── API 响应类型 ──
interface ManifestSummary {
  total: number;
  video: number;
  audio: number;
  image: number;
  proxyReady: number;
  proxyRecommended: number;
  originalBytes: number;
  proxyBytes: number;
  missingSource: number;
}
interface ProxyView {
  assetId: string;
  status: ProxyStatus;
  preset?: ProxyPreset;
  proxyPath?: string;
  progress: number;
  stale?: boolean;
  jobId?: string;
  errorMessage?: string;
  reasons?: string[];
}
interface ProjectFileEntry { name: string; path: string; app: string; }
interface AssetCheckIssue {
  assetId: string;
  displayName: string;
  originalPath: string;
  type: string;
  issues: string[];
  severity: "warning" | "error";
}
interface RelinkAmbiguousItem {
  entry: { assetId: string; displayName: string; originalFileName: string };
  candidate: { path: string; name: string; size: number };
  method: string;
}

const PROXY_STATUS_LABEL: Record<ProxyStatus, string> = {
  not_needed: "无需 Proxy",
  recommended: "建议生成",
  queued: "已排队",
  generating: "生成中",
  ready: "已准备",
  failed: "失败",
};

function formatBytes(n: number): string {
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(sec?: number): string {
  if (!sec || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

interface EditingWorkbenchProps {
  slug: string;
  onBack: () => void;
}

export function EditingWorkbench({ slug, onBack }: EditingWorkbenchProps) {
  const [manifest, setManifest] = useState<EditingManifest | null>(null);
  const [summary, setSummary] = useState<ManifestSummary | null>(null);
  const [missing, setMissing] = useState<EditingManifestEntry[]>([]);
  const [projectFiles, setProjectFiles] = useState<ProjectFileEntry[]>([]);
  const [proxyViews, setProxyViews] = useState<ProxyView[]>([]);
  const [proxyPreset, setProxyPreset] = useState<ProxyPreset>("fast");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [prepared, setPrepared] = useState(false);

  // 素材检查
  const [checkResult, setCheckResult] = useState<{ total: number; okCount: number; issueCount: number; issues: AssetCheckIssue[] } | null>(null);
  const [showIssuesOnly, setShowIssuesOnly] = useState(false);

  // 重连
  const [ambiguous, setAmbiguous] = useState<RelinkAmbiguousItem[]>([]);
  const [relinkSummary, setRelinkSummary] = useState<string>("");

  const apiBase = `/api/media/projects/${encodeURIComponent(slug)}/editing`;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch(`${apiBase}/manifest`);
      const data = await readJsonResponse<{
        manifest?: EditingManifest;
        summary?: ManifestSummary;
        missing?: EditingManifestEntry[];
        projectFiles?: ProjectFileEntry[];
        proxyViews?: ProxyView[];
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error || "剪辑工作区读取失败。");
      setManifest(data.manifest || null);
      setSummary(data.summary || null);
      setMissing(data.missing || []);
      setProjectFiles(data.projectFiles || []);
      setProxyViews(data.proxyViews || []);
      setPrepared(!!data.manifest);
    } catch (err) {
      setError(err instanceof Error ? err.message : "剪辑工作区读取失败。");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { load(); }, [load]);

  // 生成中时轮询 proxy 状态
  useEffect(() => {
    const hasActive = proxyViews.some((v) => v.status === "generating" || v.status === "queued");
    if (!hasActive) return;
    const t = setInterval(() => { void load(); }, 2500);
    return () => clearInterval(t);
  }, [proxyViews, load]);

  async function runAction(key: string, fn: () => Promise<void>) {
    try {
      setBusy(key);
      setError("");
      setNotice("");
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败。");
    } finally {
      setBusy("");
    }
  }

  async function prepareWorkspace() {
    const res = await fetch(`${apiBase}/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "prepare" }),
    });
    const data = await readJsonResponse<{ symlinkCount?: number; symlinkFailed?: number; error?: string }>(res);
    if (!res.ok) throw new Error(data.error || "准备失败。");
    setNotice(`剪辑工作区已准备：${data.symlinkCount ?? 0} 个 symlink${data.symlinkFailed ? `，${data.symlinkFailed} 个失败` : ""}。`);
    await load();
  }

  async function generateProxy(assetId: string) {
    const res = await fetch(`${apiBase}/proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId, preset: proxyPreset }),
    });
    const data = await readJsonResponse<{ reason?: string; reused?: boolean; error?: string }>(res);
    if (!res.ok) throw new Error(data.error || "Proxy 入队失败。");
    setNotice(data.reason || "已入队。");
    await load();
  }

  async function batchGenerate(scope: "recommended" | "all" | "shots") {
    const res = await fetch(`${apiBase}/proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batch: true, scope, preset: proxyPreset }),
    });
    const data = await readJsonResponse<{ enqueued?: number; reused?: number; skipped?: number; error?: string }>(res);
    if (!res.ok) throw new Error(data.error || "批量入队失败。");
    setNotice(`批量生成：入队 ${data.enqueued ?? 0}，复用 ${data.reused ?? 0}，跳过 ${data.skipped ?? 0}。`);
    await load();
  }

  async function cancelProxy(jobId: string) {
    const res = await fetch(`${apiBase}/proxy/${encodeURIComponent(jobId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    const data = await readJsonResponse<{ reason?: string; error?: string }>(res);
    if (!res.ok) throw new Error(data.error || "取消失败。");
    setNotice(data.reason || "已取消。");
    await load();
  }

  async function retryProxy(jobId: string) {
    const res = await fetch(`${apiBase}/proxy/${encodeURIComponent(jobId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry" }),
    });
    const data = await readJsonResponse<{ reason?: string; error?: string }>(res);
    if (!res.ok) throw new Error(data.error || "重试失败。");
    setNotice(data.reason || "已重新入队。");
    await load();
  }

  async function openPath(action: "reveal" | "open" | "open-dir" | "copy-path", targetPath: string) {
    const res = await fetch(`${apiBase}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, path: targetPath }),
    });
    const data = await readJsonResponse<{ data?: { result?: { ok?: boolean; error?: string } }; error?: string }>(res);
    if (!res.ok) throw new Error(data.error || "系统操作失败。");
    if (action === "copy-path") setNotice("已复制路径。");
    else if (data.data?.result && !data.data.result.ok) setNotice(data.data.result.error || "操作未成功。");
  }

  async function checkAssets() {
    const res = await fetch(`${apiBase}/check`);
    const data = await readJsonResponse<{ total?: number; okCount?: number; issueCount?: number; issues?: AssetCheckIssue[]; error?: string }>(res);
    if (!res.ok) throw new Error(data.error || "检查失败。");
    setCheckResult({ total: data.total ?? 0, okCount: data.okCount ?? 0, issueCount: data.issueCount ?? 0, issues: data.issues || [] });
    setShowIssuesOnly(false);
    setNotice(`素材检查：${data.total ?? 0} 个，正常 ${data.okCount ?? 0}，需注意 ${data.issueCount ?? 0}。`);
  }

  async function pickAndRelink() {
    const pickRes = await fetch("/api/media/pick-directory", { method: "POST" });
    const pickData = await readJsonResponse<{ data?: { directory?: string; canceled?: boolean }; error?: string }>(pickRes);
    if (!pickRes.ok) throw new Error(pickData.error || "目录选择失败。");
    if (pickData.data?.canceled || !pickData.data?.directory) return;
    const dir = pickData.data.directory;
    const res = await fetch(`${apiBase}/relink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "scan", directory: dir }),
    });
    const data = await readJsonResponse<{
      totalMissing?: number; autoRelinked?: number; ambiguous?: Array<{ entry: { assetId: string; displayName: string; originalFileName: string }; candidate: { path: string; name: string; size: number }; method: string }>; unmatched?: EditingManifestEntry[]; scannedFiles?: number; error?: string;
    }>(res);
    if (!res.ok) throw new Error(data.error || "重连失败。");
    setAmbiguous(data.ambiguous || []);
    setRelinkSummary(`扫描 ${data.scannedFiles ?? 0} 个文件 · 自动重连 ${data.autoRelinked ?? 0} / ${data.totalMissing ?? 0} · 待确认 ${data.ambiguous?.length ?? 0} · 未匹配 ${data.unmatched?.length ?? 0}`);
    setNotice(`重连完成：自动 ${data.autoRelinked ?? 0}，待确认 ${data.ambiguous?.length ?? 0}，未匹配 ${data.unmatched?.length ?? 0}。`);
    await load();
  }

  async function confirmRelink(assetId: string, newPath: string) {
    const res = await fetch(`${apiBase}/relink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm", assetId, path: newPath }),
    });
    const data = await readJsonResponse<{ reason?: string; error?: string }>(res);
    if (!res.ok) throw new Error(data.error || "确认失败。");
    setAmbiguous((prev) => prev.filter((a) => a.entry.assetId !== assetId));
    await load();
  }

  async function renameSymlinks() {
    const res = await fetch(`${apiBase}/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rename" }),
    });
    const data = await readJsonResponse<{ renamed?: number; skipped?: number; error?: string }>(res);
    if (!res.ok) throw new Error(data.error || "重命名失败。");
    setNotice(`重命名完成：${data.renamed ?? 0} 个，跳过 ${data.skipped ?? 0} 个。`);
    await load();
  }

  if (loading) {
    return (
      <div className="shot-workspace-loading">
        <div className="agent-loader"><span /><span /><span /></div>
        <p>正在载入剪辑工作区...</p>
      </div>
    );
  }

  const proxyByAsset = new Map(proxyViews.map((v) => [v.assetId, v]));
  const videoEntries = manifest?.entries.filter((e) => e.type === "video") || [];
  const recommendedCount = proxyViews.filter((v) => v.status === "recommended").length;

  return (
    <div className="editing-workbench">
      <header className="editing-topbar">
        <button type="button" className="editing-back-button" onClick={onBack}>
          <ArrowLeft size={16} weight="bold" /> 镜头执行
        </button>
        <div className="editing-title-block">
          <span>EDIT PREP</span>
          <h2><Scissors size={24} weight="fill" /> 剪辑准备</h2>
          <p>整理原素材、Proxy 与工程路径，让剪辑软件开箱即用。</p>
        </div>
        <div className="editing-scope-badge"><ShieldCheck size={16} weight="fill" /> 不改动原素材</div>
      </header>

      {error && <div className="product-alert alert-warning"><span>!</span><p>{error}</p></div>}
      {notice && <div className="product-alert alert-success"><span>✓</span><p>{notice}</p></div>}

      {!prepared ? (
        <div className="shot-empty-card">
          <div className="empty-icon"><FilmStrip size={28} weight="fill" /></div>
          <span className="empty-kicker">WORKSPACE SETUP</span>
          <h3>建立一套干净的剪辑工作区</h3>
          <p>自动创建标准目录，以 symlink 引用原素材，不复制视频、不占用额外空间。</p>
          <button type="button" className="primary-button inline" disabled={busy === "prepare"} onClick={() => runAction("prepare", prepareWorkspace)}>
            {busy === "prepare" ? <span className="spinner" /> : "一键准备剪辑"}
          </button>
        </div>
      ) : (
        <>
          {/* 紧凑概览（一行信息，无 Dashboard 卡片） */}
          <div className="editing-summary-row">
            <div><small>全部素材</small><strong>{summary?.total ?? 0}</strong><span>{summary?.video ?? 0} 视频 · {summary?.audio ?? 0} 音频 · {summary?.image ?? 0} 图片</span></div>
            <div><small>Proxy 就绪</small><strong>{summary?.proxyReady ?? 0}<em> / {summary?.video ?? 0}</em></strong><span>{recommendedCount} 个建议生成</span></div>
            <div><small>原素材容量</small><strong>{formatBytes(summary?.originalBytes ?? 0)}</strong><span>仅创建路径引用</span></div>
            <div><small>Proxy 容量</small><strong>{formatBytes(summary?.proxyBytes ?? 0)}</strong><span>可随时重新生成</span></div>
          </div>

          {/* 控制栏 */}
          <div className="editing-section-heading">
            <div><span>01</span><div><h3>工作区操作</h3><p>准备代理文件、检查路径并标准化命名。</p></div></div>
            <span className="editing-section-status"><CheckCircle size={14} weight="fill" /> 工作区已就绪</span>
          </div>
          <div className="editing-controls">
            <button type="button" className="primary-button media-action-btn" disabled={busy === "batch"} onClick={() => runAction("batch", () => batchGenerate("recommended"))}>
              {busy === "batch" ? <span className="spinner" /> : <><FilmStrip size={16} weight="fill" /> 生成建议 Proxy ({recommendedCount})</>}
            </button>
            <button type="button" className="secondary-button media-action-btn" disabled={busy === "open-editing"} onClick={() => runAction("open-editing", () => openPath("open-dir", manifest?.editingDir || ""))}>
              <FolderOpen size={16} /> 打开剪辑目录
            </button>
            <button type="button" className="secondary-button media-action-btn" disabled={busy === "check"} onClick={() => runAction("check", checkAssets)}>
              {busy === "check" ? <span className="spinner dark" /> : <><ShieldCheck size={16} /> 检查素材</>}
            </button>
            <button type="button" className="secondary-button media-action-btn" disabled={busy === "rename"} onClick={() => runAction("rename", renameSymlinks)}>
              <TextAa size={16} /> 生成剪辑文件名
            </button>
            <div className="proxy-preset-picker" role="radiogroup" aria-label="Proxy 预设">
              <span className="preset-label">Proxy：</span>
              <label><input type="radio" name="proxy-preset" checked={proxyPreset === "fast"} onChange={() => setProxyPreset("fast")} /> 快速</label>
              <label><input type="radio" name="proxy-preset" checked={proxyPreset === "high"} onChange={() => setProxyPreset("high")} /> 高质量</label>
            </div>
          </div>

          {/* 失效素材提示 */}
          {missing.length > 0 && (
            <div className="editing-missing-bar">
              <span><WarningCircle size={17} weight="fill" /> {missing.length} 个素材路径失效</span>
              <button type="button" className="secondary-button media-action-btn" disabled={busy === "relink"} onClick={() => runAction("relink", pickAndRelink)}>
                {busy === "relink" ? <span className="spinner dark" /> : "重新定位"}
              </button>
            </div>
          )}

          {/* 重连结果 */}
          {relinkSummary && (
            <div className="editing-relink-result">
              <span>{relinkSummary}</span>
              {missing.length > 0 && (
                <button type="button" className="secondary-button media-mini-btn" disabled={busy === "relink"} onClick={() => runAction("relink", pickAndRelink)}>再次重连</button>
              )}
            </div>
          )}
          {ambiguous.length > 0 && (
            <div className="editing-ambiguous-list">
              <div className="ambiguous-head">以下素材需要人工确认：</div>
              {ambiguous.map((a) => (
                <div key={a.entry.assetId} className="ambiguous-row">
                  <span className="amb-name">{a.entry.displayName}</span>
                  <span className="amb-cand">→ {a.candidate.name}（{a.method}）</span>
                  <button type="button" className="primary-button media-mini-btn" onClick={() => confirmRelink(a.entry.assetId, a.candidate.path)}>确认</button>
                </div>
              ))}
            </div>
          )}

          {/* 素材检查结果 */}
          {checkResult && (
            <div className="editing-check-result">
              <div className="check-head">
                <span>{checkResult.total} 个素材 · {checkResult.okCount} 正常 · {checkResult.issueCount} 需注意</span>
                {checkResult.issueCount > 0 && (
                  <label className="check-filter">
                    <input type="checkbox" checked={showIssuesOnly} onChange={(e) => setShowIssuesOnly(e.target.checked)} /> 只看异常
                  </label>
                )}
              </div>
              {checkResult.issues.filter((i) => !showIssuesOnly || true).length === 0 && showIssuesOnly && (
                <div className="check-empty">无异常项</div>
              )}
              {checkResult.issues
                .filter(() => !showIssuesOnly || true)
                .filter((i) => (showIssuesOnly ? i.issues.length > 0 : true))
                .map((i) => (
                  <div key={i.assetId} className={`check-row ${i.severity}`}>
                    <span className="check-name">{i.displayName}</span>
                    <span className="check-issues">{i.issues.join("，")}</span>
                  </div>
                ))}
            </div>
          )}

          {/* 工程文件入口 */}
          {projectFiles.length > 0 && (
            <div className="editing-project-files">
              <span className="pf-head">最近工程文件</span>
              {projectFiles.map((f) => (
                <div key={f.path} className="pf-row">
                  <span className="pf-name">{f.name}</span>
                  <span className="pf-app">{f.app}</span>
                  <button type="button" className="secondary-button media-mini-btn" onClick={() => openPath("open", f.path)}>打开</button>
                </div>
              ))}
            </div>
          )}

          {/* 素材行（一行一个，无卡片套卡片） */}
          <div className="editing-section-heading asset-heading">
            <div><span>02</span><div><h3>视频素材</h3><p>逐项检查规格，并管理每个素材的 Proxy 状态。</p></div></div>
            <span className="editing-section-status"><HardDrives size={14} /> {videoEntries.length} 个文件</span>
          </div>
          <div className="editing-asset-list">
            <div className="asset-list-head"><span>素材信息</span><span>Proxy 与文件操作</span></div>
            {videoEntries.map((entry) => {
              const pv = proxyByAsset.get(entry.assetId);
              const status = pv?.status || "not_needed";
              const isGenerating = status === "generating" || status === "queued";
              const jobId = pv?.jobId || "";
              return (
                <div key={entry.assetId} className="editing-asset-row">
                  <div className="asset-row-main">
                    <span className="asset-display-name">{entry.displayName}</span>
                    <span className="asset-meta">
                      {entry.width && entry.height ? `${entry.width}x${entry.height}` : ""}
                      {entry.codec ? ` · ${entry.codec}` : ""}
                      {entry.duration ? ` · ${formatDuration(entry.duration)}` : ""}
                      {entry.orientation ? ` · ${entry.orientation}` : ""}
                    </span>
                  </div>
                  <div className="asset-row-proxy">
                    {isGenerating ? (
                      <>
                        <span className="proxy-gen">{PROXY_STATUS_LABEL[status]} {pv?.progress ?? 0}%</span>
                        {jobId && <button type="button" className="secondary-button media-mini-btn" onClick={() => cancelProxy(jobId)}>取消</button>}
                      </>
                    ) : status === "ready" ? (
                      <>
                        <span className="proxy-ready">{pv?.stale ? "Proxy 已过期" : "Proxy 已准备"}{entry.proxySizeBytes ? ` · ${formatBytes(entry.proxySizeBytes)}` : ""}</span>
                        <button type="button" className="secondary-button media-mini-btn" onClick={() => openPath("reveal", entry.proxyPath || "")}><FolderOpen size={13} /> Finder</button>
                        <button type="button" className="secondary-button media-mini-btn" onClick={() => openPath("open", entry.proxyPath || "")}><Play size={13} weight="fill" /> 播放</button>
                      </>
                    ) : status === "failed" ? (
                      <>
                        <span className="proxy-failed" title={pv?.errorMessage}>生成失败</span>
                        {jobId && <button type="button" className="secondary-button media-mini-btn" onClick={() => retryProxy(jobId)}>重试</button>}
                      </>
                    ) : status === "recommended" ? (
                      <>
                        <span className="proxy-rec">建议生成</span>
                        <button type="button" className="primary-button media-mini-btn" onClick={() => generateProxy(entry.assetId)}>生成</button>
                      </>
                    ) : (
                      <>
                        <span className="proxy-none">{PROXY_STATUS_LABEL[status]}</span>
                        <button type="button" className="secondary-button media-mini-btn" onClick={() => generateProxy(entry.assetId)}>生成</button>
                      </>
                    )}
                    <span className="asset-row-sep">·</span>
                    <button type="button" className="secondary-button media-mini-btn" onClick={() => openPath("reveal", entry.originalPath)}><FolderOpen size={13} /> 原素材</button>
                    <button type="button" className="secondary-button media-mini-btn" onClick={() => openPath("copy-path", entry.originalPath)}><Copy size={13} /> 路径</button>
                  </div>
                </div>
              );
            })}
            {videoEntries.length === 0 && <div className="check-empty">暂无视频素材，请先扫描并归项目。</div>}
          </div>
        </>
      )}
    </div>
  );
}
