import { accessSync } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeFilename } from "../utils/sanitizeFilename.js";
import { ensureOutputDir, getDefaultOutputDir, getOutputDirSync } from "./workspaceConfig.js";
import { getDataDir } from "./runtimePaths.js";

export interface ProjectInfo {
  name: string;
  path: string;
}

const TRASH_MARKER = ".preframe-trash.json";

function trashDir(): string {
  return path.join(getDataDir(), "trash");
}

export interface TrashProjectInfo {
  id: string;
  originalSlug: string;
  name: string;
  deletedAt: string;
  sizeBytes: number;
}

function uniqueProjectRoots(): string[] {
  const primary = getOutputDirSync();
  const legacy = getDefaultOutputDir();
  return [primary, legacy].filter((root, index, roots) => roots.indexOf(root) === index);
}

/** 安全解析项目 slug，禁止通过路径穿越访问 output 之外的文件。 */
export function resolveProjectDirectory(slug: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    throw new Error("项目标识格式无效。");
  }
  if (!decoded || decoded !== path.basename(decoded) || decoded === "." || decoded === "..") {
    throw new Error("项目标识无效。");
  }
  const [primary, ...fallbacks] = uniqueProjectRoots();
  const primaryResolved = path.resolve(primary, decoded);
  if (path.dirname(primaryResolved) !== primary) throw new Error("项目标识无效。");
  for (const root of [primary, ...fallbacks]) {
    const resolved = path.resolve(root, decoded);
    if (path.dirname(resolved) !== root) throw new Error("项目标识无效。");
    if (existsSyncSafe(resolved)) return resolved;
  }
  return primaryResolved;
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function existsSyncSafe(target: string): boolean {
  try {
    return Boolean(path.basename(target)) && requireAccessSync(target);
  } catch {
    return false;
  }
}

function requireAccessSync(target: string): boolean {
  try {
    accessSync(target);
    return true;
  } catch {
    return false;
  }
}

/** 创建不覆盖旧内容的项目目录；重名时自动追加序号。 */
export async function createProjectDirectory(projectNameOrTopic: string): Promise<string> {
  const outputDir = await ensureOutputDir();
  const baseName = sanitizeFilename(projectNameOrTopic);
  let candidate = path.join(outputDir, baseName);
  let suffix = 2;
  while (await exists(candidate)) {
    candidate = path.join(outputDir, `${baseName}_${suffix++}`);
  }
  await mkdir(candidate, { recursive: true });
  return candidate;
}

export async function createTempProjectDirectory(jobId: string): Promise<string> {
  const outputDir = await ensureOutputDir();
  const safeJobId = sanitizeFilename(jobId, `job_${Date.now()}`);
  const tmpRoot = path.join(outputDir, ".tmp");
  const tmpDir = path.join(tmpRoot, safeJobId);
  await mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

export async function removeTempProjectDirectory(tempDir: string): Promise<void> {
  const outputDir = await ensureOutputDir();
  const tmpRoot = path.join(outputDir, ".tmp");
  const resolved = path.resolve(tempDir);
  if (resolved !== tmpRoot && !resolved.startsWith(`${tmpRoot}${path.sep}`)) {
    throw new Error("临时目录不在 output/.tmp 内，已拒绝清理。");
  }
  await rm(resolved, { recursive: true, force: true });
}

export async function finalizeTempProjectDirectory(tempDir: string, projectNameOrTopic: string): Promise<string> {
  const outputDir = await ensureOutputDir();
  const tmpRoot = path.join(outputDir, ".tmp");
  const resolvedTemp = path.resolve(tempDir);
  if (!resolvedTemp.startsWith(`${tmpRoot}${path.sep}`)) {
    throw new Error("临时目录不在 output/.tmp 内，无法发布项目。");
  }
  const baseName = sanitizeFilename(projectNameOrTopic);
  let candidate = path.join(outputDir, baseName);
  let suffix = 2;
  while (await exists(candidate)) {
    candidate = path.join(outputDir, `${baseName}_${suffix++}`);
  }
  await rename(resolvedTemp, candidate);
  return candidate;
}

export async function listProjects(): Promise<ProjectInfo[]> {
  const roots = uniqueProjectRoots();
  await ensureOutputDir(roots[0]);
  const seen = new Set<string>();
  const projects: ProjectInfo[] = [];
  for (const root of roots) {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === ".tmp" || seen.has(entry.name)) continue;
        seen.add(entry.name);
        projects.push({ name: entry.name, path: path.join(root, entry.name) });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export async function moveProjectToTrash(slug: string): Promise<{ trashPath: string }> {
  const projectDir = resolveProjectDirectory(slug);
  let projectStat;
  try {
    projectStat = await stat(projectDir);
  } catch (error) {
    const notFound = new Error(`项目不存在：${slug}`, { cause: error });
    notFound.name = "ProjectNotFoundError";
    throw notFound;
  }
  if (!projectStat.isDirectory()) throw new Error("项目目录无效。");

  const trashRoot = trashDir();
  await mkdir(trashRoot, { recursive: true });
  const projectName = path.basename(projectDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  let trashPath = path.join(trashRoot, `${projectName}_${timestamp}`);
  let suffix = 2;
  while (await exists(trashPath)) {
    trashPath = path.join(trashRoot, `${projectName}_${timestamp}_${suffix++}`);
  }

  try {
    await rename(projectDir, trashPath);
    await writeFile(path.join(trashPath, TRASH_MARKER), `${JSON.stringify({ originalSlug: projectName, deletedAt: new Date().toISOString() }, null, 2)}\n`, "utf8").catch(() => undefined);
    return { trashPath };
  } catch (error) {
    throw new Error("项目移动到回收站失败，请检查目录权限后重试。", { cause: error });
  }
}

function validateTrashId(id: string): string {
  if (!id || id !== path.basename(id) || id === "." || id === "..") throw new Error("回收站项目标识无效。");
  return id;
}

function legacyOriginalSlug(id: string): string {
  return id.replace(/_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:_\d+)?$/u, "") || id;
}

async function readTrashMetadata(directory: string, id: string): Promise<{ originalSlug: string; deletedAt: string; name: string }> {
  let originalSlug = legacyOriginalSlug(id);
  let deletedAt = (await stat(directory)).mtime.toISOString();
  try {
    const marker = JSON.parse(await readFile(path.join(directory, TRASH_MARKER), "utf8")) as Record<string, unknown>;
    if (typeof marker.originalSlug === "string" && marker.originalSlug.trim()) originalSlug = marker.originalSlug;
    if (typeof marker.deletedAt === "string" && marker.deletedAt.trim()) deletedAt = marker.deletedAt;
  } catch { /* legacy trash entries do not have a marker */ }
  let name = originalSlug;
  try {
    const metadata = JSON.parse(await readFile(path.join(directory, "project.json"), "utf8")) as Record<string, unknown>;
    if (typeof metadata.projectName === "string" && metadata.projectName.trim()) name = metadata.projectName;
    else if (typeof metadata.topic === "string" && metadata.topic.trim()) name = metadata.topic;
  } catch { /* keep directory-derived name */ }
  return { originalSlug, deletedAt, name };
}

export async function listTrashProjects(): Promise<TrashProjectInfo[]> {
  let entries;
  const trashRoot = trashDir();
  try { entries = await readdir(trashRoot, { withFileTypes: true }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const projects = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const directory = path.join(trashRoot, entry.name);
    const metadata = await readTrashMetadata(directory, entry.name);
    return {
      id: entry.name,
      ...metadata,
      sizeBytes: await calculateTrashSize(directory),
    };
  }));
  return projects.sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));
}

async function calculateTrashSize(directory: string): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sizes = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return 0;
    if (entry.isDirectory()) return calculateTrashSize(target);
    return entry.isFile() ? (await stat(target)).size : 0;
  }));
  return sizes.reduce((sum, size) => sum + size, 0);
}

export async function restoreProjectFromTrash(id: string): Promise<{ slug: string }> {
  const safeId = validateTrashId(id);
  const source = path.join(trashDir(), safeId);
  let sourceStat;
  try { sourceStat = await stat(source); } catch (error) {
    const notFound = new Error(`回收站项目不存在：${safeId}`, { cause: error });
    notFound.name = "ProjectNotFoundError";
    throw notFound;
  }
  if (!sourceStat.isDirectory()) throw new Error("回收站项目目录无效。");
  const metadata = await readTrashMetadata(source, safeId);
  const outputDir = await ensureOutputDir();
  const baseName = sanitizeFilename(metadata.originalSlug, "restored-project");
  let slug = baseName;
  let destination = path.join(outputDir, slug);
  let suffix = 2;
  while (await exists(destination)) {
    slug = `${baseName}_${suffix++}`;
    destination = path.join(outputDir, slug);
  }
  await rename(source, destination);
  await rm(path.join(destination, TRASH_MARKER), { force: true });
  return { slug };
}
