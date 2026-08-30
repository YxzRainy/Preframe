/** 将“已确认素材”回流到镜头状态和阶段建议。
 * 不把候选素材当作已拍，且不覆盖用户已经完成的拍摄/剪辑状态。 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomicPath } from "./atomicJson.js";
import { resolveProjectDirectory } from "./projectManager.js";
import { inferStage, type ProjectStage } from "./projectStage.js";
import { getLinksForProject } from "./shotAssetLinkStore.js";
import type { ShotTask } from "../types/shotTask.js";

const LATER_STAGES = new Set<ProjectStage>(["shooting", "editing", "ready_to_publish", "archived"]);

export async function syncProjectAssetState(slug: string): Promise<{ updatedShotIds: string[]; stageSuggestion: ProjectStage }> {
  const projectDir = resolveProjectDirectory(slug);
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8"));
    metadata = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { /* project is valid but metadata may be absent */ }

  const links = await getLinksForProject(slug);
  const confirmed = new Set(links.filter((link) => link.status === "confirmed").map((link) => link.shotTaskId));
  const tasks = Array.isArray(metadata.shotTasks) ? metadata.shotTasks as ShotTask[] : [];
  const updatedShotIds: string[] = [];
  for (const task of tasks) {
    if (confirmed.has(task.id) && task.status === "todo") {
      task.status = "ready";
      updatedShotIds.push(task.id);
    }
  }
  const derived = { ...metadata, shotTasks: tasks };
  const stageSuggestion = inferStage(derived);
  const currentStage = typeof metadata.stage === "string" ? metadata.stage as ProjectStage : undefined;
  await writeJsonAtomicPath(path.join(projectDir, "project.json"), {
    ...metadata,
    shotTasks: tasks,
    stageSuggestion,
    stageSuggestionUpdatedAt: new Date().toISOString(),
    ...(currentStage && LATER_STAGES.has(currentStage) ? {} : { stage: stageSuggestion }),
  });
  return { updatedShotIds, stageSuggestion };
}
