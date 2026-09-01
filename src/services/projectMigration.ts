import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { GenerateInput, ProjectBrief } from "../prompts/generatePrompt.js";
import { documentContext } from "../prompts/enhancePrompt.js";
import { generateValidatedDocument, createProjectBrief, statusRecord, type DocumentStatusRecord, type GeneratedDocumentResult, type GenerationModelCallRecord } from "./documentGeneration.js";
import { callModel, combineModelRequestSignal, type CallModelOptions } from "./modelClient.js";
import { resolveProjectDirectory } from "./projectManager.js";
import { writeJsonAtomicPath } from "./atomicJson.js";
import { writeMarkdown } from "./fileWriter.js";
import { archiveDocumentVersion } from "./documentVersionStore.js";
import { syncProjectDerivedState } from "./projectLifecycle.js";
import { getAccountMemory, accountMemoryHasContent, sanitizeAccountMemoryForPrompt, EMPTY_ACCOUNT_MEMORY } from "./accountMemory.js";
import { PROJECT_DOCUMENT_DEFINITIONS } from "../utils/documentDefinitions.js";
import { resolveContentProfile } from "../utils/contentProfile.js";
import { combineCreatorPrompts, creatorLearningPrompt } from "./creatorLearningStore.js";

const LEGACY_BASE_NAMES = [
  "01_项目概览.md",
  "02_选题拆解.md",
  "03_口播脚本.md",
  "04_分镜与剪辑节奏.md",
  "05_拍摄清单.md",
  "06_封面标题与发布文案.md",
  "07_视觉参考提示词.md",
  "08_内容质检报告.md",
  "09_成片执行稿.md",
  "10_发布承接话术.md",
] as const;

export interface ProjectMigrationOptions {
  signal?: AbortSignal;
  deadlineMs?: number;
  onModelCall?: (record: GenerationModelCallRecord) => void;
  onProgress?: (event: MigrationProgressEvent) => void;
  modelCall?: (prompt: string, options?: CallModelOptions) => Promise<string>;
}

export interface MigrationProgressEvent {
  stage: "preparing" | "generating" | "validating" | "archiving" | "writing" | "completed";
  progress: number;
  documentId?: string;
  fileName?: string;
  message: string;
}

export interface ProjectMigrationResult {
  migrated: boolean;
  projectSlug: string;
  archivedFiles: string[];
  files: Array<{ name: string; content: string }>;
  status: "complete" | "partial" | "failed";
  documentsStatus: Record<string, DocumentStatusRecord>;
  modelCalls: GenerationModelCallRecord[];
  deadlineReached: boolean;
}

async function readMetadata(projectDir: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function migrationInput(metadata: Record<string, unknown>, slug: string): GenerateInput {
  const profile = resolveContentProfile(metadata);
  return {
    projectName: typeof metadata.projectName === "string" ? metadata.projectName : slug,
    topic: typeof metadata.topic === "string" ? metadata.topic : slug,
    platform: typeof metadata.platform === "string" ? metadata.platform : "未指定平台",
    contentSubject: profile.contentSubject || "未指定内容主体",
    contentDomain: profile.contentDomain || "未指定内容领域",
    style: typeof metadata.style === "string" ? metadata.style : "专业但通俗",
    targetAudience: typeof metadata.targetAudience === "string" ? metadata.targetAudience : "目标用户",
    extraRequirements: typeof metadata.extraRequirements === "string" ? metadata.extraRequirements : "",
  };
}

function isLegacyBase(name: string): boolean {
  return LEGACY_BASE_NAMES.some((base) => {
    const stem = base.replace(/\.md$/u, "");
    return new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:_修改版(?:_\\d+)?)?\\.md$`, "u").test(name);
  });
}

async function readLegacyFiles(projectDir: string): Promise<Array<{ name: string; content: string }>> {
  const entries = await readdir(projectDir, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isFile() && isLegacyBase(entry.name)).map((entry) => entry.name).sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  return Promise.all(names.map(async (name) => ({ name, content: await readFile(path.join(projectDir, name), "utf8") })));
}

function legacyContext(files: Array<{ name: string; content: string }>): string {
  return files.map((file) => `===== 历史文档 ${file.name} =====\n${file.content.trim().slice(0, 24_000)}`).join("\n\n").slice(0, 100_000);
}

function normalizedBrief(value: unknown): ProjectBrief | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (typeof source.coreViewpoint !== "string" || typeof source.contentStructure !== "string") return undefined;
  return {
    ...(source as unknown as ProjectBrief),
    targetDuration: typeof source.targetDuration === "string" ? source.targetDuration : "45-60秒",
    requiredElements: typeof source.requiredElements === "string" ? source.requiredElements : "保留核心观点和必要事实依据",
    forbiddenExpressions: typeof source.forbiddenExpressions === "string" ? source.forbiddenExpressions : "无",
    riskBoundaries: typeof source.riskBoundaries === "string" ? source.riskBoundaries : "不编造事实，不夸张承诺，遵守平台规范。",
  };
}

export async function migrateProjectToCurrentWorkflow(
  projectSlug: string,
  options: ProjectMigrationOptions = {},
): Promise<ProjectMigrationResult> {
  const projectDir = resolveProjectDirectory(projectSlug);
  const metadata = await readMetadata(projectDir);
  if (metadata.workflowVersion === 2) {
    const files = await Promise.all(PROJECT_DOCUMENT_DEFINITIONS.map(async (definition) => ({ name: definition.filename, content: await readFile(path.join(projectDir, definition.filename), "utf8") })));
    const status = metadata.status === "complete" ? "complete" : "partial";
    return { migrated: false, projectSlug, archivedFiles: [], files, status, documentsStatus: (metadata.documentsStatus || {}) as Record<string, DocumentStatusRecord>, modelCalls: [], deadlineReached: false };
  }

  const legacyFiles = await readLegacyFiles(projectDir);
  if (!legacyFiles.length) throw new Error("未找到可迁移的历史文档。该项目可能已经是新版，或缺少旧版策划文件。 ");
  options.onProgress?.({
    stage: "preparing",
    progress: 8,
    message: `已读取 ${legacyFiles.length} 份历史文档，正在整理迁移上下文。`,
  });
  const input = migrationInput(metadata, projectSlug);
  const deadlineMs = options.deadlineMs ?? 6 * 60_000;
  const signal = combineModelRequestSignal(options.signal, deadlineMs);
  const modelCalls: GenerationModelCallRecord[] = [];
  const recordModelCall = (record: GenerationModelCallRecord) => { modelCalls.push(record); options.onModelCall?.(record); };
  const accountMemory = await getAccountMemory().catch(() => ({ ...EMPTY_ACCOUNT_MEMORY }));
  const accountMemoryPrompt = combineCreatorPrompts(
    accountMemoryHasContent(accountMemory) ? sanitizeAccountMemoryForPrompt(accountMemory) : "",
    await creatorLearningPrompt().catch(() => ""),
  );
  const historical = legacyContext(legacyFiles);
  const brief = normalizedBrief(metadata.projectBrief) || await createProjectBrief(input, accountMemoryPrompt, signal, recordModelCall, historical);
  const generated = new Map<string, GeneratedDocumentResult>();
  const accepted: Array<{ name: string; content: string }> = [];

  for (const [index, definition] of PROJECT_DOCUMENT_DEFINITIONS.entries()) {
    options.onProgress?.({
      stage: "generating",
      progress: 12 + index * 23,
      documentId: definition.number,
      fileName: definition.filename,
      message: `正在生成 ${definition.filename}。`,
    });
    const context = definition.number === "01" ? historical : documentContext(accepted, definition.number as "01" | "02" | "03");
    const result = await generateValidatedDocument({
      definition,
      input,
      brief,
      context,
      accountMemoryPrompt,
      acceptedDocuments: accepted,
      signal,
      modelCall: options.modelCall || callModel,
      onModelCall: recordModelCall,
    });
    generated.set(definition.number, result);
    if (!result.content) {
      const statusRecords = PROJECT_DOCUMENT_DEFINITIONS.map((item) => statusRecord(generated.get(item.number) || { definition: item, repaired: false, validationErrors: ["迁移中止：上游文档未通过质量门"] }));
      return { migrated: false, projectSlug, archivedFiles: [], files: [], status: "failed", documentsStatus: Object.fromEntries(statusRecords.map((item) => [item.id, item])), modelCalls, deadlineReached: signal.aborted };
    }
    accepted.push({ name: definition.filename, content: result.content });
    options.onProgress?.({
      stage: "validating",
      progress: 30 + index * 23,
      documentId: definition.number,
      fileName: definition.filename,
      message: `${definition.filename} 已通过自动质量校验。`,
    });
  }

  const migrationId = `workflow-migration-${new Date().toISOString().replace(/[:.]/gu, "-")}`;
  const staged = path.join(projectDir, `.${migrationId}`);
  const archivedFiles: string[] = [];
  try {
    await writeMarkdown(path.join(staged, "01_创作简报.md"), generated.get("01")!.content!);
    await writeMarkdown(path.join(staged, "02_拍摄执行稿.md"), generated.get("02")!.content!);
    await writeMarkdown(path.join(staged, "03_发布与复盘.md"), generated.get("03")!.content!);

    options.onProgress?.({ stage: "archiving", progress: 83, message: "三份新版文档均已通过质量门，正在归档历史文档。" });
    for (const file of legacyFiles) {
      await archiveDocumentVersion(projectSlug, file.name, file.content, "workflow-migration");
      archivedFiles.push(file.name);
    }
    for (const file of legacyFiles) await rm(path.join(projectDir, file.name), { force: true });
    options.onProgress?.({ stage: "writing", progress: 93, message: "正在写入新版工作稿并同步镜头任务。" });
    for (const definition of PROJECT_DOCUMENT_DEFINITIONS) {
      await writeMarkdown(path.join(projectDir, definition.filename), generated.get(definition.number)!.content!);
    }
    const statusRecords = PROJECT_DOCUMENT_DEFINITIONS.map((definition) => statusRecord(generated.get(definition.number)!));
    const now = new Date().toISOString();
    await writeJsonAtomicPath(path.join(projectDir, "project.json"), {
      ...metadata,
      workflowVersion: 2,
      workflowModel: "three-document-single-source",
      projectBrief: brief,
      status: "complete",
      documentsStatus: Object.fromEntries(statusRecords.map((item) => [item.id, item])),
      generated: statusRecords.filter((item) => item.generated).map((item) => item.id),
      repaired: statusRecords.filter((item) => item.repaired).map((item) => item.id),
      failed: statusRecords.filter((item) => item.failed).map((item) => item.id),
      validationErrors: {},
      qualityGate: {
        mode: "automatic-repair",
        passed: true,
        migratedFrom: "legacy-documents",
        archivedFiles,
      },
      workflowMigration: {
        id: migrationId,
        migratedAt: now,
        sourceFiles: archivedFiles,
        sourceWorkflow: "legacy-10-document",
      },
      updatedAt: now,
      migratedAt: now,
      generationDeadlineReached: signal.aborted && signal.reason instanceof DOMException && signal.reason.name === "TimeoutError",
      modelCalls,
    });
    await syncProjectDerivedState(projectSlug);
    options.onProgress?.({ stage: "completed", progress: 100, message: "迁移完成，项目已切换到新版三文档工作流。" });
    return {
      migrated: true,
      projectSlug,
      archivedFiles,
      files: accepted,
      status: "complete",
      documentsStatus: Object.fromEntries(statusRecords.map((item) => [item.id, item])),
      modelCalls,
      deadlineReached: signal.aborted && signal.reason instanceof DOMException && signal.reason.name === "TimeoutError",
    };
  } finally {
    await rm(staged, { recursive: true, force: true }).catch(() => undefined);
  }
}
