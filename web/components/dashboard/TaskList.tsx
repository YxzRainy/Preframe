"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, X } from "@phosphor-icons/react";
import type { Task } from "./types";
import { isToday } from "./types";
import { readJsonResponse } from "../../lib/readJsonResponse";

interface TaskListProps {
  compact?: boolean;
  /** 内嵌模式：用于首页，不渲染页面级标题 */
  embedded?: boolean;
  /** 服务端首屏数据，避免先渲染“读取中”再替换为真实待办。 */
  initialTasks?: Task[];
}

const PRIORITY_LABELS: Record<Task["priority"], string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export function TaskList({ compact = false, embedded = false, initialTasks }: TaskListProps) {
  const [tasks, setTasks] = useState<Task[]>(() => initialTasks ?? []);
  const [view, setView] = useState<"today" | "all">("today");
  const [loading, setLoading] = useState(() => initialTasks === undefined);
  const [error, setError] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      const data = await readJsonResponse<{ tasks?: Task[]; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "待办读取失败。");
      setTasks(data.tasks || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "待办读取失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialTasks === undefined) load();
  }, [initialTasks, load]);

  const filtered = view === "today"
    ? tasks.filter((t) => isToday(t.dueDate) || (!t.dueDate && isToday(t.createdAt)))
    : tasks;
  const visible = compact ? filtered.slice(0, 5) : filtered;

  async function toggle(task: Task) {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: !t.completed } : t)));
    try {
      await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: !task.completed }),
      });
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: task.completed } : t)));
    }
  }

  async function remove(task: Task) {
    const prev = tasks;
    setTasks((cur) => cur.filter((t) => t.id !== task.id));
    try {
      await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
    } catch {
      setTasks(prev);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim(), priority: "medium" }),
      });
      const data = await readJsonResponse<{ task?: Task; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "待办创建失败。");
      setNewTitle("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "待办创建失败。");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className={`task-list ${embedded ? "task-list-embedded" : ""}`} aria-label="今日待办">
      {!embedded && (
        <header className="task-list-head">
          <h2>今日待办</h2>
          <div className="task-list-tabs">
            <button type="button" className={view === "today" ? "active" : ""} onClick={() => setView("today")}>今日</button>
            <button type="button" className={view === "all" ? "active" : ""} onClick={() => setView("all")}>全部</button>
          </div>
        </header>
      )}
      {embedded && (
        <header className="task-list-head">
          <h2>今日待办</h2>
          <Link className="task-list-more" href="/tasks">全部</Link>
        </header>
      )}
      <form className="task-list-new" onSubmit={create}>
        <input
          type="text"
          placeholder="添加一条今日待办…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          aria-label="新增待办"
        />
        <button type="submit" disabled={creating || !newTitle.trim()} aria-label="添加待办" title="添加待办"><Plus size={16} weight="bold" /></button>
      </form>
      {error && <p className="task-list-error">{error}</p>}
      {loading ? (
        <p className="task-list-muted">读取中…</p>
      ) : visible.length === 0 ? (
        <p className="task-list-muted">暂无待办，专注当下。</p>
      ) : (
        <ul className="task-items">
          {visible.map((task) => (
            <li key={task.id} className={`task-item ${task.completed ? "done" : ""}`}>
              <label className="task-item-check">
                <input type="checkbox" checked={task.completed} onChange={() => toggle(task)} />
                <span />
              </label>
              <div className="task-item-body">
                <span className="task-item-title">{task.title}</span>
                <div className="task-item-meta">
                  <span className={`task-priority priority-${task.priority}`}>{PRIORITY_LABELS[task.priority]}</span>
                  {task.dueDate && <span className="task-due">{new Date(task.dueDate).toLocaleDateString("zh-CN")}</span>}
                  {task.projectSlug && (
                    <Link className="task-project" href={`/projects/${encodeURIComponent(task.projectSlug)}`}>关联项目</Link>
                  )}
                </div>
              </div>
              <button type="button" className="task-item-del" aria-label="删除" title="删除" onClick={() => remove(task)}><X size={13} /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
