"use client";

import Link from "next/link";
import { ArrowRight, FilmSlate, Lightbulb, Plus } from "@phosphor-icons/react";
import type { DashboardProject, ProjectStage } from "./types";
import { PROJECT_STAGE_LABELS } from "./types";

interface TodayFocusProps {
  project?: DashboardProject;
  onCreateProject: () => void;
  onRecordIdea: () => void;
}

export function TodayFocus({ project, onCreateProject, onRecordIdea }: TodayFocusProps) {
  if (!project) {
    return (
      <section className="today-focus is-empty" aria-label="开始第一个内容项目">
        <header className="today-focus-head">
          <span className="today-focus-kicker">开始创作</span>
        </header>
        <div className="today-focus-empty">
          <h2 className="today-focus-empty-title">从一个想法开始。</h2>
          <p className="today-focus-empty-sub">输入选题，生成脚本、分镜和拍摄清单。</p>
          <div className="today-focus-empty-actions">
            <button type="button" className="today-focus-primary create-project-entry" onClick={onCreateProject}>
              <Plus size={16} weight="bold" /> 新建项目
            </button>
            <button type="button" className="today-focus-ghost" onClick={onRecordIdea}>
              <Lightbulb size={16} /> 记录灵感
            </button>
          </div>
        </div>
      </section>
    );
  }

  const docPct = project.documentTotal > 0 ? Math.round((project.documentCompleted / project.documentTotal) * 100) : 0;
  const shotPct = project.shotTotal > 0 ? Math.round((project.shotCompleted / project.shotTotal) * 100) : 0;
  const stagePath: ProjectStage[] = ["planning", "ready_to_shoot", "shooting", "editing", "ready_to_publish"];
  const activeStageIndex = Math.max(0, stagePath.indexOf(project.stage));

  return (
    <section className="today-focus has-project" aria-label="今日推进">
      <header className="today-focus-head">
        <span className="today-focus-kicker"><FilmSlate size={14} /> 今日重点</span>
      </header>
      <div className="today-focus-layout">
        <div className="today-focus-body">
          <Link className="today-focus-name" href={`/projects/${encodeURIComponent(project.slug)}`}>{project.name}</Link>
          <p className="today-focus-next">下一步 · {project.nextAction || "继续推进当前阶段"}</p>
          {project.nextActionReason && <p className="today-focus-reason">{project.nextActionReason}</p>}
          <div className="today-focus-progress">
            <div className="today-focus-progress-row">
              <span>策划文档</span>
              <span>{project.documentCompleted}/{project.documentTotal}</span>
            </div>
            <div className="today-focus-bar"><i style={{ width: `${docPct}%` }} /></div>
            {project.shotTotal > 0 && (
              <>
                <div className="today-focus-progress-row">
                  <span>镜头任务</span>
                  <span>{project.shotCompleted}/{project.shotTotal}</span>
                </div>
                <div className="today-focus-bar"><i style={{ width: `${shotPct}%` }} /></div>
              </>
            )}
          </div>
          <div className="today-focus-actions">
            <Link className="today-focus-primary" href={project.nextActionHref || `/projects/${encodeURIComponent(project.slug)}`}>
              {project.nextActionLabel || "继续推进"} <ArrowRight size={16} weight="bold" />
            </Link>
          </div>
        </div>

        <aside className="today-focus-dashboard" aria-label="当前项目流程阶段">
          <div className="today-focus-dashboard-head">
            <span>流程阶段</span>
            <strong>{activeStageIndex + 1}<small> / {stagePath.length}</small></strong>
          </div>
          <ol className="today-focus-stage-path">
            {stagePath.map((stage, index) => (
              <li key={stage} className={index < activeStageIndex ? "is-complete" : index === activeStageIndex ? "is-current" : ""}>
                <i aria-hidden="true" />
                <span>{PROJECT_STAGE_LABELS[stage]}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  );
}
