"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import { AgentToolsPanel, type CoverSummary } from "./AgentToolsPanel";
import { DocumentWorkspace } from "./DocumentWorkspace";
import { ProjectSidebar } from "./ProjectSidebar";
import { ShotExecutionWorkspace } from "./ShotExecutionWorkspace";
import { StagePanel } from "./project/StagePanel";
import { StatusBadge } from "./StatusBadge";
import { DocumentVersionsPanel } from "./DocumentVersionsPanel";
import { ProjectBasisPanel } from "./ProjectBasisPanel";
import { initialMigrationProgress, MigrationProgressModal, type MigrationProgressView } from "./MigrationProgressModal";
import type { ResultFile } from "./ResultTabs";
import { isPrimaryProjectDocument, isVisualPromptDocument, PROJECT_DOCUMENT_DEFINITIONS } from "../../src/utils/documentDefinitions";
import { readJsonResponse } from "../lib/readJsonResponse";
import { promptForModelConfig } from "../lib/modelConfigClient";

interface ProjectDetail {
  slug: string;
  name: string;
  metadata: Record<string, unknown>;
  files: ResultFile[];
  covers: CoverSummary[];
}

function markdownSection(content: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\n)(?:#{2,6}\\s+|\\*\\*)${escaped}(?:\\*\\*)?\\s*([\\s\\S]*?)(?=\\n(?:#{2,6}\\s+|\\*\\*)|$)`, "m");
  return pattern.exec(content)?.[1]?.trim() ?? "";
}

function defaultCoverPrompt(content: string, useWholeDocument = false): string {
  const visual = markdownSection(content, "封面视觉提示词") || markdownSection(content, "视觉提示词");
  const negative = markdownSection(content, "负面提示词");
  const source = visual || (useWholeDocument ? content : "");
  const cleanedVisual = source.replace(/[—-]{2}ar\s+\d+\s*:\s*\d+(?:\s+--(?:v|style)\s+\S+)*/gi, "").trim();
  return negative && cleanedVisual ? `${cleanedVisual}\n\n负面提示词：${negative}` : cleanedVisual;
}

function detailProjectStatus(fileCount: number, total: number): string {
  if (fileCount === total) return `已打开项目 · ${total}/${total} 已完成`;
  return `已打开项目 · ${fileCount}/${total} 可用`;
}

type ProjectViewMode = "documents" | "execution" | "overview" | "visual" | "risk";
type DocumentStatusView = { generated?: boolean; status?: string; documentStatus?: string; validationErrors?: string[] };
type MigrationResult = { migrated?: boolean; status?: string; archivedFiles?: string[]; error?: string; errorCode?: string };
type MigrationRequestError = Error & { errorCode?: string };

function migrationRequestError(message: string, errorCode?: string): MigrationRequestError {
  const error = new Error(message) as MigrationRequestError;
  error.errorCode = errorCode;
  return error;
}

async function readMigrationProgress(response: Response, onProgress: (progress: MigrationProgressView) => void): Promise<MigrationResult> {
  if (!response.body) throw migrationRequestError("迁移连接未返回进度数据。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: MigrationResult | undefined;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const records = buffer.split("\n\n");
    buffer = records.pop() || "";
    for (const record of records) {
      const event = record.match(/^event:\s*(.+)$/m)?.[1]?.trim() || "message";
      const data = record.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      if (!data) continue;
      let payload: unknown;
      try { payload = JSON.parse(data); } catch { continue; }
      if (event === "progress") onProgress(payload as MigrationProgressView);
      if (event === "complete") result = payload as MigrationResult;
      if (event === "error") {
        const error = payload as { error?: unknown; errorCode?: unknown };
        throw migrationRequestError(typeof error.error === "string" ? error.error : "项目迁移失败。", typeof error.errorCode === "string" ? error.errorCode : undefined);
      }
    }
    if (done) break;
  }
  if (!result) throw migrationRequestError("迁移进度意外中断，请刷新项目确认当前状态。");
  return result;
}

function ProjectLoadingIndicator() {
  return (
    <svg className="project-ring-loader" width="240" height="240" viewBox="0 0 240 240" aria-hidden="true">
      <circle className="project-ring-loader__ring project-ring-loader__ring--a" cx="120" cy="120" r="105" fill="none" strokeWidth="20" strokeDasharray="0 660" strokeDashoffset="-330" strokeLinecap="round" />
      <circle className="project-ring-loader__ring project-ring-loader__ring--b" cx="120" cy="120" r="35" fill="none" strokeWidth="20" strokeDasharray="0 220" strokeDashoffset="-110" strokeLinecap="round" />
      <circle className="project-ring-loader__ring project-ring-loader__ring--c" cx="85" cy="120" r="70" fill="none" strokeWidth="20" strokeDasharray="0 440" strokeLinecap="round" />
      <circle className="project-ring-loader__ring project-ring-loader__ring--d" cx="155" cy="120" r="70" fill="none" strokeWidth="20" strokeDasharray="0 440" strokeLinecap="round" />
    </svg>
  );
}

function FailedDocumentTools({
  fileName,
  reasons,
  retrying,
  onRetry,
}: {
  fileName: string;
  reasons: string[];
  retrying: boolean;
  onRetry: () => void;
}) {
  const dependencyFailure = reasons.some((reason) => reason.includes("依赖文档"));
  return (
    <aside className="agent-panel document-recovery-panel">
      <header className="agent-panel-header">
        <div><span className="section-index">恢复</span><h2>文档恢复</h2><p>查看原因并重新生成失败项</p></div>
        <StatusBadge tone="warning">待处理</StatusBadge>
      </header>
      <div className="document-recovery-body">
        <span className="document-recovery-icon"><WarningCircle size={22} weight="fill" /></span>
        <p className="document-recovery-label">当前失败文档</p>
        <strong>{fileName}</strong>
        <div className="document-recovery-copy">
          {reasons.map((reason) => <p key={reason}>{reason}</p>)}
        </div>
        <button className="agent-action primary" type="button" disabled={retrying} onClick={onRetry}>
          <ArrowClockwise size={16} weight="bold" />{retrying ? "正在重新生成" : dependencyFailure ? "修复依赖并重新生成" : "重新生成当前文档"}
        </button>
        <small>{dependencyFailure ? "系统会先生成缺失的上游文档，再继续当前文档。" : "不会覆盖其他已完成文档。"}</small>
      </div>
      <footer className="agent-panel-footer"><span>本地工作区</span><span>失败项可单独恢复</span></footer>
    </aside>
  );
}

export function ProjectDetailView({ slug }: { slug: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [activeName, setActiveName] = useState("");
  const [viewMode, setViewMode] = useState<ProjectViewMode>("documents");
  const [feedback, setFeedback] = useState("");
  const [coverPrompt, setCoverPrompt] = useState("");
  const [coverRatio, setCoverRatio] = useState("3:4");
  const [loading, setLoading] = useState(true);
  const [refining, setRefining] = useState(false);
  const [autoRepairing, setAutoRepairing] = useState(false);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [regeneratingCoverPrompt, setRegeneratingCoverPrompt] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgressView>(initialMigrationProgress);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeDetails, setNoticeDetails] = useState<string[]>([]);
  const [documentRefreshKey, setDocumentRefreshKey] = useState(0);
  const [resumeRequested, setResumeRequested] = useState(false);

  const loadProject = useCallback(async (preferredFile?: string) => {
    const response = await fetch(`/api/projects/${encodeURIComponent(slug)}`);
    const data = await readJsonResponse<{ project?: ProjectDetail; error?: string }>(response);
    if (!response.ok) throw new Error(data.error || "项目读取失败。");
    const detail = data.project as ProjectDetail;
    const statuses = detail.metadata.documentsStatus && typeof detail.metadata.documentsStatus === "object" ? detail.metadata.documentsStatus as Record<string, { status?: string }> : {};
    const currentWorkflow = detail.metadata.workflowVersion === 2 || detail.files.some((file) => PROJECT_DOCUMENT_DEFINITIONS.some((definition) => definition.filename === file.name));
    const totalCoreCount = currentWorkflow ? PROJECT_DOCUMENT_DEFINITIONS.length : Math.max(Object.keys(statuses).length, detail.files.filter((file) => isPrimaryProjectDocument(file.name) && !/_修改版/u.test(file.name)).length, 1);
    const coreFileCount = Object.values(statuses).filter((item) => item.status === "completed").length || detail.files.filter((file) => isPrimaryProjectDocument(file.name) && !/_修改版/u.test(file.name)).length;
    setProject(detail);
    const preferredKnown = Boolean(preferredFile && (
      detail.files.some((file) => file.name === preferredFile)
      || PROJECT_DOCUMENT_DEFINITIONS.some((definition) => definition.filename === preferredFile)
    ));
    setActiveName(preferredKnown ? preferredFile as string : detail.files[0]?.name ?? "");
    window.dispatchEvent(new CustomEvent("piance-current-project", { detail: { title: detail.name || slug, status: detailProjectStatus(coreFileCount, totalCoreCount), tone: coreFileCount === totalCoreCount ? "ready" : "warning", fileCount: coreFileCount } }));
  }, [slug]);

  useEffect(() => {
    loadProject().catch((caught) => setError(caught instanceof Error ? caught.message : "项目读取失败。"))
      .finally(() => setLoading(false));
  }, [loadProject]);

  // 支持 URL 直达视图、恢复上次现场或打开搜索命中的文档。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const v = params.get("view");
    const document = params.get("document");
    const resume = params.get("resume") === "1";
    if (document && !project) return;
    if (v === "execution" || v === "overview" || v === "visual" || v === "risk") {
      setViewMode(v);
    }
    if (resume) { setViewMode("execution"); setResumeRequested(true); }
    if (document && project?.files.some((file) => file.name === document)) setActiveName(document);
    if (v || document || resume) {
      const url = new URL(window.location.href);
      url.searchParams.delete("view"); url.searchParams.delete("document"); url.searchParams.delete("resume");
      window.history.replaceState({}, "", url.toString());
    }
  }, [project]);

  const activeFile = useMemo(() => {
    if (!project) return undefined;
    return activeName ? project.files.find((file) => file.name === activeName) : project.files[0];
  }, [project, activeName]);
  const selectedDefinition = useMemo(
    () => PROJECT_DOCUMENT_DEFINITIONS.find((definition) => definition.filename === activeName),
    [activeName],
  );
  const documentStatuses = project?.metadata.documentsStatus && typeof project.metadata.documentsStatus === "object"
    ? project.metadata.documentsStatus as Record<string, DocumentStatusView>
    : {};
  const selectedDocumentStatus = selectedDefinition ? documentStatuses[selectedDefinition.number] : undefined;
  const selectedFailureReasons = !activeFile && selectedDefinition
    ? (selectedDocumentStatus?.validationErrors?.length ? selectedDocumentStatus.validationErrors : ["文档尚未生成。"])
    : [];
  const isVisualPrompt = Boolean(activeFile && (isVisualPromptDocument(activeFile.name) || activeFile.name === "03_发布与复盘.md"));

  useEffect(() => {
    if (isVisualPrompt && activeFile) setCoverPrompt(defaultCoverPrompt(activeFile.content, isVisualPromptDocument(activeFile.name)));
  }, [activeFile?.name, isVisualPrompt]);

  async function refine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeFile) return;
    setRefining(true); setError(""); setNotice(""); setNoticeDetails([]);
    try {
      const response = await fetch("/api/refine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectSlug: slug, fileName: activeFile.name, feedback }) });
      const data = await readJsonResponse<{ file: ResultFile; error?: string; errorCode?: string }>(response);
      if (!response.ok) {
        promptForModelConfig(data.errorCode);
        throw new Error(data.error || "修改失败。");
      }
      await loadProject(data.file.name);
      setFeedback("");
      setNotice(`已生成 ${data.file.name}，原文件未覆盖。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "修改失败。");
    } finally { setRefining(false); }
  }

  async function autoRepairCurrentDocument() {
    if (!activeFile) return;
    const fileName = activeFile.name;
    setAutoRepairing(true); setError(""); setNotice(""); setNoticeDetails([]);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/document/repair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName }),
      });
      const data = await readJsonResponse<{ file?: ResultFile & { repaired?: boolean; previousValidationErrors?: string[] }; error?: string; errorCode?: string }>(response);
      if (!response.ok) {
        promptForModelConfig(data.errorCode);
        throw new Error(data.error || "自动修复失败。");
      }
      await loadProject(fileName);
      setDocumentRefreshKey((value) => value + 1);
      if (data.file?.repaired) {
        const repairedItems = data.file.previousValidationErrors || [];
        setNotice(repairedItems.length
          ? `已修复 ${repairedItems.length} 项问题并通过复检，修复前版本已保留。`
          : "已完成自动修复并通过复检，修复前版本已保留。");
        setNoticeDetails(repairedItems);
      } else {
        setNotice("当前文档已经通过质量校验，无需修复。");
        setNoticeDetails([]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "自动修复失败。");
    } finally { setAutoRepairing(false); }
  }


  async function regenerateCoverPrompt() {
    if (!activeFile) return;
    setRegeneratingCoverPrompt(true); setError(""); setNotice(""); setNoticeDetails([]);
    try {
      const response = await fetch("/api/cover/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: activeFile.content, ratio: coverRatio }),
      });
      const data = await readJsonResponse<{ prompt?: string; error?: string; errorCode?: string }>(response);
      if (!response.ok) {
        promptForModelConfig(data.errorCode);
        throw new Error(data.error || "封面提示词生成失败。");
      }
      if (!data.prompt) throw new Error("封面提示词生成失败，未返回内容。");
      setCoverPrompt(data.prompt);
      setNotice("已根据当前发布内容重新生成视觉提示词，可继续编辑后生成封面。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "封面提示词生成失败。");
    } finally { setRegeneratingCoverPrompt(false); }
  }

  async function createCover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGeneratingCover(true); setError(""); setNotice(""); setNoticeDetails([]);
    try {
      const response = await fetch("/api/cover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectSlug: slug, prompt: coverPrompt, ratio: coverRatio }) });
      const data = await readJsonResponse<{ cover: { name: string }; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "封面生成失败。");
      const newCover: CoverSummary = { name: data.cover.name, createdAt: new Date().toISOString() };
      setProject((current) => current ? { ...current, covers: [newCover, ...(current.covers || [])] } : current);
      setNotice(`封面已生成并保存：covers/${data.cover.name}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "封面生成失败。");
    } finally { setGeneratingCover(false); }
  }

  function download() {
    if (!activeFile) return;
    const blob = new Blob([activeFile.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = activeFile.name; anchor.click();
    URL.revokeObjectURL(url);
  }

  async function migrateProject() {
    if (migrating) return;
    setMigrating(true); setMigrationProgress(initialMigrationProgress()); setError(""); setNotice(""); setNoticeDetails([]);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/migrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({}),
      });
      const data = response.headers.get("content-type")?.includes("text/event-stream")
        ? await readMigrationProgress(response, setMigrationProgress)
        : await readJsonResponse<MigrationResult>(response);
      if (!response.ok) {
        promptForModelConfig(data.errorCode);
        throw new Error(data.error || "项目迁移失败。");
      }
      if (!data.migrated && data.status === "failed") throw migrationRequestError(data.error || "项目迁移失败。", data.errorCode);
      await loadProject("01_创作简报.md");
      setNotice(`已迁移到新版工作流：旧文档已归档，当前使用 3 份核心工作稿。${data.archivedFiles?.length ? `已归档 ${data.archivedFiles.length} 份历史文档。` : ""}`);
    } catch (caught) {
      if (caught && typeof caught === "object" && "errorCode" in caught) promptForModelConfig((caught as MigrationRequestError).errorCode);
      setError(caught instanceof Error ? caught.message : "项目迁移失败。");
    } finally { setMigrating(false); }
  }

  async function regenerateInvalidDocuments() {
    setRegenerating(true); setError(""); setNotice(""); setNoticeDetails([]);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/regenerate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documents: [] }) });
      const data = await readJsonResponse<{ status?: string; error?: string; errorCode?: string }>(response);
      if (!response.ok) {
        promptForModelConfig(data.errorCode);
        throw new Error(data.error || "异常文档重新生成失败。");
      }
      await loadProject();
      if (data.status === "complete") setNotice("异常文档已修复，当前项目 3/3 可用。");
      else setError("重试已结束，仍有文档未通过质量校验。失败项没有写入本地，请查看具体原因。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "异常文档重新生成失败。");
    } finally { setRegenerating(false); }
  }

  async function retryDocument(number: string, fileName: string) {
    setRegenerating(true); setError(""); setNotice(""); setNoticeDetails([]);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents: [number] }),
      });
      const data = await readJsonResponse<{ status?: string; documentsStatus?: Record<string, DocumentStatusView>; error?: string; errorCode?: string }>(response);
      if (!response.ok) {
        promptForModelConfig(data.errorCode);
        throw new Error(data.error || "当前文档重新生成失败。");
      }
      await loadProject(fileName);
      const updated = data.documentsStatus?.[number];
      if (updated?.generated || updated?.status === "completed") {
        setNotice(`${fileName} 已重新生成。`);
      } else {
        setError(`${fileName} 仍未通过校验：${updated?.validationErrors?.join("；") || "请稍后重试。"}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "当前文档重新生成失败。");
      throw caught;
    } finally {
      setRegenerating(false);
    }
  }


  async function copyCurrent() {
    if (!activeFile) return;
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setError(""); setNoticeDetails([]); setNotice(`已复制 ${activeFile.name} 的 Markdown 正文。`);
    } catch {
      setError("复制失败，请检查浏览器剪贴板权限。");
    }
  }

  async function saveDocument(content: string): Promise<string> {
    if (!activeFile) throw new Error("请先选择一个文档。");
    const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/document`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: activeFile.name, content }),
    });
    const data = await readJsonResponse<{ content?: string; error?: string }>(response);
    if (!response.ok) throw new Error(data.error || "文档保存失败。");
    const saved = data.content ?? content;
    setProject((current) => current ? {
      ...current,
      files: current.files.map((file) => file.name === activeFile.name ? { ...file, content: saved } : file),
    } : current);
    return saved;
  }

  function downloadAll() {
    if (!project?.files.length) return;
    const content = project.files.map((file) => `<!-- ${file.name} -->\n\n${file.content.trim()}`).join("\n\n---\n\n");
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.replace(/[\\/:*?"<>|]/g, "_")}_完整内容包.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    setError(""); setNoticeDetails([]); setNotice(`已导出包含 ${project.files.length} 份文档的完整内容包。`);
  }

  if (loading) return <main className="console-loading" role="status" aria-live="polite" aria-busy="true"><ProjectLoadingIndicator /><p>正在连接项目工作区</p><small>正在载入内容流程</small></main>;
  if (!project) return <main className="console-loading"><div className="product-alert alert-warning">{error || "项目不存在。"}</div><Link className="secondary-button" href="/projects">返回项目列表</Link></main>;

  const showCoverTools = Boolean(activeFile && isVisualPrompt);
  const showRecoveryTools = Boolean(!activeFile && selectedDefinition && selectedFailureReasons.length > 0);
  const hasAgentPanel = viewMode === "documents" && Boolean(showCoverTools || showRecoveryTools || activeFile);

  return (
    <main className={`project-console mode-${viewMode}${hasAgentPanel ? " has-agent-panel" : ""}`}>
      <MigrationProgressModal open={migrating} progress={migrationProgress} />
      {viewMode !== "execution" && <ProjectSidebar
        slug={slug}
        projectName={project.name}
        metadata={project.metadata}
        files={project.files}
        activeName={activeFile?.name || activeName}
        onSelect={(name) => { setActiveName(name); setError(""); setNotice(""); setNoticeDetails([]); }}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        migrating={migrating}
        onMigrate={migrateProject}
      />}
      {viewMode === "documents" ? (
        <>
          <DocumentWorkspace
            file={activeFile}
            transitionKey={activeName || "empty-document"}
            selectedFileName={selectedDefinition?.filename}
            failureReasons={selectedFailureReasons}
            error={error}
            notice={notice}
            noticeDetails={noticeDetails}
            onDownload={download}
            onCopy={copyCurrent}
            onDownloadAll={downloadAll}
            canRegenerate={project.metadata.status !== "complete"}
            regenerating={regenerating}
            onRegenerate={regenerateInvalidDocuments}
            onRetrySelected={selectedDefinition ? () => { retryDocument(selectedDefinition.number, selectedDefinition.filename).catch(() => undefined); } : undefined}
            refineFeedback={feedback}
            refining={refining}
            repairing={autoRepairing}
            onRepair={activeFile?.validationErrors?.length ? autoRepairCurrentDocument : undefined}
            onRefineFeedbackChange={setFeedback}
            onRefine={refine}
            onSave={activeFile ? saveDocument : undefined}
            onDocumentSaved={() => setDocumentRefreshKey((value) => value + 1)}
          />
          {showCoverTools ? <AgentToolsPanel
            slug={slug}
            coverPrompt={coverPrompt}
            coverRatio={coverRatio}
            covers={project.covers || []}
            generatingCover={generatingCover}
            regeneratingCoverPrompt={regeneratingCoverPrompt}
            disabled={refining || autoRepairing || regenerating}
            onCoverPromptChange={setCoverPrompt}
            onRegenerateCoverPrompt={regenerateCoverPrompt}
            onCoverRatioChange={setCoverRatio}
            onCreateCover={createCover}
          /> : showRecoveryTools && selectedDefinition ? <FailedDocumentTools
            fileName={selectedDefinition.filename}
            reasons={selectedFailureReasons}
            retrying={regenerating}
            onRetry={() => { retryDocument(selectedDefinition.number, selectedDefinition.filename).catch(() => undefined); }}
          /> : activeFile ? <aside className="document-companion-panel project-surface-enter" key={`companion-${activeName}`}>
            <DocumentVersionsPanel
              slug={slug}
              fileName={activeFile.name}
              retrying={regenerating}
              onRetry={() => selectedDefinition ? retryDocument(selectedDefinition.number, selectedDefinition.filename) : Promise.resolve()}
              onChanged={() => loadProject(activeFile.name)}
              refreshToken={documentRefreshKey}
            />
          </aside> : null}
        </>
      ) : viewMode === "execution" ? (
        <ShotExecutionWorkspace
          slug={slug}
          resumeRequested={resumeRequested}
          onResumeHandled={() => setResumeRequested(false)}
          onBackToDocuments={() => setViewMode("documents")}
        />
      ) : viewMode === "overview" ? (
        <section className="project-overview-panel project-surface-enter">
          <StagePanel slug={slug} />
        </section>
      ) : (
        <section className="project-optional-workspace project-surface-enter">
          <header>
            <span>按需模块</span>
            <h2>{viewMode === "visual" ? "视觉参考" : "风险与来源"}</h2>
            <p>{viewMode === "visual"
              ? "只在确实需要 AI 封面、B-roll、虚拟场景或复杂风格时补充；简单真人口播可以留空。"
              : "集中记录事实出处、素材授权和表达禁区，作为后续修改与发布前核对依据。"}</p>
          </header>
          <ProjectBasisPanel slug={slug} mode={viewMode} />
        </section>
      )}
    </main>
  );
}
