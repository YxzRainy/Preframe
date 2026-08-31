import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "./runtimePaths.js";
import { collectArchiveFiles, validateArchiveFiles, writeArchiveFiles, type PortableArchiveFile } from "./portableArchive.js";

export interface ConfigBackupV1 {
  kind: "preframe-config";
  version: 1;
  exportedAt: string;
  secretsIncluded: boolean;
  files: PortableArchiveFile[];
}

const EXCLUDED_PREFIXES = ["trash/", "backups/", "browser-profiles/"];

function dataDir(): string {
  return getDataDir();
}

function included(relativePath: string): boolean {
  if (relativePath === "diagnostics.jsonl" || relativePath === "model-config.json") return false;
  if (EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return false;
  return relativePath.endsWith(".json") || relativePath.startsWith("profile/");
}

export async function createConfigBackup(includeSecrets = false): Promise<ConfigBackupV1> {
  await mkdir(dataDir(), { recursive: true });
  const files = await collectArchiveFiles(dataDir(), included);
  return { kind: "preframe-config", version: 1, exportedAt: new Date().toISOString(), secretsIncluded: includeSecrets, files };
}

export async function restoreConfigBackup(input: unknown): Promise<{ restoredFiles: number; rollbackBackupPath: string }> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("配置备份格式无效。");
  const archive = input as Record<string, unknown>;
  if (archive.kind !== "preframe-config" || archive.version !== 1) throw new Error("不支持的配置备份版本。");
  const files = validateArchiveFiles(archive.files);
  const rollbackBackupPath = await writeInternalBackup("before-restore");
  const prepared: PortableArchiveFile[] = files;

  const staging = path.join(dataDir(), `.restore-${process.pid}-${Date.now()}`);
  try {
    await mkdir(staging, { recursive: true });
    await writeArchiveFiles(staging, prepared);
    for (const file of prepared) {
      const source = path.join(staging, file.path);
      const target = path.join(dataDir(), file.path);
      await mkdir(path.dirname(target), { recursive: true });
      const tempTarget = `${target}.restore-${process.pid}`;
      await writeFile(tempTarget, await readFile(source));
      await rename(tempTarget, target);
    }
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
  return { restoredFiles: prepared.length, rollbackBackupPath };
}

export async function writeInternalBackup(label: string): Promise<string> {
  const backup = await createConfigBackup(true);
  const directory = path.join(dataDir(), "backups");
  await mkdir(directory, { recursive: true });
  const safeLabel = label.replace(/[^a-z0-9_-]+/giu, "-").replace(/^-+|-+$/gu, "") || "backup";
  const target = path.join(directory, `${safeLabel}-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`);
  await writeFile(target, `${JSON.stringify(backup, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return target;
}
