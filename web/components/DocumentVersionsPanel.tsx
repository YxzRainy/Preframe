"use client";

import { useEffect, useState } from "react";
import { ArrowsClockwise, ClockCounterClockwise, GitDiff } from "@phosphor-icons/react";
import { readJsonResponse } from "../lib/readJsonResponse";

interface VersionSummary {
  id: string;
  createdAt: string;
  reason: "generated" | "regenerate" | "refine-source" | "refine-result" | "rollback";
  current?: boolean;
  size: number;
}

const REASON_LABELS: Record<VersionSummary["reason"], string> = {
  generated: "当前版本",
  regenerate: "重新生成前",
  "refine-source": "AI 修改前",
  "refine-result": "AI 修改结果",
  rollback: "回滚前",
};

export function DocumentVersionsPanel({
  slug,
  fileName,
  retrying,
  onRetry,
  onChanged,
}: {
  slug: string;
  fileName: string;
  retrying: boolean;
  onRetry: () => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [diff, setDiff] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canonical = /^\d{2}_.+\.md$/u.test(fileName) && !/_修改版/u.test(fileName);

  async function load() {
    if (!fileName) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/versions?fileName=${encodeURIComponent(fileName)}`, { cache: "no-store" });
      const data = await readJsonResponse<{ versions?: VersionSummary[]; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "版本读取失败。");
      setVersions(data.versions || []);
      setSelected((current) => (data.versions || []).some((version) => version.id === current && current !== "current") ? current : data.versions?.find((version) => !version.current)?.id || "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "版本读取失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setDiff("");
    setSelected("");
    load().catch(() => undefined);
  }, [fileName, slug]);

  async function compare() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({ fileName, from: selected, to: "current" });
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/versions?${query.toString()}`, { cache: "no-store" });
      const data = await readJsonResponse<{ diff?: string; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "差异读取失败。");
      setDiff(data.diff || "两版内容一致。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "差异读取失败。");
    } finally {
      setBusy(false);
    }
  }

  async function rollback() {
    if (!selected || !window.confirm("回滚到所选版本？当前内容会先自动归档。")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, versionId: selected }),
      });
      const data = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "版本回滚失败。");
      setDiff("");
      await onChanged();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "版本回滚失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="project-tool-details version-details">
      <summary><span>版本与恢复</span><small>{Math.max(0, versions.length - 1)} 个历史版本</small></summary>
      <div className="version-toolbar">
        {canonical && (
          <button type="button" className="agent-action secondary" disabled={retrying || busy} onClick={() => onRetry().then(load)}>
            <ArrowsClockwise size={15} weight="bold" />{retrying ? "重试中" : "重新生成当前文档"}
          </button>
        )}
        <label className="command-field">
          <span>历史版本</span>
          <select value={selected} disabled={loading || versions.length < 2} onChange={(event) => { setSelected(event.target.value); setDiff(""); }}>
            <option value="">{loading ? "读取中…" : "选择一个版本"}</option>
            {versions.filter((version) => !version.current).map((version) => (
              <option key={version.id} value={version.id}>
                {REASON_LABELS[version.reason]} · {new Date(version.createdAt).toLocaleString("zh-CN")}
              </option>
            ))}
          </select>
        </label>
        <div className="version-actions">
          <button type="button" disabled={!selected || busy} onClick={compare}><GitDiff size={15} />查看差异</button>
          <button type="button" disabled={!selected || busy} onClick={rollback}><ClockCounterClockwise size={15} />回滚</button>
        </div>
      </div>
      {diff && <pre className="version-diff" aria-label="版本差异">{diff}</pre>}
      {error && <p className="stage-error">{error}</p>}
    </details>
  );
}
