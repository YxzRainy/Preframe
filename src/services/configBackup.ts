import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectArchiveFiles, validateArchiveFiles, writeArchiveFiles, type PortableArchiveFile } from "./portableArchive.js";

export interface ConfigBackupV1 {
  kind: "preframe-config";
  version: 1;
  exportedAt: string;
  secretsIncluded: boolean;
  files: PortableArchiveFile[];
}

const EXCLUDED_PREFIXES = ["trash/", "backups/", "browser-profiles/", "publisher-browser/"];

function dataDir(): string {
  return process.env.PIANCE_DATA_DIR?.trim() ? path.resolve(process.env.PIANCE_DATA_DIR) : path.resolve(process.cwd(), ".piance");
}

function included(relativePath: string): boolean {
  if (relativePath === "diagnostics.jsonl") return false;
  if (EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return false;
  return relativePath.endsWith(".json") || relativePath.startsWith("profile/");
}

export async function createConfigBackup(includeSecrets = false): Promise<ConfigBackupV1> {
  await mkdir(dataDir(), { recursive: true });
  let files = await collectArchiveFiles(dataDir(), included);
  if (!includeSecrets) {
    files = await Promise.all(files.map(async (file) => {
      if (file.path !== "model-config.json") return file;
      const parsed = JSON.parse(Buffer.from(file.contentBase64, "base64").toString("utf8")) as Record<string, unknown>;
      if ("apiKey" in parsed) parsed.apiKey = "__PREFRAME_REDACTED__";
      const content = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      const { sha256 } = await import("./portableArchive.js");
      return { path: file.path, size: content.byteLength, sha256: sha256(content), contentBase64: content.toString("base64") };
    }));
  }
  return { kind: "preframe-config", version: 1, exportedAt: new Date().toISOString(), secretsIncluded: includeSecrets, files };
}

async function preservedApiKey(): Promise<string> {
  try {
    const parsed = JSON.parse(await readFile(path.join(dataDir(), "model-config.json"), "utf8")) as Record<string, unknown>;
    return typeof parsed.apiKey === "string" ? parsed.apiKey : "";
  } catch {
    return "";
  }
}

export async function restoreConfigBackup(input: unknown): Promise<{ restoredFiles: number; rollbackBackupPath: string }> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("配置备份格式无效。");
  const archive = input as Record<string, unknown>;
  if (archive.kind !== "preframe-config" || archive.version !== 1) throw new Error("不支持的配置备份版本。");
  const files = validateArchiveFiles(archive.files);
  const rollbackBackupPath = await writeInternalBackup("before-restore");
  const currentKey = await preservedApiKey();
  const prepared = (await Promise.all(files.map(async (file) => {
    if (file.path !== "model-config.json") return file;
    const parsed = JSON.parse(Buffer.from(file.contentBase64, "base64").toString("utf8")) as Record<string, unknown>;
    if (parsed.apiKey === "__PREFRAME_REDACTED__" && !currentKey) return null;
    if (parsed.apiKey === "__PREFRAME_REDACTED__") parsed.apiKey = currentKey;
    const content = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    const { sha256 } = await import("./portableArchive.js");
    return { path: file.path, size: content.byteLength, sha256: sha256(content), contentBase64: content.toString("base64") };
  }))).filter((file): file is PortableArchiveFile => Boolean(file));

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
  await writeFile(target, `${JSON.stringify(backup, null, 2)}\n`, "utf8");
  return target;
}
