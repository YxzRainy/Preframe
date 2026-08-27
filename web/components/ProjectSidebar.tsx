"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ChartDonut,
  FileText,
  PaperPlaneTilt,
  VideoCamera,
} from "@phosphor-icons/react";
import type { ResultFile } from "./ResultTabs";
import { StatusBadge } from "./StatusBadge";
import { resolveContentProfile } from "../../src/utils/contentProfile";
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
  const primaryFiles = files.filter((file) => isPrimaryProjectDocument(file.name) && !/_修改版/u.test(file.name));
  const extraFiles = files.filter((file) => !primaryFiles.includes(file));
  const primaryFilesByName = new Map(primaryFiles.map((file) => [file.name, file]));
  const documentsStatus = metadata.documentsStatus && typeof metadata.documentsStatus === "object" ? metadata.documentsStatus as Record<string, { status?: string; documentStatus?: string; validationErrors?: string[] }> : {};
  const totalCoreCount = PROJECT_DOCUMENT_DEFINITIONS.length;
  const completedCoreCount = PROJECT_DOCUMENT_DEFINITIONS.filter((definition) => {
    const docStatus = documentsStatus[definition.number];
    return docStatus?.documentStatus === "generated" || docStatus?.documentStatus === "repaired" || (!docStatus?.documentStatus && docStatus?.status === "completed");
  }).length;
  const projectStatus = metadata.status === "complete" && completedCoreCount === totalCoreCount ? "complete" : completedCoreCount ? "partial" : "failed";

  function failureReason(docStatus: { validationErrors?: string[] } | undefined): string {
    const error = docStatus?.validationErrors?.[0] || "文档未生成";
    if (/模型返回为空/u.test(error)) return "模型返回为空";
    if (/格式异常|解析/u.test(error)) return "模型输出格式异常";
    if (/依赖文档/u.test(error)) return "依赖文档生成失败";
    if (/正文长度|缺少二级标题|缺少一级标题|校验/u.test(error)) return "内容校验未通过";
    return error.length > 18 ? `${error.slice(0, 18)}…` : error;
  }

  const renderFile = (file: ResultFile) => {
    const meta = displayDocumentName(file.name);
    const active = viewMode === "documents" && file.name === activeName;
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
          {meta.revised && <small>修改版本</small>}
        </span>
      </button>
    );
  };

  const renderMissingFile = (definition: (typeof PROJECT_DOCUMENT_DEFINITIONS)[number]) => {
    const docStatus = documentsStatus[definition.number];
    const error = docStatus?.validationErrors?.[0];
    const active = viewMode === "documents" && definition.filename === activeName;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className={active ? "flow-step missing active" : "flow-step missing"}
        onClick={() => {
          if (viewMode !== "documents" && onViewModeChange) {
            onViewModeChange("documents");
          }
          onSelect(definition.filename);
        }}
        title={error || "文档尚未生成"}
        key={definition.filename}
      >
        <span className="step-node">{definition.number}</span>
        <span className="step-copy">
          <strong>{definition.title}</strong>
          <small>{failureReason(docStatus)}</small>
        </span>
        <span className="step-type failed">生成失败</span>
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
            <StatusBadge tone={projectStatus === "complete" ? "ready" : projectStatus === "partial" ? "working" : "muted"}>
              {projectStatus === "complete" ? "已完成" : projectStatus === "partial" ? "部分可用" : "待重试"}
            </StatusBadge>
          </div>
          <h1>{projectName}</h1>
          <p className="project-identity-summary">{contentSubject} · {String(metadata.platform || "平台未记录")}</p>
          <Link
            className="secondary-button project-to-publish"
            href={`/publish?new=1&project=${encodeURIComponent(slug)}`}
            title="带入项目标题与发布文案，跳转到发布中心创建任务"
          >
            <PaperPlaneTilt size={16} weight="fill" />
            发布
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

        <div className="step-flow" role="tablist" aria-label="项目文档步骤">
          {PROJECT_DOCUMENT_DEFINITIONS.map((definition) => primaryFilesByName.get(definition.filename)
            ? renderFile(primaryFilesByName.get(definition.filename)!)
            : renderMissingFile(definition))}
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
      </div>
    </aside>
  );
}
