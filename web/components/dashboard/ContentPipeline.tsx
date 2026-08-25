"use client";

import { FlowArrow } from "@phosphor-icons/react";
import { PROJECT_STAGE_LABELS, PROJECT_STAGE_ORDER, type ProjectStage } from "./types";

interface ContentPipelineProps {
  pipeline: Record<ProjectStage, number>;
  total: number;
  onSelectStage?: (stage: ProjectStage) => void;
  activeStage?: ProjectStage | null;
}

export function ContentPipeline({ pipeline, total, onSelectStage, activeStage }: ContentPipelineProps) {
  const stages: Array<{ stage: ProjectStage; count: number }> = PROJECT_STAGE_ORDER.map((stage) => ({
    stage,
    count: pipeline[stage] || 0,
  }));

  return (
    <section className="pipeline-panel" aria-label="内容管线">
      <header className="pipeline-head">
        <div><span className="panel-kicker"><FlowArrow size={15} /> FLOW</span><h2>内容轨道</h2></div>
        <span className="pipeline-total">{total ? `${total} 个项目` : "等待启程"}</span>
      </header>
      <div className={`pipeline-grid ${total === 0 ? "is-empty" : ""}`}>
        {stages.map(({ stage, count }) => {
          const active = activeStage === stage;
          const clickable = count > 0;
          return (
            <button
              key={stage}
              type="button"
              className={`pipeline-cell ${active ? "active" : ""} ${clickable ? "clickable" : "empty"}`}
              disabled={!clickable}
              onClick={() => clickable && onSelectStage?.(stage)}
            >
              <span className="pipeline-marker"><i />{count > 0 && <b>{count}</b>}</span>
              <span className="pipeline-label">{PROJECT_STAGE_LABELS[stage]}</span>
            </button>
          );
        })}
      </div>
      {total === 0 && <p className="pipeline-empty-copy">创建项目后，它会沿着这条轨道从灵感走向发布。</p>}
    </section>
  );
}
