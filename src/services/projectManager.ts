import { accessSync } from "node:fs";
import { access, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { sanitizeFilename } from "../utils/sanitizeFilename.js";
import { ensureOutputDir, getDefaultOutputDir, getOutputDirSync } from "./workspaceConfig.js";

export interface ProjectInfo {
  name: string;
  path: string;
}

const TRASH_DIR = path.resolve(process.cwd(), ".piance", "trash");

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

  await mkdir(TRASH_DIR, { recursive: true });
  const projectName = path.basename(projectDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  let trashPath = path.join(TRASH_DIR, `${projectName}_${timestamp}`);
  let suffix = 2;
  while (await exists(trashPath)) {
    trashPath = path.join(TRASH_DIR, `${projectName}_${timestamp}_${suffix++}`);
  }

  try {
    await rename(projectDir, trashPath);
    return { trashPath };
  } catch (error) {
    throw new Error("项目移动到回收站失败，请检查目录权限后重试。", { cause: error });
  }
}
