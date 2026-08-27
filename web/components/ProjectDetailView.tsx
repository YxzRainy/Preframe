"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import { AgentToolsPanel, type CoverSummary } from "./AgentToolsPanel";
import { DocumentWorkspace } from "./DocumentWorkspace";
import { ProjectSidebar } from "./ProjectSidebar";
import { ShotExecutionWorkspace } from "./ShotExecutionWorkspace";
import { StagePanel } from "./project/StagePanel";
import { PublishPanel } from "./project/PublishPanel";
import { StatusBadge } from "./StatusBadge";
import type { ResultFile } from "./ResultTabs";
import { isPrimaryProjectDocument, isVisualPromptDocument, PROJECT_DOCUMENT_DEFINITIONS } from "../../src/utils/documentDefinitions";
import { readJsonResponse } from "../lib/readJsonResponse";
import { promptForModelConfig, withLocalModelConfig } from "../lib/localModelConfig";

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

function defaultCoverPrompt(content: string): string {
  const visual = markdownSection(content, "封面视觉提示词") || content;
  const negative = markdownSection(content, "负面提示词");
  const cleanedVisual = visual.replace(/[—-]{2}ar\s+\d+\s*:\s*\d+(?:\s+--(?:v|style)\s+\S+)*/gi, "").trim();
  return negative ? `${cleanedVisual}\n\n负面提示词：${negative}` : cleanedVisual;
}

function detailProjectStatus(fileCount: number): string {
  if (fileCount === 10) return "已打开项目 · 10/10 已完成";
  return `已打开项目 · ${fileCount}/10 可用`;
}

type ProjectViewMode = "documents" | "execution" | "overview";
type DocumentStatusView = { generated?: boolean; status?: string; documentStatus?: string; validationErrors?: string[] };

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
  const [assetPath, setAssetPath] = useState("");
  const [coverPrompt, setCoverPrompt] = useState("");
  const [coverRatio, setCoverRatio] = useState("3:4");
  const [loading, setLoading] = useState(true);
  const [refining, setRefining] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadProject = useCallback(async (preferredFile?: string) => {
    const response = await fetch(`/api/projects/${encodeURIComponent(slug)}`);
    const data = await readJsonResponse<{ project?: ProjectDetail; error?: string }>(response);
    if (!response.ok) throw new Error(data.error || "项目读取失败。");
    const detail = data.project as ProjectDetail;
    const statuses = detail.metadata.documentsStatus && typeof detail.metadata.documentsStatus === "object" ? detail.metadata.documentsStatus as Record<string, { status?: string }> : {};
    const coreFileCount = Object.values(statuses).filter((item) => item.status === "completed").length;
    setProject(detail);
    const preferredKnown = Boolean(preferredFile && (
      detail.files.some((file) => file.name === preferredFile)
      || PROJECT_DOCUMENT_DEFINITIONS.some((definition) => definition.filename === preferredFile)
    ));
    setActiveName(preferredKnown ? preferredFile as string : detail.files[0]?.name ?? "");
    window.dispatchEvent(new CustomEvent("piance-current-project", { detail: { title: detail.name || slug, status: detailProjectStatus(coreFileCount), tone: coreFileCount === 10 ? "ready" : "warning", fileCount: coreFileCount } }));
  }, [slug]);

  useEffect(() => {
    loadProject().catch((caught) => setError(caught instanceof Error ? caught.message : "项目读取失败。"))
      .finally(() => setLoading(false));
  }, [loadProject]);

  // 支持 URL ?view=execution / overview 直接进入对应视图
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const v = params.get("view");
    if (v === "execution" || v === "overview") {
      setViewMode(v);
      const url = new URL(window.location.href);
      url.searchParams.delete("view");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

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
  const isVisualPrompt = Boolean(activeFile && isVisualPromptDocument(activeFile.name));

  useEffect(() => {
    if (isVisualPrompt && activeFile) setCoverPrompt(defaultCoverPrompt(activeFile.content));
  }, [activeFile?.name, isVisualPrompt]);

  async function refine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeFile) return;
    setRefining(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/refine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(withLocalModelConfig({ projectSlug: slug, fileName: activeFile.name, feedback })) });
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

  async function scan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setScanning(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectSlug: slug, assetPath }) });
      const data = await readJsonResponse<{ file: ResultFile; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "素材扫描失败。");
      await loadProject(data.file.name);
      setNotice(`素材索引已更新：${data.file.name}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "素材扫描失败。");
    } finally { setScanning(false); }
  }

  async function createCover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGeneratingCover(true); setError(""); setNotice("");
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

  async function regenerateInvalidDocuments() {
    setRegenerating(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/regenerate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(withLocalModelConfig({ documents: [] })) });
      const data = await readJsonResponse<{ status?: string; error?: string; errorCode?: string }>(response);
      if (!response.ok) {
        promptForModelConfig(data.errorCode);
        throw new Error(data.error || "异常文档重新生成失败。");
      }
      await loadProject();
      if (data.status === "complete") setNotice("异常文档已修复，当前项目 10/10 可用。");
      else setError("重试已结束，仍有文档未通过质量校验。失败项没有写入本地，请查看具体原因。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "异常文档重新生成失败。");
    } finally { setRegenerating(false); }
  }

  async function retryDocument(number: string, fileName: string) {
    setRegenerating(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withLocalModelConfig({ documents: [number] })),
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

  async function retryActiveDocument() {
    if (!activeFile) return;
    const number = /^(\d{2})_/u.exec(activeFile.name)?.[1];
    if (!number) return;
    await retryDocument(number, activeFile.name);
  }

  async function copyCurrent() {
    if (!activeFile) return;
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setError(""); setNotice(`已复制 ${activeFile.name} 的 Markdown 正文。`);
    } catch {
      setError("复制失败，请检查浏览器剪贴板权限。");
    }
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
    setError(""); setNotice(`已导出包含 ${project.files.length} 份文档的完整内容包。`);
  }

  if (loading) return <main className="console-loading" role="status" aria-live="polite" aria-busy="true"><ProjectLoadingIndicator /><p>正在连接项目工作区</p><small>正在载入内容流程</small></main>;
  if (!project) return <main className="console-loading"><div className="product-alert alert-warning">{error || "项目不存在。"}</div><Link className="secondary-button" href="/projects">返回项目列表</Link></main>;

  return (
    <main className={`project-console mode-${viewMode}`}>
      <ProjectSidebar
        slug={slug}
        projectName={project.name}
        metadata={project.metadata}
        files={project.files}
        activeName={activeFile?.name || activeName}
        onSelect={(name) => { setActiveName(name); setError(""); setNotice(""); }}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />
      {viewMode === "documents" ? (
        <>
          <DocumentWorkspace
            file={activeFile}
            selectedFileName={selectedDefinition?.filename}
            failureReasons={selectedFailureReasons}
            error={error}
            notice={notice}
            onDownload={download}
            onCopy={copyCurrent}
            onDownloadAll={downloadAll}
            canRegenerate={project.metadata.status !== "complete"}
            regenerating={regenerating}
            onRegenerate={regenerateInvalidDocuments}
            onRetrySelected={selectedDefinition ? () => { retryDocument(selectedDefinition.number, selectedDefinition.filename).catch(() => undefined); } : undefined}
          />
          {activeFile ? <AgentToolsPanel
            slug={slug}
            isVisualPrompt={isVisualPrompt}
            feedback={feedback}
            assetPath={assetPath}
            coverPrompt={coverPrompt}
            coverRatio={coverRatio}
            covers={project.covers || []}
            refining={refining}
            scanning={scanning}
            generatingCover={generatingCover}
            activeFileName={activeFile?.name || ""}
            retryingDocument={regenerating}
            onFeedbackChange={setFeedback}
            onAssetPathChange={setAssetPath}
            onCoverPromptChange={setCoverPrompt}
            onCoverRatioChange={setCoverRatio}
            onRefine={refine}
            onScan={scan}
            onCreateCover={createCover}
            onRetryDocument={retryActiveDocument}
            onDocumentChanged={() => loadProject(activeFile?.name)}
          /> : selectedDefinition ? <FailedDocumentTools
            fileName={selectedDefinition.filename}
            reasons={selectedFailureReasons}
            retrying={regenerating}
            onRetry={() => { retryDocument(selectedDefinition.number, selectedDefinition.filename).catch(() => undefined); }}
          /> : null}
        </>
      ) : viewMode === "execution" ? (
        <ShotExecutionWorkspace slug={slug} />
      ) : (
        <section className="project-overview-panel">
          <StagePanel slug={slug} />
          <PublishPanel slug={slug} />
        </section>
      )}
    </main>
  );
}
