"use client";

import type { ResultFile } from "./ResultTabs";
import { StatusBadge } from "./StatusBadge";
import { resolveContentProfile } from "../../src/utils/contentProfile";
import { formatModelLabel } from "../../src/utils/modelLabel";
import { displayDocumentName, isPrimaryProjectDocument, PROJECT_DOCUMENT_DEFINITIONS } from "../../src/utils/documentDefinitions";

interface ProjectSidebarProps {
  projectName: string;
  metadata: Record<string, unknown>;
  files: ResultFile[];
  activeName: string;
  onSelect: (name: string) => void;
}

export function ProjectSidebar({ projectName, metadata, files, activeName, onSelect }: ProjectSidebarProps) {
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
    // fallback/failed 不计入完成数
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
    const active = file.name === activeName;
    const docStatus = documentsStatus[meta.number];
    return (
      <button type="button" role="tab" aria-selected={active} className={active ? "flow-step active" : "flow-step"} onClick={() => onSelect(file.name)} key={file.name}>
        <span className="step-node">{meta.number}</span>
        <span className="step-copy"><strong>{meta.title}</strong><small>{meta.revised ? "修改版本" : "Markdown 文档"}</small></span>
        <span className={documentStatusClass(docStatus, meta.revised)}>{documentStatusLabel(docStatus, meta.revised)}</span>
      </button>
    );
  };
  return (
    <aside className="pipeline-sidebar">
      <div className="pipeline-sidebar-inner">
        <section className="project-identity-card">
          <div className="project-card-head"><span>当前项目</span><StatusBadge tone={projectStatus === "complete" ? "ready" : projectStatus === "partial" ? "working" : "muted"}>{projectStatus === "complete" ? "已完成" : projectStatus === "partial" ? "部分可用" : "生成失败"}</StatusBadge></div>
          <h1>{projectName}</h1>
          <div className="project-meta-chips">
            <div><small>主体</small><span>{contentSubject}</span></div>
            <div><small>领域</small><span>{contentDomain}</span></div>
            <div><small>平台</small><span>{String(metadata.platform || "未记录")}</span></div>
            <div><small>风格</small><span>{String(metadata.style || "未记录")}</span></div>
            <div><small>模型</small><span>{metadata.model ? formatModelLabel(String(metadata.model)) : "未记录"}</span></div>
            {generationDurationLabel && <div><small>生成耗时</small><span>{generationDurationLabel}</span></div>}
          </div>
          <div className="project-progress"><i style={{ width: progressWidth }} /></div>
          <div className="project-progress-copy"><span>核心策划文档</span><b>{completedCoreCount} / {totalCoreCount}</b></div>
        </section>

        <div className="pipeline-title">
          <div><span className="section-index">步骤 01</span><h2>项目任务流</h2></div>
          <span className="pipeline-count">{completedCoreCount} 份核心文档</span>
        </div>
        <div className="step-flow" role="tablist" aria-label="项目文档步骤">
          {primaryFiles.map(renderFile)}
        </div>
        {extraFiles.length > 0 && <><div className="pipeline-title secondary"><div><h2>附加文件</h2></div><span className="pipeline-count">{extraFiles.length}</span></div><div className="step-flow extras" role="tablist" aria-label="附加项目文件">{extraFiles.map(renderFile)}</div></>}
        <div className="sidebar-bottom-actions"><div className="sidebar-footnote"><span className="pulse-dot" />本地文件同步正常</div></div>
      </div>
    </aside>
  );
}
