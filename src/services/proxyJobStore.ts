/** Proxy 任务持久化 — .piance/proxy-jobs.json，原子写入
 * 队列 / 进度 / 成功 / 失败 / 取消 / 重试 全部持久化，刷新不丢。
 * 并发安全：2 个 ffmpeg 同时完成时，读-改-写操作通过进程内互斥锁串行化，避免丢失更新。 */

import { createId, nowIso, readAtomicJson, writeAtomicJson } from "./atomicJson.js";
import type { ProxyJob, ProxyPreset, ProxyStatus } from "../types/editingManifest.js";

const FILE_NAME = "proxy-jobs.json";

interface ProxyJobsStoreData {
  jobs: ProxyJob[];
  updatedAt: string;
}

// 进程内互斥锁：串行化读-改-写，避免并发 updateJob 丢失更新
let lockChain: Promise<unknown> = Promise.resolve();
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lockChain.then(fn, fn);
  // 锁链不承载错误，单个操作失败不影响后续
  lockChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function readProxyJobs(): Promise<ProxyJob[]> {
  const data = await readAtomicJson<ProxyJobsStoreData>(FILE_NAME, {
    jobs: [],
    updatedAt: nowIso(),
  });
  return Array.isArray(data.jobs) ? (data.jobs as ProxyJob[]) : [];
}

export async function writeProxyJobs(jobs: ProxyJob[]): Promise<void> {
  await writeAtomicJson<ProxyJobsStoreData>(FILE_NAME, { jobs, updatedAt: nowIso() });
}

export async function getJob(id: string): Promise<ProxyJob | undefined> {
  const jobs = await readProxyJobs();
  return jobs.find((j) => j.id === id);
}

export async function getJobsForProject(projectSlug: string): Promise<ProxyJob[]> {
  const jobs = await readProxyJobs();
  return jobs.filter((j) => j.projectSlug === projectSlug);
}

/** 活跃任务（queued / generating） */
export async function getActiveJobs(): Promise<ProxyJob[]> {
  const jobs = await readProxyJobs();
  return jobs.filter((j) => j.status === "queued" || j.status === "generating");
}

/** 按 cacheKey 查找已完成的 job（用于复用 proxy） */
export async function findByCacheKey(cacheKey: string): Promise<ProxyJob | undefined> {
  const jobs = await readProxyJobs();
  return jobs.find((j) => j.cacheKey === cacheKey && j.status === "ready");
}

export async function addJob(input: {
  projectSlug: string;
  assetId: string;
  sourcePath: string;
  preset: ProxyPreset;
  proxyPath: string;
  cacheKey: string;
}): Promise<ProxyJob> {
  return withLock(async () => {
    const jobs = await readProxyJobs();
    const job: ProxyJob = {
      id: createId("proxy"),
      projectSlug: input.projectSlug,
      assetId: input.assetId,
      sourcePath: input.sourcePath,
      preset: input.preset,
      status: "queued",
      progress: 0,
      proxyPath: input.proxyPath,
      cacheKey: input.cacheKey,
      createdAt: nowIso(),
    };
    jobs.push(job);
    await writeProxyJobs(jobs);
    return job;
  });
}

export async function updateJob(id: string, patch: Partial<ProxyJob>): Promise<ProxyJob | undefined> {
  return withLock(async () => {
    const jobs = await readProxyJobs();
    const idx = jobs.findIndex((j) => j.id === id);
    if (idx < 0) return undefined;
    jobs[idx] = { ...jobs[idx], ...patch };
    await writeProxyJobs(jobs);
    return jobs[idx];
  });
}

/** 重置任务为 queued 以便重试 */
export async function resetJobForRetry(id: string): Promise<ProxyJob | undefined> {
  return updateJob(id, {
    status: "queued",
    progress: 0,
    errorMessage: undefined,
    startedAt: undefined,
    finishedAt: undefined,
  });
}

export async function removeJob(id: string): Promise<void> {
  return withLock(async () => {
    const jobs = await readProxyJobs();
    await writeProxyJobs(jobs.filter((j) => j.id !== id));
  });
}

export function isTerminalStatus(status: ProxyStatus): boolean {
  return status === "ready" || status === "failed";
}
