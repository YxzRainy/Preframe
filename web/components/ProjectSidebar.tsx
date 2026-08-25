"use client";

import Link from "next/link";
import {
  ArrowLeft,
  CaretDown,
  ChartDonut,
  CheckCircle,
  FileText,
  PaperPlaneTilt,
  VideoCamera,
} from "@phosphor-icons/react";
import type { ResultFile } from "./ResultTabs";
import { StatusBadge } from "./StatusBadge";
import { resolveContentProfile } from "../../src/utils/contentProfile";
import { formatModelLabel } from "../../src/utils/modelLabel";
import { displayDocumentName, isPrimaryProjectDocument, PROJECT_DOCUMENT_DEFINITIONS } from "../../src/utils/documentDefinitions";

type ProjectViewMode = "documents" | "execution" | "overview";

interface ProjectSidebarProps {
  slug: string;
  projectName: string;
  metadata: Record<string, unknown>;
  files: ResultFile[];
  activeName: string;
  onSelect: (name: string) => void;
  viewMode?: ProjectViewMode;
  onViewModeChange?: (mode: ProjectViewMode) => void;
}

export function ProjectSidebar({
  slug,
  projectName,
  metadata,
  files,
  activeName,
  onSelect,
  viewMode = "documents",
  onViewModeChange,
}: ProjectSidebarProps) {
  const profile = resolveContentProfile(metadata);
  const contentSubject = profile.contentSubject || "未记录";
  const contentDomain = profile.contentDomain || "未记录";
  const generationDurationLabel = typeof metadata.generationDurationLabel === "string" && metadata.generationDurationLabel.trim()
    ? metadata.generationDurationLabel.trim()
    : "";
  const primaryFiles = files.filter((file) => isPrimaryProjectDocument(file.name) && !/_修改版/u.test(file.name));
  const extraFiles = files.filter((file) => !primaryFiles.includes(file));
  const documentsStatus = metadata.documentsStatus && typeof metadata.documentsStatus === "object" ? metadata.documentsStatus as Record<string, { status?: string; documentStatus?: string }> : {};
  const completedCoreCount = PROJECT_DOCUMENT_DEFINITIONS.filter((definition) => {
    const docStatus = documentsStatus[definition.number];
    return docStatus?.documentStatus === "generated" || docStatus?.documentStatus === "repaired" || (!docStatus?.documentStatus && docStatus?.status === "completed");
  }).length;
  const totalCoreCount = PROJECT_DOCUMENT_DEFINITIONS.length;
  const projectStatus = metadata.status === "complete" ? "complete" : completedCoreCount ? "partial" : "failed";
  const progressWidth = `${Math.min(100, Math.round((completedCoreCount / totalCoreCount) * 100))}%`;

  function documentStatusLabel(docStatus: { status?: string; documentStatus?: string } | undefined, revised: boolean): string {
    if (revised) return "修改版本";
    switch (docStatus?.documentStatus) {
      case "generated": return "已生成";
      case "repaired": return "已修复";
      case "fallback": return "备用内容";
      case "failed": return "生成失败";
      default: return docStatus?.status === "completed" ? "已生成" : "校验失败";
    }
  }

  function documentStatusClass(docStatus: { status?: string; documentStatus?: string } | undefined, revised: boolean): string {
    if (revised) return "step-type revised";
    switch (docStatus?.documentStatus) {
      case "generated": return "step-type";
      case "repaired": return "step-type repaired";
      case "fallback": return "step-type fallback";
      case "failed": return "step-type failed";
      default: return docStatus?.status === "completed" ? "step-type" : "step-type failed";
    }
  }

  const renderFile = (file: ResultFile) => {
    const meta = displayDocumentName(file.name);
    const active = viewMode === "documents" && file.name === activeName;
    const docStatus = documentsStatus[meta.number];
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className={active ? "flow-step active" : "flow-step"}
        onClick={() => {
          if (viewMode !== "documents" && onViewModeChange) {
            onViewModeChange("documents");
          }
          onSelect(file.name);
        }}
        key={file.name}
      >
        <span className="step-node">{meta.number}</span>
        <span className="step-copy">
          <strong>{meta.title}</strong>
          <small>{meta.revised ? "修改版本" : "Markdown 文档"}</small>
        </span>
        <span className={documentStatusClass(docStatus, meta.revised)}>
          {documentStatusLabel(docStatus, meta.revised)}
        </span>
      </button>
    );
  };

  return (
    <aside className="pipeline-sidebar">
      <div className="pipeline-sidebar-inner">
        <Link className="project-sidebar-back" href="/projects">
          <ArrowLeft size={15} weight="bold" />
          返回项目库
        </Link>
        <section className="project-identity-card">
          <div className="project-card-head">
            <span>当前项目</span>
            <StatusBadge tone={projectStatus === "complete" ? "ready" : projectStatus === "partial" ? "working" : "muted"}>
              {projectStatus === "complete" ? "已完成" : projectStatus === "partial" ? "部分可用" : "生成失败"}
            </StatusBadge>
          </div>
          <h1>{projectName}</h1>
          <p className="project-identity-summary">{contentSubject} · {String(metadata.platform || "平台未记录")}</p>
          <div className="project-progress"><i style={{ width: progressWidth }} /></div>
          <div className="project-progress-copy"><span>核心策划文档</span><b>{completedCoreCount} / {totalCoreCount}</b></div>
          <details className="project-meta-disclosure">
            <summary>项目参数 <CaretDown size={13} weight="bold" /></summary>
            <div className="project-meta-chips">
              <div><small>主体</small><span>{contentSubject}</span></div>
              <div><small>领域</small><span>{contentDomain}</span></div>
              <div><small>平台</small><span>{String(metadata.platform || "未记录")}</span></div>
              <div><small>风格</small><span>{String(metadata.style || "未记录")}</span></div>
              <div><small>模型</small><span>{metadata.model ? formatModelLabel(String(metadata.model)) : "未记录"}</span></div>
              {generationDurationLabel && <div><small>生成耗时</small><span>{generationDurationLabel}</span></div>}
            </div>
          </details>
          <Link
            className="secondary-button project-to-publish"
            href={`/publish?new=1&project=${encodeURIComponent(slug)}`}
            title="带入项目标题与发布文案，跳转到发布中心创建任务"
          >
            <PaperPlaneTilt size={16} weight="fill" />
            添加到发布中心
          </Link>
        </section>

        {/* 视图模式平级切换 */}
        {onViewModeChange && (
          <div className="workspace-view-switcher">
            <button
              type="button"
              className={viewMode === "documents" ? "switcher-btn active" : "switcher-btn"}
              onClick={() => onViewModeChange("documents")}
            >
              <FileText size={17} weight={viewMode === "documents" ? "fill" : "regular"} />
              <span>策划文档</span>
            </button>
            <button
              type="button"
              className={viewMode === "execution" ? "switcher-btn active" : "switcher-btn"}
              onClick={() => onViewModeChange("execution")}
            >
              <VideoCamera size={17} weight={viewMode === "execution" ? "fill" : "regular"} />
              <span>拍摄执行</span>
            </button>
            <button
              type="button"
              className={viewMode === "overview" ? "switcher-btn active" : "switcher-btn"}
              onClick={() => onViewModeChange("overview")}
            >
              <ChartDonut size={17} weight={viewMode === "overview" ? "fill" : "regular"} />
              <span>阶段与发布</span>
            </button>
          </div>
        )}

        <div className="pipeline-title">
          <div><span className="section-index">步骤 01</span><h2>项目任务流</h2></div>
          <span className="pipeline-count">{completedCoreCount} 份核心文档</span>
        </div>
        <div className="step-flow" role="tablist" aria-label="项目文档步骤">
          {primaryFiles.map(renderFile)}
        </div>
        {extraFiles.length > 0 && (
          <>
            <div className="pipeline-title secondary">
              <div><h2>附加文件</h2></div>
              <span className="pipeline-count">{extraFiles.length}</span>
            </div>
            <div className="step-flow extras" role="tablist" aria-label="附加项目文件">
              {extraFiles.map(renderFile)}
            </div>
          </>
        )}
        <div className="sidebar-bottom-actions">
          <div className="sidebar-footnote">
            <CheckCircle size={14} weight="fill" />本地文件同步正常
          </div>
        </div>
      </div>
    </aside>
  );
}
