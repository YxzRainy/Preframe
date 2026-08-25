"use client";

import { useCallback, useEffect, useState } from "react";
import type { Idea } from "../dashboard/types";
import { formatRelativeTime } from "../dashboard/types";
import { readJsonResponse } from "../../lib/readJsonResponse";

export function IdeaInbox() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({ title: "", note: "", source: "", tags: "" });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Idea | null>(null);

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
    const handler = () => load();
    window.addEventListener("piance-ideas-updated", handler);
    return () => window.removeEventListener("piance-ideas-updated", handler);
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    setSaving(true);
    try {
      const tags = draft.tags.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean);
      const response = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim(),
          note: draft.note.trim() || undefined,
          source: draft.source.trim() || undefined,
          tags,
        }),
      });
      const data = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "灵感创建失败。");
      setDraft({ title: "", note: "", source: "", tags: "" });
      await load();
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
      await fetch(`/api/ideas/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      setIdeas(prev);
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
        body: JSON.stringify({
          title: editDraft.title,
          note: editDraft.note,
          source: editDraft.source,
          tags: editDraft.tags,
        }),
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

  return (
    <div className="idea-inbox">
      <form className="idea-create-card" onSubmit={create}>
        <input
          type="text"
          placeholder="一句话写下灵感…"
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          className="idea-create-title"
        />
        <textarea
          placeholder="补充说明（可选）"
          value={draft.note}
          rows={2}
          onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
        />
        <div className="idea-create-meta">
          <input
            type="text"
            placeholder="来源（可选）"
            value={draft.source}
            onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))}
          />
          <input
            type="text"
            placeholder="标签，逗号分隔"
            value={draft.tags}
            onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
          />
        </div>
        <div className="idea-create-actions">
          <button type="submit" className="primary-button" disabled={saving || !draft.title.trim()}>
            {saving ? "保存中…" : "记录灵感"}
          </button>
        </div>
      </form>

      {error && <div className="idea-error">{error}</div>}

      {loading ? (
        <p className="idea-muted">读取中…</p>
      ) : ideas.length === 0 ? (
        <div className="idea-empty">
          <p>还没有灵感。</p>
          <p>随手记下任何想法，不用想清楚再写。</p>
        </div>
      ) : (
        <ul className="idea-list">
          {ideas.map((idea) => (
            <li key={idea.id} className={`idea-item ${idea.convertedProjectSlug ? "converted" : ""}`}>
              {editingId === idea.id && editDraft ? (
                <div className="idea-edit">
                  <input
                    type="text"
                    value={editDraft.title}
                    onChange={(e) => setEditDraft((d) => d ? { ...d, title: e.target.value } : d)}
                  />
                  <textarea
                    rows={2}
                    value={editDraft.note || ""}
                    onChange={(e) => setEditDraft((d) => d ? { ...d, note: e.target.value } : d)}
                  />
                  <input
                    type="text"
                    placeholder="来源"
                    value={editDraft.source || ""}
                    onChange={(e) => setEditDraft((d) => d ? { ...d, source: e.target.value } : d)}
                  />
                  <input
                    type="text"
                    placeholder="标签，逗号分隔"
                    value={editDraft.tags.join(", ")}
                    onChange={(e) => setEditDraft((d) => d ? { ...d, tags: e.target.value.split(/[,，\s]+/).filter(Boolean) } : d)}
                  />
                  <div className="idea-edit-actions">
                    <button type="button" className="primary-button" onClick={saveEdit}>保存</button>
                    <button type="button" className="secondary-button" onClick={cancelEdit}>取消</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="idea-item-head">
                    <h3 className="idea-item-title">{idea.title}</h3>
                    {idea.convertedProjectSlug && <span className="idea-converted-badge">已转项目</span>}
                  </div>
                  {idea.note && <p className="idea-item-note">{idea.note}</p>}
                  <div className="idea-item-meta">
                    {idea.source && <span className="idea-source">来源 · {idea.source}</span>}
                    {idea.tags.length > 0 && (
                      <span className="idea-tags">
                        {idea.tags.map((t) => (<span key={t} className="idea-tag">#{t}</span>))}
                      </span>
                    )}
                    <span className="idea-time">{formatRelativeTime(idea.createdAt)}</span>
                  </div>
                  <div className="idea-item-actions">
                    {!idea.convertedProjectSlug && (
                      <button type="button" className="idea-action primary" onClick={() => convertToProject(idea)}>
                        转换为内容项目
                      </button>
                    )}
                    <button type="button" className="idea-action" onClick={() => startEdit(idea)}>编辑</button>
                    <button type="button" className="idea-action danger" onClick={() => remove(idea.id)}>删除</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
