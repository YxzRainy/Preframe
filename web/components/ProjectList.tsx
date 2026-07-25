"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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

export function ProjectList() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

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
      setDeleteTarget(null);
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "项目删除失败。");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <div className="loading-card"><div className="agent-loader"><span /><span /><span /></div><strong>正在同步本地项目</strong><small>正在读取输出目录</small></div>;
  if (error) return <div className="product-alert alert-warning"><span>!</span><div><strong>项目库读取失败</strong><p>{error}</p></div></div>;
  if (!projects.length) {
    return <div className="empty-card library-empty"><span>00</span><h2>还没有内容项目</h2><p>创建第一个短视频内容项目，生成的前期策划包会在这里归档。</p><Link className="secondary-button inline" href="/">前往项目工作台</Link></div>;
  }

  return (
    <>
      <div className="project-grid">
        {projects.map((project, index) => (
        <article className="project-card" key={project.slug}>
          <div className="project-card-top">
            <span className="project-sequence">项目 {String(index + 1).padStart(3, "0")}</span>
            <div className="project-card-actions">
              <span className="project-ready"><i /> {project.status === "complete" ? "10/10 可用" : project.status === "partial" ? `${project.completedCount}/10 可用` : "待修复"}</span>
              <button
                className="project-delete-button"
                type="button"
                aria-label={`删除项目 ${project.name}`}
                onClick={() => { setDeleteTarget(project); setDeleteError(""); }}
              >
                删除
              </button>
            </div>
          </div>
          <Link className="project-card-link" href={`/projects/${encodeURIComponent(project.slug)}`}>
            <div className="project-card-icon">{project.platform.slice(0, 1)}</div>
            <h2>{project.name}</h2>
            <div className="project-card-tags"><span>{project.platform}</span><span>{project.contentSubject}</span>{project.contentDomain !== "未记录" && <span>{project.contentDomain}</span>}</div>
            <div className="project-card-pipeline">{Array.from({ length: Math.min(project.completedCount, 8) }, (_, itemIndex) => <i key={itemIndex} />)}</div>
            <div className="project-card-footer"><div><small>最近更新</small><time>{new Date(project.generatedAt).toLocaleString("zh-CN")}</time></div><div><small>可用文档</small><strong>{project.completedCount}</strong></div><span className="card-arrow">↗</span></div>
          </Link>
        </article>
      ))}
      </div>
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
    </>
  );
}
