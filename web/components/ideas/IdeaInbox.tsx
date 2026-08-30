"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Idea } from "../dashboard/types";
import { formatRelativeTime } from "../dashboard/types";
import { readJsonResponse } from "../../lib/readJsonResponse";
import {
  ArrowUpRight,
  PencilSimple,
  Trash,
  X,
} from "@phosphor-icons/react";

const DRAFT_STORAGE_KEY = "preframe:ideas:draft";

type Draft = {
  text: string;
  savedAt: string;
};

const EMPTY_DRAFT: Draft = { text: "", savedAt: "" };

function parseIdeaDraft(text: string) {
  const lines = text.split("\n");
  const title = lines.shift()?.trim() || "未命名灵感";
  const note = lines.join("\n").trim();
  return { title, note };
}

export function IdeaInbox() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Idea | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/ideas", { cache: "no-store" });
      const data = await readJsonResponse<{ ideas?: Idea[]; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "灵感读取失败。");
      setIdeas(data.ideas || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "灵感读取失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as Partial<Draft>;
      if (typeof parsed.text === "string") {
        setDraft({ ...EMPTY_DRAFT, ...parsed });
      }
    } catch {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const handler = () => load();
    window.addEventListener("piance-ideas-updated", handler);
    return () => window.removeEventListener("piance-ideas-updated", handler);
  }, [load]);

  useEffect(() => {
    if (!draft.text.trim()) {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      return;
    }
    const timer = window.setTimeout(() => {
      const next = { ...draft, savedAt: new Date().toISOString() };
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(next));
      setDraft((current) => ({ ...current, savedAt: next.savedAt }));
    }, 420);
    return () => window.clearTimeout(timer);
  }, [draft.text]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void create();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function create() {
    if (!draft.text.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const { title, note } = parseIdeaDraft(draft.text.trim());
      const response = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, note: note || undefined }),
      });
      const data = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "灵感创建失败。");
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      setDraft(EMPTY_DRAFT);
      await load();
      textareaRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "灵感创建失败。");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const prev = ideas;
    setIdeas((cur) => cur.filter((i) => i.id !== id));
    try {
      const response = await fetch(`/api/ideas/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("删除失败");
    } catch {
      setIdeas(prev);
      setError("删除失败，请稍后重试。");
    }
  }

  function startEdit(idea: Idea) {
    setEditingId(idea.id);
    setEditDraft({ ...idea, tags: [...idea.tags] });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
  }

  async function saveEdit() {
    if (!editDraft) return;
    try {
      const response = await fetch(`/api/ideas/${encodeURIComponent(editDraft.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editDraft.title, note: editDraft.note, source: editDraft.source, tags: editDraft.tags }),
      });
      const data = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "灵感更新失败。");
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "灵感更新失败。");
    }
  }

  function convertToProject(idea: Idea) {
    window.dispatchEvent(new CustomEvent("piance-open-new-task", {
      detail: { ideaId: idea.id, topic: idea.title, extra: idea.note || undefined },
    }));
  }

  const savedIdeas = useMemo(() => ideas.filter((idea) => !idea.convertedProjectSlug), [ideas]);
  const convertedIdeas = useMemo(() => ideas.filter((idea) => Boolean(idea.convertedProjectSlug)), [ideas]);
  return (
    <section className="ideas-workspace" aria-label="灵感">
      <header className="ideas-hero-row">
        <h1>灵感</h1>
      </header>
      <div className="ideas-grid">
        <div className="ideas-capture-column">
          <form className="ideas-capture-card" onSubmit={(event) => { event.preventDefault(); void create(); }}>
            <textarea
              ref={textareaRef}
              aria-label="写下灵感"
              value={draft.text}
              onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))}
              placeholder="写下一个想法…"
              rows={6}
              autoFocus
            />
            <footer className="ideas-capture-footer">
              <div className="ideas-capture-actions">
                <button type="submit" className="ideas-save-button" disabled={saving || !draft.text.trim()}>
                  {saving ? "保存中" : "保存"}<ArrowUpRight size={15} weight="bold" />
                </button>
              </div>
            </footer>
          </form>
        </div>

        <aside className="ideas-side-column">
          <div className="ideas-side-heading">
            <div><span>已记录</span><strong>{savedIdeas.length + convertedIdeas.length}</strong></div>
          </div>
          {error && <div className="idea-error">{error}</div>}
          {loading ? (
            <p className="idea-muted">读取中…</p>
          ) : ideas.length === 0 ? (
            <p className="ideas-empty-state">暂无记录</p>
          ) : (
            <div className="ideas-stream">
              {savedIdeas.map((idea) => (
                <IdeaCard key={idea.id} idea={idea} editingId={editingId} editDraft={editDraft} setEditDraft={setEditDraft} startEdit={startEdit} cancelEdit={cancelEdit} saveEdit={saveEdit} convertToProject={convertToProject} remove={remove} />
              ))}
              {convertedIdeas.length > 0 && <div className="ideas-converted-divider"><span>已转为项目</span></div>}
              {convertedIdeas.map((idea) => (
                <IdeaCard key={idea.id} idea={idea} editingId={editingId} editDraft={editDraft} setEditDraft={setEditDraft} startEdit={startEdit} cancelEdit={cancelEdit} saveEdit={saveEdit} convertToProject={convertToProject} remove={remove} />
              ))}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

type IdeaCardProps = {
  idea: Idea;
  editingId: string | null;
  editDraft: Idea | null;
  setEditDraft: React.Dispatch<React.SetStateAction<Idea | null>>;
  startEdit: (idea: Idea) => void;
  cancelEdit: () => void;
  saveEdit: () => void;
  convertToProject: (idea: Idea) => void;
  remove: (id: string) => void;
};

function IdeaCard({ idea, editingId, editDraft, setEditDraft, startEdit, cancelEdit, saveEdit, convertToProject, remove }: IdeaCardProps) {
  if (editingId === idea.id && editDraft) {
    return <article className="idea-stream-card idea-edit-card">
      <input value={editDraft.title} onChange={(event) => setEditDraft((current) => current ? { ...current, title: event.target.value } : current)} />
      <textarea rows={3} value={editDraft.note || ""} onChange={(event) => setEditDraft((current) => current ? { ...current, note: event.target.value } : current)} />
      <input placeholder="来源" value={editDraft.source || ""} onChange={(event) => setEditDraft((current) => current ? { ...current, source: event.target.value } : current)} />
      <input placeholder="标签，用逗号分隔" value={editDraft.tags.join(", ")} onChange={(event) => setEditDraft((current) => current ? { ...current, tags: event.target.value.split(/[,，\s]+/).filter(Boolean) } : current)} />
      <div className="idea-edit-actions"><button type="button" className="ideas-save-button" onClick={saveEdit}>保存</button><button type="button" className="ideas-detail-toggle" onClick={cancelEdit}><X size={15} />取消</button></div>
    </article>;
  }

  return <article className={`idea-stream-card ${idea.convertedProjectSlug ? "is-converted" : ""}`}>
    <div className="idea-stream-card-top"><span className="idea-stream-time">{formatRelativeTime(idea.updatedAt || idea.createdAt)}</span><button className="idea-icon-button" type="button" aria-label="编辑灵感" onClick={() => startEdit(idea)}><PencilSimple size={15} /></button></div>
    <h3>{idea.title}</h3>
    {idea.note && <p>{idea.note}</p>}
    <div className="idea-stream-meta">
      {idea.source && <span>{idea.source}</span>}
      {idea.tags.map((tag) => <span key={tag}>#{tag}</span>)}
    </div>
    <div className="idea-stream-actions">
      {!idea.convertedProjectSlug && <button type="button" onClick={() => convertToProject(idea)}>转成项目 <ArrowUpRight size={14} /></button>}
      <button type="button" className="idea-delete-button" aria-label="删除灵感" onClick={() => remove(idea.id)}><Trash size={14} /></button>
    </div>
  </article>;
}
