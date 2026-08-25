import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectDirectory } from "./projectManager.js";
import { readProject } from "./projectReader.js";
import { buildShotTasks, mergeShotTaskStateWithMap } from "./shotTaskBuilder.js";
import { remapShotLinks } from "./shotAssetLinkStore.js";
import { writeJsonAtomicPath } from "./atomicJson.js";
import { defaultNextAction, inferStage, type ProjectStage } from "./projectStage.js";
import type { ShotTask } from "../types/shotTask.js";

const MANUAL_LATER_STAGES = new Set<ProjectStage>([
  "shooting",
  "editing",
  "ready_to_publish",
  "published",
  "archived",
]);

async function readMetadata(projectDir: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/**
 * Refreshes data derived from planning documents without discarding execution work.
 * Shot task state is matched back onto rebuilt tasks and later manual stages never regress.
 */
export async function syncProjectDerivedState(slug: string): Promise<{
  shotTasks: ShotTask[];
  stage: ProjectStage;
}> {
  const projectDir = resolveProjectDirectory(slug);
  const [metadata, project] = await Promise.all([readMetadata(projectDir), readProject(slug)]);
  const previous = Array.isArray(metadata.shotTasks) ? metadata.shotTasks as ShotTask[] : [];
  const merged = mergeShotTaskStateWithMap(previous, buildShotTasks(project.files));
  const shotTasks = merged.tasks;
  const derivedMetadata = { ...metadata, shotTasks };
  const inferred = inferStage(derivedMetadata);
  const current = typeof metadata.stage === "string" ? metadata.stage as ProjectStage : undefined;
  const stage = current && MANUAL_LATER_STAGES.has(current) ? current : inferred;
  const stageChanged = current !== stage;
  const updatedAt = new Date().toISOString();

  await writeJsonAtomicPath(path.join(projectDir, "project.json"), {
    ...metadata,
    shotTasks,
    stage,
    stageUpdatedAt: stageChanged ? updatedAt : metadata.stageUpdatedAt || updatedAt,
    nextAction: stageChanged || typeof metadata.nextAction !== "string"
      ? defaultNextAction(stage)
      : metadata.nextAction,
    derivedStateUpdatedAt: updatedAt,
  });
  await remapShotLinks(slug, merged.idMap, new Set(shotTasks.map((task) => task.id)));
  return { shotTasks, stage };
}
