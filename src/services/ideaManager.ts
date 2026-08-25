/** 灵感收件箱 — 轻量本地记录，不调用模型 */

import { createId, nowIso, readJsonFile, writeJsonFile } from "./localStore.js";
import type { Idea, IdeaInput, IdeaPatch } from "../types/idea.js";

const STORE = "ideas";

interface IdeaStore {
  ideas: Idea[];
}

function emptyStore(): IdeaStore {
  return { ideas: [] };
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((t) => (typeof t === "string" ? t.trim() : "")).filter(Boolean);
}

function normalizeIdea(record: Record<string, unknown>): Idea {
  return {
    id: typeof record.id === "string" && record.id ? record.id : createId("idea"),
    title: typeof record.title === "string" ? record.title.trim() : "",
    note: typeof record.note === "string" ? record.note.trim() : undefined,
    source: typeof record.source === "string" ? record.source.trim() : undefined,
    tags: normalizeTags(record.tags),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : nowIso(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : nowIso(),
    convertedProjectSlug: typeof record.convertedProjectSlug === "string" && record.convertedProjectSlug ? record.convertedProjectSlug : undefined,
  };
}

async function loadStore(): Promise<IdeaStore> {
  const data = await readJsonFile<unknown>(STORE, emptyStore());
  if (!data || typeof data !== "object" || !Array.isArray((data as IdeaStore).ideas)) return emptyStore();
  return { ideas: (data as IdeaStore).ideas.map((i) => normalizeIdea(i as unknown as Record<string, unknown>)).filter((i) => i.title) };
}

async function saveStore(store: IdeaStore): Promise<void> {
  await writeJsonFile(STORE, store);
}

export async function listIdeas(): Promise<Idea[]> {
  const store = await loadStore();
  return [...store.ideas].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function createIdea(input: IdeaInput): Promise<Idea> {
  const title = input.title?.trim();
  if (!title) throw new Error("灵感标题不能为空。");
  const now = nowIso();
  const idea: Idea = {
    id: createId("idea"),
    title,
    note: typeof input.note === "string" ? input.note.trim() || undefined : undefined,
    source: typeof input.source === "string" ? input.source.trim() || undefined : undefined,
    tags: normalizeTags(input.tags),
    createdAt: now,
    updatedAt: now,
  };
  const store = await loadStore();
  store.ideas.push(idea);
  await saveStore(store);
  return idea;
}

export async function updateIdea(id: string, patch: IdeaPatch): Promise<Idea> {
  if (!id) throw new Error("灵感 id 不能为空。");
  const store = await loadStore();
  const index = store.ideas.findIndex((i) => i.id === id);
  if (index === -1) throw new Error("灵感不存在。");
  const current = store.ideas[index];
  const updated: Idea = {
    ...current,
    ...(patch.title !== undefined ? { title: patch.title.trim() || current.title } : {}),
    ...(patch.note !== undefined ? { note: typeof patch.note === "string" ? patch.note.trim() || undefined : undefined } : {}),
    ...(patch.source !== undefined ? { source: typeof patch.source === "string" ? patch.source.trim() || undefined : undefined } : {}),
    ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {}),
    ...(patch.convertedProjectSlug !== undefined ? { convertedProjectSlug: typeof patch.convertedProjectSlug === "string" && patch.convertedProjectSlug ? patch.convertedProjectSlug : undefined } : {}),
    updatedAt: nowIso(),
  };
  store.ideas[index] = updated;
  await saveStore(store);
  return updated;
}

export async function deleteIdea(id: string): Promise<void> {
  if (!id) throw new Error("灵感 id 不能为空。");
  const store = await loadStore();
  store.ideas = store.ideas.filter((i) => i.id !== id);
  await saveStore(store);
}

/** 标记灵感已转换为项目 */
export async function markIdeaConverted(id: string, projectSlug: string): Promise<Idea> {
  return updateIdea(id, { convertedProjectSlug: projectSlug });
}
