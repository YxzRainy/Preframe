"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, FolderOpen } from "@phosphor-icons/react";
import type { DashboardProject } from "./types";
import { PROJECT_STAGE_LABELS, formatRelativeTime } from "./types";

interface CurrentProjectsProps {
  projects: DashboardProject[];
}

function progressPct(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
}

export function CurrentProjects({ projects }: CurrentProjectsProps) {
  if (!projects.length) {
    return (
      <section className="current-projects" aria-label="我的项目">
        <header className="current-projects-head"><h2>最近项目</h2></header>
        <div className="current-projects-empty">
          <span><FolderOpen size={22} /></span>
          <div><strong>还没有项目</strong><small>从上方或侧栏开始创建，最近进展会显示在这里。</small></div>
        </div>
      </section>
    );
  }

  const top = projects.slice(0, 3);

  return (
    <section className="current-projects" aria-label="我的项目">
      <header className="current-projects-head">
        <h2>最近项目</h2>
        <Link className="current-projects-more" href="/projects">查看全部 <ArrowUpRight size={14} /></Link>
      </header>
      <div className="current-projects-list">
        {top.map((project) => {
          const docPct = progressPct(project.documentCompleted, project.documentTotal);
          const shotPct = progressPct(project.shotCompleted, project.shotTotal);
          return (
            <article key={project.slug} className="current-project-card">
              <div className="current-project-copy">
                <div className="current-project-head">
                  <Link className="current-project-name" href={`/projects/${encodeURIComponent(project.slug)}`}>{project.name}</Link>
                  <span className="current-project-stage">{PROJECT_STAGE_LABELS[project.stage]}</span>
                </div>
                <div className="current-project-platform">{project.platform} · {formatRelativeTime(project.updatedAt)}更新</div>
              </div>
              <div className="current-project-metrics">
                <div className="current-project-metric">
                  <span>文档 {project.documentCompleted}/{project.documentTotal}</span>
                  <div className="current-project-bar"><i style={{ width: `${docPct}%` }} /></div>
                </div>
                <div className="current-project-metric">
                  <span>镜头 {project.shotCompleted}/{project.shotTotal}</span>
                  <div className="current-project-bar"><i style={{ width: `${shotPct}%` }} /></div>
                </div>
              </div>
              <Link className="current-project-action" href={`/projects/${encodeURIComponent(project.slug)}`} aria-label={`打开${project.name}`}><ArrowRight size={16} /></Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}
