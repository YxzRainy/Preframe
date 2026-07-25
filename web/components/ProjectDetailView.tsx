"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AgentToolsPanel, type CoverSummary } from "./AgentToolsPanel";
import { DocumentWorkspace } from "./DocumentWorkspace";
import { ProjectSidebar } from "./ProjectSidebar";
import type { ResultFile } from "./ResultTabs";
import { isPrimaryProjectDocument, isVisualPromptDocument } from "../../src/utils/documentDefinitions";
import { readJsonResponse } from "../lib/readJsonResponse";

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

function countCoreDocuments(files: ResultFile[]): number {
  return files.filter((file) => isPrimaryProjectDocument(file.name) && !/_修改版/u.test(file.name)).length;
}

export function ProjectDetailView({ slug }: { slug: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [activeName, setActiveName] = useState("");
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
    setActiveName(preferredFile && detail.files.some((file) => file.name === preferredFile) ? preferredFile : detail.files[0]?.name ?? "");
    window.dispatchEvent(new CustomEvent("piance-current-project", { detail: { title: detail.name || slug, status: detailProjectStatus(coreFileCount), tone: coreFileCount === 10 ? "ready" : "warning", fileCount: coreFileCount } }));
  }, [slug]);

  useEffect(() => {
    loadProject().catch((caught) => setError(caught instanceof Error ? caught.message : "项目读取失败。"))
      .finally(() => setLoading(false));
  }, [loadProject]);

  const activeFile = useMemo(() => project?.files.find((file) => file.name === activeName) ?? project?.files[0], [project, activeName]);
  const isVisualPrompt = Boolean(activeFile && isVisualPromptDocument(activeFile.name));

  useEffect(() => {
    if (isVisualPrompt && activeFile) setCoverPrompt(defaultCoverPrompt(activeFile.content));
  }, [activeFile?.name, isVisualPrompt]);

  async function refine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeFile) return;
    setRefining(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/refine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectSlug: slug, fileName: activeFile.name, feedback }) });
      const data = await readJsonResponse<{ file: ResultFile; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "修改失败。");
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
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/regenerate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documents: [] }) });
      const data = await readJsonResponse<{ status?: string; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "异常文档重新生成失败。");
      await loadProject();
      setNotice(data.status === "complete" ? "异常文档已修复，当前项目 10/10 可用。" : "已完成重试，仍有文档未通过质量校验。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "异常文档重新生成失败。");
    } finally { setRegenerating(false); }
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

  if (loading) return <main className="console-loading"><div className="agent-loader"><span /><span /><span /></div><p>正在连接项目工作区</p><small>正在载入内容流程</small></main>;
  if (!project) return <main className="console-loading"><div className="product-alert alert-warning">{error || "项目不存在。"}</div><Link className="secondary-button" href="/projects">返回项目列表</Link></main>;

  return (
    <main className="project-console">
      <ProjectSidebar projectName={project.name} metadata={project.metadata} files={project.files} activeName={activeFile?.name || activeName} onSelect={(name) => { setActiveName(name); setError(""); setNotice(""); }} />
      <DocumentWorkspace file={activeFile} error={error} notice={notice} onDownload={download} onCopy={copyCurrent} onDownloadAll={downloadAll} canRegenerate={project.metadata.status !== "complete"} regenerating={regenerating} onRegenerate={regenerateInvalidDocuments} />
      <AgentToolsPanel
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
        onFeedbackChange={setFeedback}
        onAssetPathChange={setAssetPath}
        onCoverPromptChange={setCoverPrompt}
        onCoverRatioChange={setCoverRatio}
        onRefine={refine}
        onScan={scan}
        onCreateCover={createCover}
      />
    </main>
  );
}
