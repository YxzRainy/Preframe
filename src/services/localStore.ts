/** 本地 JSON 文件存储 - 给灵感等轻量本地数据使用 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "./runtimePaths.js";
import { writeJsonAtomicPath } from "./atomicJson.js";

function dataDir(): string {
  return getDataDir();
}

function filePath(name: string): string {
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`无效的本地数据文件名：${name}`);
  return path.join(dataDir(), `${name}.json`);
}

export async function readJsonFile<T>(name: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath(name), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return (parsed && typeof parsed === "object" ? parsed : fallback) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJsonFile<T>(name: string, data: T): Promise<void> {
  await writeJsonAtomicPath(filePath(name), data);
}

export function createId(prefix: string): string {
  const rand = Math.random().toString(16).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
