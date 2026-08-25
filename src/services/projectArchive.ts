import { readFile } from "node:fs/promises";
import path from "node:path";
import { collectArchiveFiles, validateArchiveFiles, writeArchiveFiles, type PortableArchiveFile } from "./portableArchive.js";
import { createTempProjectDirectory, finalizeTempProjectDirectory, removeTempProjectDirectory, resolveProjectDirectory } from "./projectManager.js";

export interface ProjectArchiveV1 {
  kind: "preframe-project";
  version: 1;
  exportedAt: string;
  sourceSlug: string;
  files: PortableArchiveFile[];
}

export async function exportProjectArchive(slug: string): Promise<ProjectArchiveV1> {
  const projectDir = resolveProjectDirectory(slug);
  return {
    kind: "preframe-project",
    version: 1,
    exportedAt: new Date().toISOString(),
    sourceSlug: path.basename(projectDir),
    files: await collectArchiveFiles(projectDir, (relativePath) => !relativePath.startsWith(".tmp/")),
  };
}

export async function importProjectArchive(input: unknown): Promise<{ slug: string; fileCount: number }> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("项目归档格式无效。");
  const archive = input as Record<string, unknown>;
  if (archive.kind !== "preframe-project" || archive.version !== 1) throw new Error("不支持的项目归档版本。");
  const files = validateArchiveFiles(archive.files);
  if (!files.some((file) => file.path === "project.json")) throw new Error("项目归档缺少 project.json。");
  const sourceSlug = typeof archive.sourceSlug === "string" && archive.sourceSlug.trim() ? archive.sourceSlug : "imported-project";
  const tempDir = await createTempProjectDirectory(`import_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`);
  try {
    await writeArchiveFiles(tempDir, files);
    JSON.parse(await readFile(path.join(tempDir, "project.json"), "utf8")) as Record<string, unknown>;
    const projectDir = await finalizeTempProjectDirectory(tempDir, sourceSlug);
    return { slug: path.basename(projectDir), fileCount: files.length };
  } catch (error) {
    await removeTempProjectDirectory(tempDir).catch(() => undefined);
    throw error;
  }
}
