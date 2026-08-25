"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, DownloadSimple, Trash, UploadSimple, Wrench } from "@phosphor-icons/react";
import { readJsonResponse } from "../lib/readJsonResponse";

interface MigrationReport {
  currentVersion: number;
  targetVersion: number;
  scannedProjects: number;
  pendingProjects: number;
  migratedProjects: number;
  backupPath?: string;
}

interface DiagnosticEntry {
  id: string;
  timestamp: string;
  stage: string;
  message: string;
}

export function DataMaintenancePanel() {
  const restoreInput = useRef<HTMLInputElement>(null);
  const [migration, setMigration] = useState<MigrationReport | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const [migrationResponse, diagnosticsResponse] = await Promise.all([
      fetch("/api/maintenance/migrate", { cache: "no-store" }),
      fetch("/api/maintenance/diagnostics", { cache: "no-store" }),
    ]);
    const migrationData = await readJsonResponse<{ report?: MigrationReport; error?: string }>(migrationResponse);
    const diagnosticsData = await readJsonResponse<{ entries?: DiagnosticEntry[]; error?: string }>(diagnosticsResponse);
    if (!migrationResponse.ok) throw new Error(migrationData.error || "数据版本检查失败。");
    if (!diagnosticsResponse.ok) throw new Error(diagnosticsData.error || "诊断日志读取失败。");
    setMigration(migrationData.report || null);
    setDiagnostics(diagnosticsData.entries || []);
  }

  useEffect(() => {
    load().catch((caught) => setError(caught instanceof Error ? caught.message : "数据维护状态读取失败。"));
  }, []);

  function downloadBackup() {
    const anchor = document.createElement("a");
    anchor.href = "/api/maintenance/backup";
    anchor.download = "";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function restoreBackup(file: File) {
    setBusy("restore"); setError(""); setMessage("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/maintenance/backup", { method: "POST", body: form });
      const data = await readJsonResponse<{ restored?: { restoredFiles: number; rollbackBackupPath: string }; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "配置恢复失败。");
      setMessage(`已恢复 ${data.restored?.restoredFiles || 0} 个本地配置文件；恢复前备份已保留，API Key 沿用本机当前值。`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "配置恢复失败。");
    } finally {
      setBusy("");
      if (restoreInput.current) restoreInput.current.value = "";
    }
  }

  async function migrate() {
    setBusy("migrate"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/maintenance/migrate", { method: "POST" });
      const data = await readJsonResponse<{ report?: MigrationReport; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "数据迁移失败。");
      setMigration(data.report || null);
      setMessage(data.report?.migratedProjects ? `已迁移 ${data.report.migratedProjects} 个项目，迁移前备份已保留。` : "本地数据已是最新版本。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "数据迁移失败。");
    } finally { setBusy(""); }
  }

  async function clearLogs() {
    setBusy("logs"); setError("");
    try {
      const response = await fetch("/api/maintenance/diagnostics", { method: "DELETE" });
      const data = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "诊断日志清理失败。");
      setDiagnostics([]);
      setMessage("诊断日志已清理。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "诊断日志清理失败。");
    } finally { setBusy(""); }
  }

  return (
    <div className="maintenance-panel">
      <section className="maintenance-block">
        <div><h3>本地配置备份</h3><p>备份 `.piance` 中的设置、灵感、待办、素材索引和发布记录。导出文件不包含明文 API Key。</p></div>
        <div className="maintenance-actions">
          <button type="button" className="settings-section-action" onClick={downloadBackup}><DownloadSimple size={16} />导出备份</button>
          <button type="button" className="settings-section-action secondary" onClick={() => restoreInput.current?.click()} disabled={Boolean(busy)}><UploadSimple size={16} />{busy === "restore" ? "恢复中" : "恢复备份"}</button>
          <input ref={restoreInput} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void restoreBackup(file); }} />
        </div>
      </section>

      <section className="maintenance-block">
        <div className="maintenance-status-row"><div><h3>数据版本</h3><p>统一旧项目字段并写入当前数据版本，执行前会自动保存本地备份。</p></div><strong>v{migration?.currentVersion ?? "-"} / v{migration?.targetVersion ?? 1}</strong></div>
        <div className="maintenance-facts"><span>扫描 {migration?.scannedProjects ?? 0} 个项目</span><span>{migration?.pendingProjects ? `${migration.pendingProjects} 个待迁移` : "无需迁移"}</span></div>
        <button type="button" className="settings-section-action" onClick={migrate} disabled={Boolean(busy) || !migration?.pendingProjects}><Wrench size={16} />{busy === "migrate" ? "迁移中" : "执行迁移"}</button>
      </section>

      <section className="maintenance-block">
        <div className="maintenance-status-row"><div><h3>错误诊断</h3><p>记录最近的 API 与生成错误，密钥和授权信息会自动脱敏。</p></div><button type="button" className="maintenance-icon-button" aria-label="刷新诊断日志" title="刷新诊断日志" onClick={() => void load()}><ArrowClockwise size={16} /></button></div>
        {diagnostics.length ? (
          <ul className="diagnostic-list">{diagnostics.slice(0, 8).map((entry) => <li key={entry.id}><span>{entry.stage}</span><div><strong>{entry.message}</strong><time>{new Date(entry.timestamp).toLocaleString("zh-CN")}</time></div></li>)}</ul>
        ) : <p className="maintenance-empty">暂无诊断记录</p>}
        <button type="button" className="settings-section-action secondary" onClick={clearLogs} disabled={Boolean(busy) || !diagnostics.length}><Trash size={16} />{busy === "logs" ? "清理中" : "清理日志"}</button>
      </section>
      {message && <p className="settings-section-notice">{message}</p>}
      {error && <p className="settings-section-error">{error}</p>}
    </div>
  );
}
