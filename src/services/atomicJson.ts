/** 原子 JSON 文件读写 — 写入临时文件后 rename，避免文件写坏 */

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

function dataDir(): string {
  return process.env.PIANCE_DATA_DIR?.trim()
    ? path.resolve(process.env.PIANCE_DATA_DIR)
    : path.resolve(process.cwd(), ".piance");
}

function filePath(name: string): string {
  if (!/^[a-z0-9_.-]+$/i.test(name)) throw new Error(`无效的本地数据文件名：${name}`);
  return path.join(dataDir(), `${name}`);
}

export async function readAtomicJson<T>(name: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath(name), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return (parsed && typeof parsed === "object" ? parsed : fallback) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeAtomicJson<T>(name: string, data: T): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  const target = filePath(name);
  await writeJsonAtomicPath(target, data);
}

export async function writeJsonAtomicPath<T>(target: string, data: T): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  // 临时文件名加入随机数，避免同进程同毫秒并发写入时撞名
  const rand = Math.random().toString(16).slice(2, 10);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${rand}`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  try {
    await rename(tmp, target);
  } catch (error) {
    try { await unlink(tmp); } catch { /* ignore */ }
    throw error;
  }
}

export function createId(prefix: string): string {
  const rand = Math.random().toString(16).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
