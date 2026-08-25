"use client";

import Link from "next/link";
import type { DashboardProject } from "./types";
import { PROJECT_STAGE_LABELS, formatRelativeTime } from "./types";

interface RecentProjectsProps {
  projects: DashboardProject[];
  limit?: number;
}

export function RecentProjects({ projects, limit = 8 }: RecentProjectsProps) {
  const list = projects.slice(0, limit);
  return (
    <section className="recent-projects" aria-label="最近项目">
      <header className="recent-projects-head">
        <h2>最近项目</h2>
        <Link className="recent-projects-more" href="/projects">查看全部</Link>
      </header>
      {list.length === 0 ? (
        <div className="recent-projects-empty">还没有项目，先创建一个内容项目试试。</div>
      ) : (
        <ul className="recent-projects-list">
          {list.map((project) => {
            const docPct = project.documentTotal > 0 ? Math.round((project.documentCompleted / project.documentTotal) * 100) : 0;
            return (
              <li key={project.slug} className="recent-project-row">
                <Link className="recent-project-main" href={`/projects/${encodeURIComponent(project.slug)}`}>
                  <span className="recent-project-name">{project.name}</span>
                  <span className="recent-project-platform">{project.platform}</span>
                </Link>
                <span className="recent-project-stage">{PROJECT_STAGE_LABELS[project.stage]}</span>
                <span className="recent-project-doc">文档 {docPct}%</span>
                <span className="recent-project-shot">镜头 {project.shotCompleted}/{project.shotTotal}</span>
                <span className="recent-project-updated">{formatRelativeTime(project.updatedAt)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
