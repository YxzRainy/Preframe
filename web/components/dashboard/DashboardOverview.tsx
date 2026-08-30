"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle,
  ClipboardText,
  FilmSlate,
  PlayCircle,
} from "@phosphor-icons/react";

import {
  PROJECT_STAGE_LABELS,
  type DashboardData,
  type DashboardProject,
  type ProjectStage,
} from "./types";

type ActiveStage = Exclude<ProjectStage, "idea" | "archived">;

const ACTIVE_STAGES: ActiveStage[] = [
  "planning",
  "ready_to_shoot",
  "shooting",
  "editing",
  "ready_to_publish",
];

const STAGE_SHORT_LABELS: Record<ActiveStage, string> = {
  planning: "策划中",
  ready_to_shoot: "待拍摄",
  shooting: "拍摄中",
  editing: "剪辑中",
  ready_to_publish: "待发布",
};

type QueueFilter = "all" | (typeof ACTIVE_STAGES)[number];

interface DashboardOverviewProps {
  data: DashboardData;
}

function projectHref(project: DashboardProject) {
  return project.nextActionHref || `/projects/${encodeURIComponent(project.slug)}`;
}

function projectProgress(project: DashboardProject) {
  const total = project.documentTotal + project.shotTotal;
  const completed = project.documentCompleted + project.shotCompleted;
  return total > 0 ? Math.round((completed / total) * 100) : 0;
}

function resolveProjectAction(project: DashboardProject) {
  if (project.nextAction) return project.nextAction;
  if (project.documentCompleted < project.documentTotal) {
    return `补全 ${project.documentTotal - project.documentCompleted} 份策划文档`;
  }
  if (project.shotTotal > project.shotCompleted) {
    return `完成 ${project.shotTotal - project.shotCompleted} 个镜头任务`;
  }
  return project.stage === "ready_to_publish" ? "核对发布物料" : "继续推进当前阶段";
}

export function DashboardOverview({ data }: DashboardOverviewProps) {
  const [filter, setFilter] = useState<QueueFilter>("all");

  const activeProjects = useMemo(
    () => data.projects.filter((project) => project.stage !== "archived"),
    [data.projects],
  );
  const queue = useMemo(() => {
    const visible = filter === "all"
      ? activeProjects
      : activeProjects.filter((project) => project.stage === filter);
    const priority = { blocking: 0, high: 1, normal: 2 } as const;
    return [...visible].sort((left, right) => {
      const byPriority = priority[left.nextActionPriority || "normal"] - priority[right.nextActionPriority || "normal"];
      return byPriority || Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    }).slice(0, 4);
  }, [activeProjects, filter]);

  const incompleteDocuments = activeProjects.reduce(
    (total, project) => total + Math.max(0, project.documentTotal - project.documentCompleted),
    0,
  );
  const incompleteShots = activeProjects.reduce(
    (total, project) => total + Math.max(0, project.shotTotal - project.shotCompleted),
    0,
  );
  const projectReadyToShoot = data.pipeline.ready_to_shoot + data.pipeline.shooting;

  return (
    <section className="dashboard-overview" aria-label="工作台概览">
      <div className="dashboard-overview-topline">
        <div>
          <h2>处理中的项目</h2>
        </div>
        <Link className="dashboard-text-link" href="/projects">
          查看项目库 <ArrowRight size={14} weight="bold" />
        </Link>
      </div>

      <div className="dashboard-overview-grid">
        <section className="dashboard-stage-card" aria-label="项目阶段">
          <div className="dashboard-card-heading">
            <div>
              <FilmSlate size={17} weight="duotone" />
              <h3>按阶段筛选</h3>
            </div>
            <span>{activeProjects.length} 个项目</span>
          </div>
          <div className="dashboard-stage-list" role="group" aria-label="按项目阶段筛选推进队列">
            <button
              type="button"
              className={filter === "all" ? "is-active" : ""}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              <span>全部</span>
              <strong>{activeProjects.length}</strong>
            </button>
            {ACTIVE_STAGES.map((stage) => (
              <button
                type="button"
                key={stage}
                className={filter === stage ? "is-active" : ""}
                aria-pressed={filter === stage}
                onClick={() => setFilter(stage)}
              >
                <span>{STAGE_SHORT_LABELS[stage]}</span>
                <strong>{data.pipeline[stage]}</strong>
              </button>
            ))}
          </div>
          <p className="dashboard-stage-caption">
            选择阶段，筛选下方队列。
          </p>
        </section>

        <section className="dashboard-workload-card" aria-label="待处理事项">
          <div className="dashboard-card-heading">
            <div>
              <ClipboardText size={17} weight="duotone" />
              <h3>待处理</h3>
            </div>
            <span>当前项目</span>
          </div>
          <div className="dashboard-workload-stats">
            <div>
              <strong>{incompleteDocuments}</strong>
              <span>份文档未完成</span>
            </div>
            <div>
              <strong>{incompleteShots}</strong>
              <span>个镜头未完成</span>
            </div>
            <div>
              <strong>{projectReadyToShoot}</strong>
              <span>个待拍摄项目</span>
            </div>
          </div>
          <Link className="dashboard-workload-link" href="/projects">
            去项目库排优先级 <ArrowRight size={14} weight="bold" />
          </Link>
        </section>
      </div>

      <section className="dashboard-queue" aria-label="推进队列">
        <div className="dashboard-card-heading dashboard-queue-heading">
          <div>
            <PlayCircle size={18} weight="duotone" />
            <h3>{filter === "all" ? "推进队列" : `${PROJECT_STAGE_LABELS[filter]}中的项目`}</h3>
          </div>
          <span>{queue.length ? "按最近更新排序" : "暂时没有项目"}</span>
        </div>

        {queue.length > 0 ? (
          <div className="dashboard-queue-list">
            {queue.map((project) => {
              const progress = projectProgress(project);
              return (
                <Link className="dashboard-queue-item" href={projectHref(project)} key={project.slug}>
                  <span className={`dashboard-queue-stage stage-${project.stage}`}>{PROJECT_STAGE_LABELS[project.stage]}</span>
                  <div className="dashboard-queue-copy">
                    <strong>{project.name}</strong>
                    <span>{resolveProjectAction(project)}</span>
                  </div>
                  <div className="dashboard-queue-progress" aria-label={`整体完成度 ${progress}%`}>
                    <span>{progress}% 完成</span>
                    <i><b style={{ width: `${progress}%` }} /></i>
                  </div>
                  <ArrowRight className="dashboard-queue-arrow" size={17} weight="bold" aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="dashboard-queue-empty">
            <CheckCircle size={18} weight="duotone" />
            <span>这个阶段暂时没有项目。可以切换筛选，或新建一个内容项目。</span>
          </div>
        )}

      </section>
    </section>
  );
}
