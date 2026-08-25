/** 今日待办管理 — 真实可用的本地待办，持久化到 .piance/tasks.json */

import { createId, nowIso, readJsonFile, writeJsonFile } from "./localStore.js";
import type { Task, TaskInput, TaskPatch, TaskPriority } from "../types/task.js";

const STORE = "tasks";
const PRIORITIES: ReadonlySet<TaskPriority> = new Set(["low", "medium", "high"]);

interface TaskStore {
  tasks: Task[];
}

function emptyStore(): TaskStore {
  return { tasks: [] };
}

function normalizePriority(value: unknown): TaskPriority {
  return PRIORITIES.has(value as TaskPriority) ? (value as TaskPriority) : "medium";
}

function normalizeTask(record: Record<string, unknown>): Task {
  return {
    id: typeof record.id === "string" && record.id ? record.id : createId("task"),
    title: typeof record.title === "string" ? record.title.trim() : "",
    completed: Boolean(record.completed),
    priority: normalizePriority(record.priority),
    dueDate: typeof record.dueDate === "string" && record.dueDate ? record.dueDate : undefined,
    projectSlug: typeof record.projectSlug === "string" && record.projectSlug ? record.projectSlug : undefined,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : nowIso(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : nowIso(),
  };
}

async function loadStore(): Promise<TaskStore> {
  const data = await readJsonFile<unknown>(STORE, emptyStore());
  if (!data || typeof data !== "object" || !Array.isArray((data as TaskStore).tasks)) return emptyStore();
  return { tasks: (data as TaskStore).tasks.map((t) => normalizeTask(t as unknown as Record<string, unknown>)).filter((t) => t.title) };
}

async function saveStore(store: TaskStore): Promise<void> {
  await writeJsonFile(STORE, store);
}

export async function listTasks(): Promise<Task[]> {
  const store = await loadStore();
  return [...store.tasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const priorityOrder: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) return priorityOrder[a.priority] - priorityOrder[b.priority];
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

export async function createTask(input: TaskInput): Promise<Task> {
  const title = input.title?.trim();
  if (!title) throw new Error("待办标题不能为空。");
  const now = nowIso();
  const task: Task = {
    id: createId("task"),
    title,
    completed: false,
    priority: normalizePriority(input.priority),
    dueDate: typeof input.dueDate === "string" && input.dueDate ? input.dueDate : undefined,
    projectSlug: typeof input.projectSlug === "string" && input.projectSlug ? input.projectSlug : undefined,
    createdAt: now,
    updatedAt: now,
  };
  const store = await loadStore();
  store.tasks.push(task);
  await saveStore(store);
  return task;
}

export async function updateTask(id: string, patch: TaskPatch): Promise<Task> {
  if (!id) throw new Error("待办 id 不能为空。");
  const store = await loadStore();
  const index = store.tasks.findIndex((t) => t.id === id);
  if (index === -1) throw new Error("待办不存在。");
  const current = store.tasks[index];
  const updated: Task = {
    ...current,
    ...(patch.title !== undefined ? { title: patch.title.trim() || current.title } : {}),
    ...(patch.completed !== undefined ? { completed: Boolean(patch.completed) } : {}),
    ...(patch.priority !== undefined ? { priority: normalizePriority(patch.priority) } : {}),
    ...(patch.dueDate !== undefined ? { dueDate: typeof patch.dueDate === "string" && patch.dueDate ? patch.dueDate : undefined } : {}),
    ...(patch.projectSlug !== undefined ? { projectSlug: typeof patch.projectSlug === "string" && patch.projectSlug ? patch.projectSlug : undefined } : {}),
    updatedAt: nowIso(),
  };
  store.tasks[index] = updated;
  await saveStore(store);
  return updated;
}

export async function deleteTask(id: string): Promise<void> {
  if (!id) throw new Error("待办 id 不能为空。");
  const store = await loadStore();
  store.tasks = store.tasks.filter((t) => t.id !== id);
  await saveStore(store);
}
