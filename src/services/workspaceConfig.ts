import { access, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeJsonAtomicPath } from "./atomicJson.js";

const DEFAULT_OUTPUT_DIR = "output";
const WORKSPACE_CONFIG_PATH = path.resolve(process.cwd(), ".piance", "workspace.json");

export interface WorkspaceConfig {
  mode?: "project" | "external";
  relativePath?: string;
  absolutePath?: string;
  /** 0.1 早期版本写入的字段，读取时迁移为 absolutePath。 */
  outputDir?: string;
}

export interface WorkspaceStats {
  outputDir: string;
  outputDirAbsolute: string;
  projectCount: number;
  totalSizeBytes: number;
  totalSizeLabel: string;
  currentProjectName: string;
}

function expandHome(input: string): string {
  return input.replace(/^~(?=$|[\\/])/, os.homedir());
}

export function resolveWorkspaceOutputPath(config: WorkspaceConfig): string {
  if (config.mode === "external" && config.absolutePath) {
    return expandHome(config.absolutePath);
  }
  if (typeof config.outputDir === "string" && config.outputDir.trim()) {
    return path.resolve(process.cwd(), expandHome(config.outputDir.trim()));
  }
  return path.resolve(process.cwd(), config.relativePath || DEFAULT_OUTPUT_DIR);
}

function readWorkspaceConfigSync(): WorkspaceConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(WORKSPACE_CONFIG_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed as WorkspaceConfig : { mode: "project", relativePath: "output" };
  } catch {
    return { mode: "project", relativePath: "output" };
  }
}

async function readWorkspaceConfig(): Promise<WorkspaceConfig> {
  try {
    const parsed: unknown = JSON.parse(await readFile(WORKSPACE_CONFIG_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed as WorkspaceConfig : { mode: "project", relativePath: "output" };
  } catch {
    return { mode: "project", relativePath: "output" };
  }
}

export function getDefaultOutputDir(): string {
  return path.resolve(process.cwd(), DEFAULT_OUTPUT_DIR);
}

export function getOutputDirSync(): string {
  if (process.env.PIANCE_OUTPUT_DIR?.trim()) {
    return path.resolve(process.cwd(), expandHome(process.env.PIANCE_OUTPUT_DIR));
  }
  return resolveWorkspaceOutputPath(readWorkspaceConfigSync());
}

export async function getOutputDir(): Promise<string> {
  if (process.env.PIANCE_OUTPUT_DIR?.trim()) {
    return path.resolve(process.cwd(), expandHome(process.env.PIANCE_OUTPUT_DIR));
  }
  return resolveWorkspaceOutputPath(await readWorkspaceConfig());
}

export function formatWorkspacePath(target: string): string {
  const resolved = path.resolve(target);
  const defaultDir = getDefaultOutputDir();
  if (resolved === defaultDir) return "项目内 output/";
  const home = os.homedir();
  if (resolved === home) return "~";
  if (resolved.startsWith(`${home}${path.sep}`)) return `~/${path.relative(home, resolved)}`;
  return resolved;
}

export async function ensureOutputDir(outputDir = getOutputDirSync()): Promise<string> {
  const resolved = path.resolve(outputDir);
  try {
    await mkdir(resolved, { recursive: true });
    const probePath = path.join(resolved, `.piance-write-test-${process.pid}-${Date.now()}`);
    await writeFile(probePath, "ok", "utf8");
    await unlink(probePath);
    return resolved;
  } catch (error) {
    throw new Error(`输出目录不可用或不可写：${formatWorkspacePath(resolved)}`, { cause: error });
  }
}

export async function setOutputDir(absolutePath: string): Promise<string> {
  if (!absolutePath.trim()) throw new Error("输出目录不能为空。");
  const expanded = expandHome(absolutePath);
  const resolved = path.resolve(expanded);
  await ensureOutputDir(resolved);
  const config: WorkspaceConfig = { mode: "external", absolutePath: resolved };
  await writeJsonAtomicPath(WORKSPACE_CONFIG_PATH, config);
  return resolved;
}

export async function resetOutputDir(): Promise<string> {
  const resolved = getDefaultOutputDir();
  await ensureOutputDir(resolved);
  const config: WorkspaceConfig = { mode: "project", relativePath: "output" };
  await writeJsonAtomicPath(WORKSPACE_CONFIG_PATH, config);
  return resolved;
}

export async function calculateDirectorySize(directory: string): Promise<number> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const sizes = await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) return 0;
      if (entry.isDirectory()) return calculateDirectorySize(entryPath);
      if (entry.isFile()) return (await stat(entryPath)).size;
      return 0;
    }));
    return sizes.reduce((sum, size) => sum + size, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

export async function countProjectFolders(directory: string): Promise<number> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    // Hidden/system folders such as `.tmp` are workspace internals, not projects.
    return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export async function getWorkspaceStats(currentProjectName = "未创建"): Promise<WorkspaceStats> {
  const outputDir = await ensureOutputDir(await getOutputDir());
  const [projectCount, totalSizeBytes] = await Promise.all([
    countProjectFolders(outputDir),
    calculateDirectorySize(outputDir),
  ]);
  return {
    outputDir: formatWorkspacePath(outputDir),
    outputDirAbsolute: outputDir,
    projectCount,
    totalSizeBytes,
    totalSizeLabel: formatBytes(totalSizeBytes),
    currentProjectName,
  };
}

export function hasCustomWorkspaceConfig(): boolean {
  return existsSync(WORKSPACE_CONFIG_PATH);
}

export async function canAccessDirectory(directory: string): Promise<boolean> {
  try {
    await access(directory);
    return true;
  } catch {
    return false;
  }
}
