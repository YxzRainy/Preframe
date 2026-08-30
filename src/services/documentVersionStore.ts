import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectDirectory } from "./projectManager.js";
import { writeMarkdown } from "./fileWriter.js";

export type DocumentVersionReason = "generated" | "regenerate" | "refine-source" | "refine-result" | "auto-repair" | "manual-save" | "rollback" | "workflow-migration";

export interface DocumentVersion {
  id: string;
  fileName: string;
  createdAt: string;
  reason: DocumentVersionReason;
  content: string;
}

export interface DocumentVersionSummary extends Omit<DocumentVersion, "content"> {
  current?: boolean;
  size: number;
}

function assertFileName(fileName: string): void {
  if (!fileName.endsWith(".md") || fileName !== path.basename(fileName)) throw new Error("Markdown 文件名无效。");
}

function versionDir(projectDir: string, fileName: string): string {
  const encoded = Buffer.from(fileName, "utf8").toString("base64url");
  return path.join(projectDir, ".versions", encoded);
}

export async function archiveDocumentVersion(
  projectSlug: string,
  fileName: string,
  content: string,
  reason: DocumentVersionReason,
): Promise<DocumentVersion> {
  assertFileName(fileName);
  const projectDir = resolveProjectDirectory(projectSlug);
  const directory = versionDir(projectDir, fileName);
  await mkdir(directory, { recursive: true });
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/g, "-")}_${Math.random().toString(16).slice(2, 8)}`;
  const version: DocumentVersion = { id, fileName, createdAt, reason, content };
  await writeFile(path.join(directory, `${id}.json`), `${JSON.stringify(version, null, 2)}\n`, "utf8");
  return version;
}

async function storedVersions(projectSlug: string, fileName: string): Promise<DocumentVersion[]> {
  assertFileName(fileName);
  const directory = versionDir(resolveProjectDirectory(projectSlug), fileName);
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const versions = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => JSON.parse(await readFile(path.join(directory, entry.name), "utf8")) as DocumentVersion));
    return versions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function listDocumentVersions(projectSlug: string, fileName: string): Promise<DocumentVersionSummary[]> {
  const projectDir = resolveProjectDirectory(projectSlug);
  const currentContent = await readFile(path.join(projectDir, fileName), "utf8").catch(() => "");
  const archived = await storedVersions(projectSlug, fileName);
  const summaries: DocumentVersionSummary[] = archived.map(({ content, ...version }) => ({ ...version, size: content.length }));
  if (currentContent) {
    summaries.unshift({ id: "current", fileName, createdAt: new Date().toISOString(), reason: "generated", current: true, size: currentContent.length });
  }
  return summaries;
}

export async function readDocumentVersion(projectSlug: string, fileName: string, versionId: string): Promise<string> {
  assertFileName(fileName);
  const projectDir = resolveProjectDirectory(projectSlug);
  if (versionId === "current") return readFile(path.join(projectDir, fileName), "utf8");
  if (!/^[A-Za-z0-9_-]+$/u.test(versionId)) throw new Error("版本标识无效。");
  const parsed = JSON.parse(await readFile(path.join(versionDir(projectDir, fileName), `${versionId}.json`), "utf8")) as DocumentVersion;
  if (parsed.fileName !== fileName || typeof parsed.content !== "string") throw new Error("版本内容无效。");
  return parsed.content;
}

export function lineDiff(before: string, after: string): string {
  const left = before.replace(/\r\n/g, "\n").split("\n");
  const right = after.replace(/\r\n/g, "\n").split("\n");
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix += 1;
  const contextBefore = left.slice(Math.max(0, prefix - 3), prefix).map((line) => `  ${line}`);
  const removed = left.slice(prefix, left.length - suffix).map((line) => `- ${line}`);
  const added = right.slice(prefix, right.length - suffix).map((line) => `+ ${line}`);
  const contextAfter = suffix ? left.slice(left.length - suffix, Math.min(left.length, left.length - suffix + 3)).map((line) => `  ${line}`) : [];
  return [...contextBefore, ...removed, ...added, ...contextAfter].join("\n") || "两版内容一致。";
}

export async function rollbackDocumentVersion(projectSlug: string, fileName: string, versionId: string): Promise<void> {
  const projectDir = resolveProjectDirectory(projectSlug);
  const current = await readFile(path.join(projectDir, fileName), "utf8");
  const target = await readDocumentVersion(projectSlug, fileName, versionId);
  if (current === target) return;
  await archiveDocumentVersion(projectSlug, fileName, current, "rollback");
  await writeMarkdown(path.join(projectDir, fileName), target);
}
