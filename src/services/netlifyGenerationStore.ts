import { getStore } from "@netlify/blobs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getOutputDir } from "./workspaceConfig.js";

/** Persistent state for the Netlify-only, asynchronous generation workflow. */
export interface PersistedGenerationJob {
  jobId: string;
  status: "idle" | "creating" | "generatingCore" | "generatingExecution" | "generatingPublishCopy" | "writing" | "paused" | "partial" | "completed" | "cancelled" | "failed";
  currentDocument: string;
  progress: number;
  message: string;
  cancelled: boolean;
  pauseRequested: boolean;
  resumeStatus?: PersistedGenerationJob["status"];
  timings: Array<{ label: string; durationMs: number }>;
  modelCalls: unknown[];
  generationProgress: Array<{ id: string; title: string; fileName: string; status: string; message?: string }>;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  durationLabel?: string;
  updatedAt: string;
  payload: Record<string, unknown>;
  sourceIdeaId?: string;
  dispatchToken?: string;
  result?: Record<string, unknown>;
}

const STORE_NAME = "piance";
const JOB_PREFIX = "generation-jobs/";
const PROJECT_PREFIX = "projects/";
const PROJECT_INDEX_PREFIX = "project-index/";

export function usesNetlifyPersistentGeneration(): boolean {
  return Boolean(process.env.SITE_ID || process.env.NETLIFY || process.env.NETLIFY_SITE_ID);
}

function store() {
  // Strong reads make progress polling and cancellation deterministic across
  // separate function instances.
  return getStore(STORE_NAME, { consistency: "strong" });
}

function jobKey(jobId: string): string {
  return `${JOB_PREFIX}${jobId}.json`;
}

export async function getPersistedGenerationJob(jobId: string): Promise<PersistedGenerationJob | null> {
  if (!jobId) return null;
  return (await store().get(jobKey(jobId), { type: "json", consistency: "strong" }) || null) as PersistedGenerationJob | null;
}

export async function putPersistedGenerationJob(job: PersistedGenerationJob): Promise<void> {
  job.updatedAt = new Date().toISOString();
  await store().setJSON(jobKey(job.jobId), job);
}

export async function updatePersistedGenerationJob(
  jobId: string,
  change: (current: PersistedGenerationJob) => PersistedGenerationJob,
): Promise<PersistedGenerationJob | null> {
  const current = await getPersistedGenerationJob(jobId);
  if (!current) return null;
  const next = change(current);
  await putPersistedGenerationJob(next);
  return next;
}

export function publicPersistedGenerationJob(job: PersistedGenerationJob) {
  const { payload: _payload, sourceIdeaId: _sourceIdeaId, dispatchToken: _dispatchToken, cancelled: _cancelled, pauseRequested: _pauseRequested, resumeStatus: _resumeStatus, result, ...publicJob } = job;
  const { status: resultStatus, ...resultFields } = result || {};
  return { ...publicJob, ...resultFields, ...(resultStatus ? { resultStatus } : {}) };
}

async function walkFiles(directory: string, relative = ""): Promise<string[]> {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(directory, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function readProjectIndex(): Promise<string[]> {
  const listed = await store().list({ prefix: PROJECT_INDEX_PREFIX, paginate: false });
  return listed.blobs
    .map(({ key }) => key.slice(PROJECT_INDEX_PREFIX.length))
    .filter((slug) => slug && slug === path.basename(slug))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

/** Uploads a fully-generated project before the background function exits. */
export async function persistProjectDirectory(projectDirectory: string): Promise<void> {
  const slug = path.basename(projectDirectory);
  const files = await walkFiles(projectDirectory);
  await Promise.all(files.map(async (relative) => {
    const bytes = await readFile(path.join(projectDirectory, relative));
    await store().set(`${PROJECT_PREFIX}${slug}/${relative.split(path.sep).join("/")}`, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }));
  // One marker per project avoids a shared index write race when two users
  // finish generation at nearly the same time.
  await store().set(`${PROJECT_INDEX_PREFIX}${slug}`, new Date().toISOString());
}

export async function persistProjectBySlug(slug: string): Promise<void> {
  if (!slug || slug !== path.basename(slug)) throw new Error("项目标识无效。");
  await persistProjectDirectory(path.join(await getOutputDir(), slug));
}

/** Restores a persisted project into this invocation's temporary working directory. */
export async function hydrateProjectDirectory(slug: string): Promise<boolean> {
  if (!slug || slug !== path.basename(slug)) throw new Error("项目标识无效。");
  const outputDir = await getOutputDir();
  const directory = path.join(outputDir, slug);
  const prefix = `${PROJECT_PREFIX}${slug}/`;
  const listed = await store().list({ prefix, paginate: false });
  if (!listed.blobs.length) return false;
  await rm(directory, { recursive: true, force: true });
  await Promise.all(listed.blobs.map(async ({ key }) => {
    const relative = key.slice(prefix.length);
    if (!relative || relative !== path.normalize(relative) || relative.startsWith("..")) return;
    const bytes = await store().get(key, { type: "arrayBuffer", consistency: "strong" });
    const target = path.join(directory, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(bytes));
  }));
  return true;
}

export async function hydrateAllPersistedProjects(): Promise<void> {
  for (const slug of await readProjectIndex()) await hydrateProjectDirectory(slug);
}
