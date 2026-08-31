import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "./runtimePaths.js";
import { resolveContentProfile } from "../utils/contentProfile.js";
import { inferStage, PROJECT_STAGE_ORDER } from "./projectStage.js";
import { getOutputDir } from "./workspaceConfig.js";
import { writeInternalBackup } from "./configBackup.js";

export const CURRENT_DATA_SCHEMA_VERSION = 1;

export interface MigrationReport {
  currentVersion: number;
  targetVersion: number;
  scannedProjects: number;
  pendingProjects: number;
  migratedProjects: number;
  backupPath?: string;
  changes: Array<{ project: string; fields: string[] }>;
}

function dataDir(): string {
  return getDataDir();
}

async function projectJsonPaths(): Promise<string[]> {
  const roots = [await getOutputDir(), path.join(dataDir(), "trash")];
  const result: string[] = [];
  for (const root of roots) {
    let entries;
    try { entries = await readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".tmp") continue;
      const candidate = path.join(root, entry.name, "project.json");
      try { if ((await stat(candidate)).isFile()) result.push(candidate); } catch { /* project metadata is optional */ }
    }
  }
  return result;
}

async function writeMigrationBackup(paths: string[]): Promise<string> {
  const directory = path.join(dataDir(), "backups");
  await mkdir(directory, { recursive: true });
  const entries = await Promise.all(paths.map(async (file) => ({
    path: file,
    contentBase64: (await readFile(file)).toString("base64"),
  })));
  const target = path.join(directory, `before-migration-projects-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`);
  await writeFile(target, `${JSON.stringify({ kind: "preframe-migration-backup", version: 1, createdAt: new Date().toISOString(), entries }, null, 2)}\n`, "utf8");
  return target;
}

function migrateMetadata(metadata: Record<string, unknown>, directoryName: string): { data: Record<string, unknown>; fields: string[] } {
  const next = { ...metadata };
  const fields: string[] = [];
  if (typeof next.projectName !== "string" || !next.projectName.trim()) {
    next.projectName = typeof next.topic === "string" && next.topic.trim() ? next.topic.trim() : directoryName;
    fields.push("projectName");
  }
  const profile = resolveContentProfile(next);
  if (typeof next.contentSubject !== "string" || !next.contentSubject.trim()) {
    next.contentSubject = profile.contentSubject || "未记录";
    fields.push("contentSubject");
  }
  if (typeof next.contentDomain !== "string") {
    next.contentDomain = profile.contentDomain;
    fields.push("contentDomain");
  }
  if (typeof next.stage !== "string" || !(PROJECT_STAGE_ORDER as string[]).includes(next.stage)) {
    next.stage = inferStage(next);
    next.stageUpdatedAt = typeof next.stageUpdatedAt === "string" ? next.stageUpdatedAt : new Date().toISOString();
    fields.push("stage");
  }
  if (next.schemaVersion !== CURRENT_DATA_SCHEMA_VERSION) {
    next.schemaVersion = CURRENT_DATA_SCHEMA_VERSION;
    fields.push("schemaVersion");
  }
  return { data: next, fields };
}

export async function inspectDataMigration(): Promise<MigrationReport> {
  const paths = await projectJsonPaths();
  const changes: MigrationReport["changes"] = [];
  for (const file of paths) {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
      const migration = migrateMetadata(parsed, path.basename(path.dirname(file)));
      if (migration.fields.length) changes.push({ project: path.basename(path.dirname(file)), fields: migration.fields });
    } catch {
      changes.push({ project: path.basename(path.dirname(file)), fields: ["invalid-project-json"] });
    }
  }
  return {
    currentVersion: changes.length ? 0 : CURRENT_DATA_SCHEMA_VERSION,
    targetVersion: CURRENT_DATA_SCHEMA_VERSION,
    scannedProjects: paths.length,
    pendingProjects: changes.length,
    migratedProjects: 0,
    changes,
  };
}

export async function runDataMigration(): Promise<MigrationReport> {
  const report = await inspectDataMigration();
  if (!report.pendingProjects) return report;
  const paths = await projectJsonPaths();
  await writeInternalBackup("before-migration");
  const backupPath = await writeMigrationBackup(paths);
  let migratedProjects = 0;
  for (const file of paths) {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    const migration = migrateMetadata(parsed, path.basename(path.dirname(file)));
    if (!migration.fields.length) continue;
    const temp = `${file}.migrate-${process.pid}`;
    await writeFile(temp, `${JSON.stringify(migration.data, null, 2)}\n`, "utf8");
    await rename(temp, file);
    migratedProjects += 1;
  }
  await mkdir(dataDir(), { recursive: true });
  await writeFile(path.join(dataDir(), "data-version.json"), `${JSON.stringify({ version: CURRENT_DATA_SCHEMA_VERSION, migratedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  return { ...report, currentVersion: CURRENT_DATA_SCHEMA_VERSION, migratedProjects, pendingProjects: 0, backupPath };
}
