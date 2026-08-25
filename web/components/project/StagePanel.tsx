"use client";

import { useEffect, useState } from "react";
import { readJsonResponse } from "../../lib/readJsonResponse";

export type ProjectStage =
  | "idea" | "planning" | "ready_to_shoot" | "shooting"
  | "editing" | "ready_to_publish" | "published" | "archived";

export const STAGE_OPTIONS: Array<{ value: ProjectStage; label: string }> = [
  { value: "idea", label: "灵感" },
  { value: "planning", label: "策划中" },
  { value: "ready_to_shoot", label: "待拍摄" },
  { value: "shooting", label: "拍摄中" },
  { value: "editing", label: "剪辑中" },
  { value: "ready_to_publish", label: "待发布" },
  { value: "published", label: "已发布" },
  { value: "archived", label: "已归档" },
];

interface StagePanelProps {
  slug: string;
}

interface CockpitMetric {
  completed?: number;
  ready?: number;
  total?: number;
  label: string;
  tone: "ready" | "warning" | "muted";
}

interface CockpitData {
  stage: { stage: ProjectStage; stageUpdatedAt: string; nextAction?: string };
  nextAction: string;
  documents: CockpitMetric;
  shots: CockpitMetric;
  assets: CockpitMetric & { suggested: number; missing: number; healthIssues: number; reshoot: number };
  publishing: { label: string; detail: string; tone: "ready" | "warning" | "muted" };
}

export function StagePanel({ slug }: StagePanelProps) {
  const [stage, setStage] = useState<ProjectStage | null>(null);
  const [stageUpdatedAt, setStageUpdatedAt] = useState<string>("");
  const [nextAction, setNextAction] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [overview, setOverview] = useState<CockpitData | null>(null);

  async function loadOverview() {
    const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/overview`, { cache: "no-store" });
    const data = await readJsonResponse<{ overview?: CockpitData; error?: string }>(res);
    if (!res.ok || !data.overview) throw new Error(data.error || "项目概览读取失败。");
    setOverview(data.overview);
    setStage(data.overview.stage.stage);
    setStageUpdatedAt(data.overview.stage.stageUpdatedAt);
    setNextAction(data.overview.stage.nextAction || data.overview.nextAction);
  }

  useEffect(() => {
    let active = true;
    loadOverview()
      .then(() => { if (!active) return; })
      .catch((e) => active && setError(e instanceof Error ? e.message : "阶段读取失败。"));
    return () => { active = false; };
  }, [slug]);

  async function save() {
    if (!stage) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage, nextAction }),
      });
      const data = await readJsonResponse<{ stage?: { stageUpdatedAt: string }; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "阶段保存失败。");
      if (data.stage?.stageUpdatedAt) setStageUpdatedAt(data.stage.stageUpdatedAt);
      await loadOverview();
      setNotice("阶段已更新。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "阶段保存失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="stage-panel" aria-label="项目阶段">
      <header className="cockpit-header">
        <div><span>项目驾驶舱</span><h3>{STAGE_OPTIONS.find((item) => item.value === stage)?.label || "读取中"}</h3></div>
        <p>{overview?.nextAction || nextAction || "正在整理下一步行动"}</p>
      </header>
      {overview && (
        <div className="cockpit-metrics" aria-label="项目完成度">
          <Metric label="策划文档" value={`${overview.documents.completed ?? 0}/${overview.documents.total ?? 0}`} metric={overview.documents} />
          <Metric label="镜头任务" value={`${overview.shots.completed ?? 0}/${overview.shots.total ?? 0}`} metric={overview.shots} />
          <Metric label="素材匹配" value={`${overview.assets.ready ?? 0}/${overview.assets.total ?? 0}`} metric={overview.assets} />
          <div className={`cockpit-metric tone-${overview.publishing.tone}`}><span>发布准备</span><strong>{overview.publishing.label}</strong><small>{overview.publishing.detail}</small></div>
        </div>
      )}
      <div className="stage-panel-body">
        <label>
          <span>当前阶段</span>
          <select value={stage || "idea"} onChange={(e) => setStage(e.target.value as ProjectStage)}>
            {STAGE_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
          </select>
        </label>
        <label>
          <span>下一步动作</span>
          <textarea rows={2} value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="例如：确认选题后生成策划文档" />
        </label>
        {stageUpdatedAt && <p className="stage-updated">阶段更新于 {new Date(stageUpdatedAt).toLocaleString("zh-CN")}</p>}
        <div className="stage-actions">
          <button type="button" className="primary-button" onClick={save} disabled={saving || !stage}>
            {saving ? "保存中…" : "保存阶段"}
          </button>
        </div>
        {error && <p className="stage-error">{error}</p>}
        {notice && <p className="stage-notice">{notice}</p>}
      </div>
    </section>
  );
}

function Metric({ label, value, metric }: { label: string; value: string; metric: CockpitMetric }) {
  return <div className={`cockpit-metric tone-${metric.tone}`}><span>{label}</span><strong>{value}</strong><small>{metric.label}</small></div>;
}
