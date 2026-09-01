import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getOutputDir } from "../../src/services/workspaceConfig";
import { listProjects } from "../../src/services/projectManager";
import {
  PROJECT_STAGE_LABELS,
  PROJECT_STAGE_ORDER,
  inferStage,
  type ProjectStage,
} from "../../src/services/projectStage";
import type { DashboardData, DashboardProject } from "../components/dashboard/types";
import { getProjectAdviceContext, projectAdviceHref } from "../../src/services/projectAdvisor";
import { hydrateAllPersistedProjects, usesNetlifyPersistentGeneration } from "../../src/services/netlifyGenerationStore";

async function readProjectJson(projectDir: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path.join(projectDir, "project.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function countShotProgress(metadata: Record<string, unknown>): { completed: number; total: number } {
  const shotTasks = metadata.shotTasks;
  if (!Array.isArray(shotTasks)) return { completed: 0, total: 0 };
  const tasks = shotTasks as Array<{ status?: string }>;
  return { completed: tasks.filter((task) => task.status === "done").length, total: tasks.length };
}

function countDocumentProgress(metadata: Record<string, unknown>): { completed: number; total: number } {
  const documentsStatus = metadata.documentsStatus;
  if (documentsStatus && typeof documentsStatus === "object" && !Array.isArray(documentsStatus)) {
    const values = Object.values(documentsStatus) as Array<{ status?: string }>;
    const total = metadata.workflowVersion === 2 ? 3 : Math.max(values.length, 1);
    return { completed: values.filter((value) => value?.status === "completed").length, total };
  }
  const generated = metadata.generated;
  const completed = Array.isArray(generated) ? generated.filter((value) => typeof value === "string").length : 0;
  return { completed, total: metadata.workflowVersion === 2 ? 3 : Math.max(completed, 1) };
}

function resolveStage(metadata: Record<string, unknown>): ProjectStage {
  const stage = metadata.stage;
  return typeof stage === "string" && (PROJECT_STAGE_ORDER as string[]).includes(stage)
    ? stage as ProjectStage
    : inferStage(metadata);
}

/** Shared by the server-rendered dashboard and its refresh API. */
export async function loadDashboardData(): Promise<DashboardData> {
  if (usesNetlifyPersistentGeneration()) await hydrateAllPersistedProjects();
  const [projects, outputDir] = await Promise.all([listProjects(), getOutputDir()]);
  const items: DashboardProject[] = await Promise.all(projects.map(async (project) => {
    const metadata = await readProjectJson(project.path);
    let updatedAt: string;
    try {
      updatedAt = (await stat(project.path)).mtime.toISOString();
    } catch {
      updatedAt = new Date().toISOString();
    }
    const stage = resolveStage(metadata);
    const documents = countDocumentProgress(metadata);
    const shots = countShotProgress(metadata);
    const projectAdviceContext = await getProjectAdviceContext(project.name).catch(() => undefined);
    const projectAdvice = projectAdviceContext?.advice;
    const validatedFacts = projectAdviceContext?.facts;
    return {
      slug: project.name,
      name: typeof metadata.projectName === "string" && metadata.projectName.trim()
        ? metadata.projectName
        : typeof metadata.topic === "string" ? metadata.topic : project.name,
      platform: typeof metadata.platform === "string" ? metadata.platform : "未指定",
      stage,
      stageLabel: PROJECT_STAGE_LABELS[stage],
      stageUpdatedAt: typeof metadata.stageUpdatedAt === "string" ? metadata.stageUpdatedAt : updatedAt,
      nextAction: projectAdvice?.action || (typeof metadata.nextAction === "string" ? metadata.nextAction : undefined),
      nextActionReason: projectAdvice?.reason,
      nextActionLabel: projectAdvice?.ctaLabel,
      nextActionHref: projectAdvice ? projectAdviceHref(project.name, projectAdvice) : undefined,
      nextActionPriority: projectAdvice?.priority,
      documentCompleted: validatedFacts?.documentCompleted ?? documents.completed,
      documentTotal: validatedFacts?.documentTotal ?? documents.total,
      shotCompleted: validatedFacts?.shotCompleted ?? shots.completed,
      shotTotal: validatedFacts?.shotTotal ?? shots.total,
      updatedAt,
      resumeAvailable: Boolean(metadata.shootingSession && typeof metadata.shootingSession === "object"),
    };
  }));
  items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  const pipeline: DashboardData["pipeline"] = {
    idea: 0, planning: 0, ready_to_shoot: 0, shooting: 0,
    editing: 0, ready_to_publish: 0, archived: 0,
  };
  for (const item of items) pipeline[item.stage] += 1;

  return { pipeline, projects: items, total: items.length, outputDir };
}
