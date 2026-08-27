"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, ArrowUpRight, DownloadSimple, FolderOpen, Plus, Trash, UploadSimple } from "@phosphor-icons/react";
import { Modal } from "./Modal";
import { readJsonResponse } from "../lib/readJsonResponse";

interface ProjectSummary {
  slug: string;
  name: string;
  generatedAt: string;
  platform: string;
  contentSubject: string;
  contentDomain: string;
  fileCount: number;
  completedCount: number;
  status: "complete" | "partial" | "failed";
}

interface TrashProject {
  id: string;
  originalSlug: string;
  name: string;
  deletedAt: string;
  sizeBytes: number;
}

export function ProjectList() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "published">("all");
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashProjects, setTrashProjects] = useState<TrashProject[]>([]);
  const [trashBusy, setTrashBusy] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const importInput = useRef<HTMLInputElement>(null);

  async function loadProjects() {
    setLoading(true);
    setError("");
    fetch("/api/projects")
      .then(async (response) => {
        const data = await readJsonResponse<{ projects?: ProjectSummary[]; error?: string }>(response);
        if (!response.ok) throw new Error(data.error || "项目读取失败。");
        return data.projects as ProjectSummary[];
      })
      .then(setProjects)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "项目读取失败。"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadProjects();
  }, []);

  async function deleteProject() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(deleteTarget.slug)}`, { method: "DELETE" });
      const data = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "项目删除失败。");
      setProjects((current) => current.filter((project) => project.slug !== deleteTarget.slug));
      setNotice("项目已移入回收站，可随时恢复。");
      setDeleteTarget(null);
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "项目删除失败。");
    } finally {
      setDeleting(false);
    }
  }

  async function loadTrash() {
    setTrashBusy("load"); setDeleteError("");
    try {
      const response = await fetch("/api/projects/trash", { cache: "no-store" });
      const data = await readJsonResponse<{ projects?: TrashProject[]; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "回收站读取失败。");
      setTrashProjects(data.projects || []);
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "回收站读取失败。");
    } finally { setTrashBusy(""); }
  }

  async function openTrash() {
    setTrashOpen(true);
    await loadTrash();
  }

  async function restoreProject(project: TrashProject) {
    setTrashBusy(project.id); setDeleteError("");
    try {
      const response = await fetch(`/api/projects/trash/${encodeURIComponent(project.id)}/restore`, { method: "POST" });
      const data = await readJsonResponse<{ restored?: { slug: string }; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "项目恢复失败。");
      setTrashProjects((current) => current.filter((item) => item.id !== project.id));
      setNotice(`“${project.name}”已恢复${data.restored?.slug !== project.originalSlug ? `为 ${data.restored?.slug}` : ""}。`);
      await loadProjects();
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "项目恢复失败。");
    } finally { setTrashBusy(""); }
  }

  async function importProject(file: File) {
    setTransferBusy(true); setError(""); setNotice("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/projects/import", { method: "POST", body: form });
      const data = await readJsonResponse<{ imported?: { slug: string; fileCount: number }; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "项目导入失败。");
      setNotice(`项目已导入，共恢复 ${data.imported?.fileCount || 0} 个文件。`);
      await loadProjects();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "项目导入失败。");
    } finally {
      setTransferBusy(false);
      if (importInput.current) importInput.current.value = "";
    }
  }

  if (loading) return <div className="loading-card"><div className="agent-loader"><span /><span /><span /></div><strong>正在同步本地项目</strong><small>正在读取输出目录</small></div>;
  if (error) return <div className="product-alert alert-warning"><span>!</span><div><strong>项目库读取失败</strong><p>{error}</p></div></div>;
  const filterTabs = [
    { id: "all" as const, label: "全部" },
    { id: "active" as const, label: "进行中" },
    { id: "published" as const, label: "已发布" },
  ];
  const filteredProjects = projects.filter((p) => {
    if (filter === "all") return true;
    if (filter === "published") return p.status === "complete";
    return p.status !== "complete";
  });

  return (
    <>
      <div className="project-library-toolbar">
        <div className="project-filters">
          {filterTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`project-filter-tab ${filter === tab.id ? "active" : ""}`}
            onClick={() => setFilter(tab.id)}
          >
            {tab.label}
            <span className="project-filter-count">
              {tab.id === "all" ? projects.length : tab.id === "published" ? projects.filter((p) => p.status === "complete").length : projects.filter((p) => p.status !== "complete").length}
            </span>
          </button>
          ))}
        </div>
        <div className="project-transfer-actions">
          <button type="button" className="secondary-button" onClick={() => importInput.current?.click()} disabled={transferBusy}><UploadSimple size={16} />{transferBusy ? "导入中" : "导入项目"}</button>
          <button type="button" className="secondary-button" onClick={() => void openTrash()}><Trash size={16} />回收站</button>
          <input ref={importInput} type="file" accept="application/json,.json,.preframe-project.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importProject(file); }} />
        </div>
      </div>
      {notice && <p className="project-library-notice">{notice}</p>}
      {!projects.length ? (
        <div className="empty-card library-empty"><span><FolderOpen size={28} weight="fill" /></span><p className="empty-kicker">PROJECT LIBRARY</p><h2>还没有内容项目</h2><p>创建第一个项目，或导入之前导出的项目归档。</p><Link className="primary-button inline" href="/"><Plus size={16} weight="bold" /> 创建第一个项目</Link></div>
      ) : filteredProjects.length === 0 ? (
        <div className="empty-card library-empty">
          <span><FolderOpen size={28} weight="fill" /></span>
          <h2>该筛选下暂无项目</h2>
          <p>切换筛选条件，或创建新的内容项目。</p>
        </div>
      ) : (
      <div className="project-grid">
        {filteredProjects.map((project, index) => (
        <article className="project-card" key={project.slug}>
          <div className="project-card-top">
            <span className="project-sequence">项目 {String(index + 1).padStart(3, "0")}</span>
            <div className="project-card-actions">
              <span className="project-ready"><i /> {project.status === "complete" ? "10/10 可用" : project.status === "partial" ? `${project.completedCount}/10 可用` : "待重试"}</span>
              <a className="project-delete-button" href={`/api/projects/${encodeURIComponent(project.slug)}/export`} download title="导出项目" aria-label={`导出项目 ${project.name}`}><DownloadSimple size={15} /></a>
              <button
                className="project-delete-button"
                type="button"
                aria-label={`删除项目 ${project.name}`}
                onClick={() => { setDeleteTarget(project); setDeleteError(""); }}
              >
                <Trash size={15} />
              </button>
            </div>
          </div>
          <Link className="project-card-link" href={`/projects/${encodeURIComponent(project.slug)}`}>
            <div className="project-card-icon"><FolderOpen size={24} weight="fill" /><small>{project.platform.slice(0, 1)}</small></div>
            <h2>{project.name}</h2>
            <div className="project-card-tags"><span>{project.platform}</span><span>{project.contentSubject}</span>{project.contentDomain !== "未记录" && <span>{project.contentDomain}</span>}</div>
            <div className="project-card-pipeline">{Array.from({ length: Math.min(project.completedCount, 8) }, (_, itemIndex) => <i key={itemIndex} />)}</div>
            <div className="project-card-footer"><div><small>最近更新</small><time>{new Date(project.generatedAt).toLocaleString("zh-CN")}</time></div><div><small>可用文档</small><strong>{project.completedCount}</strong></div><span className="card-arrow"><ArrowUpRight size={18} weight="bold" /></span></div>
          </Link>
        </article>
      ))}
      </div>
      )}
      <Modal
        open={Boolean(deleteTarget)}
        title="删除项目？"
        description="该操作会将此项目移动到回收站/Trash，项目内 Markdown 和素材索引也会一并移除。"
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
        closeDisabled={deleting}
        size="sm"
        footer={<><button type="button" className="secondary-button" onClick={() => setDeleteTarget(null)} disabled={deleting}>取消</button><button type="button" className="danger-button" onClick={deleteProject} disabled={deleting}>{deleting ? "删除中" : "删除"}</button></>}
      >
        <div className="delete-confirm-copy">
          <strong>{deleteTarget?.name}</strong>
          <p>删除后不会从磁盘永久抹除，会移动到本机 `.piance/trash/`。</p>
          {deleteError && <p className="settings-modal-error">{deleteError}</p>}
        </div>
      </Modal>
      <Modal
        open={trashOpen}
        title="项目回收站"
        description="恢复项目时若名称冲突，会自动添加序号，不会覆盖现有项目。"
        onClose={() => { if (!trashBusy) setTrashOpen(false); }}
        closeDisabled={Boolean(trashBusy)}
        size="lg"
      >
        <div className="trash-project-list">
          {trashBusy === "load" ? <p className="maintenance-empty">正在读取回收站</p> : trashProjects.length ? trashProjects.map((project) => (
            <article key={project.id}>
              <div><strong>{project.name}</strong><span>{new Date(project.deletedAt).toLocaleString("zh-CN")} · {(project.sizeBytes / 1024).toFixed(project.sizeBytes > 1024 * 100 ? 0 : 1)} KB</span></div>
              <button type="button" className="secondary-button" onClick={() => void restoreProject(project)} disabled={Boolean(trashBusy)}><ArrowCounterClockwise size={15} />{trashBusy === project.id ? "恢复中" : "恢复"}</button>
            </article>
          )) : <p className="maintenance-empty">回收站为空</p>}
          {deleteError && <p className="settings-modal-error">{deleteError}</p>}
        </div>
      </Modal>
    </>
  );
}
