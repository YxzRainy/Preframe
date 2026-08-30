import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { GenerateInput } from "../prompts/generatePrompt.js";
import { documentContext } from "../prompts/enhancePrompt.js";
import { CORE_PROJECT_DOCUMENT_DEFINITIONS, PROJECT_DOCUMENT_DEFINITIONS, type ProjectDocumentDefinition } from "../utils/documentDefinitions.js";
import {
  buildRefinePrompt,
  buildRefineRepairPrompt,
  parseRefinedContent,
  type RefineDocument,
} from "../prompts/refinePrompt.js";
import { scanAssets, assetsToMarkdown } from "./assetScanner.js";
import { writeJson, writeMarkdown } from "./fileWriter.js";
import { callModel, combineModelRequestSignal, loadModelConfig } from "./modelClient.js";
import {
  accountMemoryHasContent,
  accountMemorySnapshot,
  EMPTY_ACCOUNT_MEMORY,
  getAccountMemory,
  sanitizeAccountMemoryForPrompt,
  type AccountMemorySnapshot,
} from "./accountMemory.js";
import {
  createTempProjectDirectory,
  finalizeTempProjectDirectory,
  removeTempProjectDirectory,
  resolveProjectDirectory,
} from "./projectManager.js";
import { formatDuration } from "../utils/generationTiming.js";
import { resolveContentProfile } from "../utils/contentProfile.js";
import {
  createProjectBrief,
  generateValidatedDocument,
  PLACEHOLDER_PHRASES,
  statusRecord,
  reviewCheckpointHasUsableData,
  validateDocument,
  type DocumentQualityStatus,
  type DocumentState,
  type DocumentStatusRecord,
  type GenerationModelCallRecord,
  type GeneratedDocumentResult,
} from "./documentGeneration.js";
import { syncProjectDerivedState } from "./projectLifecycle.js";
import { archiveDocumentVersion } from "./documentVersionStore.js";
import { combineCreatorPrompts, creatorLearningPrompt } from "./creatorLearningStore.js";
import { contentAssetPromptForTopic } from "./contentAssetStore.js";

export interface ContentFile {
  name: string;
  content: string;
  fallbackUsed?: boolean;
}

export interface GenerateResult {
  projectSlug: string;
  projectName: string;
  files: ContentFile[];
  status: "complete" | "partial" | "failed";
  documentsStatus: Record<string, DocumentStatusRecord>;
  failedDocuments: Array<{ id: string; fileName: string; validationErrors: string[] }>;
  modelCalls: GenerationModelCallRecord[];
  deadlineReached: boolean;
}

export type GenerationJobStatus =
  | "idle"
  | "creating"
  | "generatingCore"
  | "generatingExecution"
  | "generatingPublishCopy"
  | "writing"
  | "paused"
  | "partial"
  | "completed"
  | "cancelled"
  | "failed";

export interface GenerationStatusUpdate {
  status: GenerationJobStatus;
  currentDocument?: string;
  progress?: number;
  message?: string;
  generationProgress?: GenerationDocumentProgress[];
}

export type GenerationFailureStage = "generate" | "model" | "parse" | "write";
export type GenerationDocumentProgressStatus = "waiting" | "generating" | "validating" | "completed" | "repairing" | "failed" | "blocked";

export interface GenerationDocumentProgress {
  id: string;
  title: string;
  fileName: string;
  status: GenerationDocumentProgressStatus;
  message?: string;
}

export interface GenerateProjectOptions {
  jobId?: string;
  generationStartedAt?: string;
  signal?: AbortSignal;
  onStatus?: (update: GenerationStatusUpdate) => void;
  onTempDir?: (tempDir: string) => void;
  isCancelled?: () => boolean;
  waitIfPaused?: () => Promise<void>;
  onTiming?: (label: string, durationMs: number) => void;
  onModelCall?: (record: GenerationModelCallRecord) => void;
  deadlineMs?: number;
}

export const PROJECT_GENERATION_DEADLINE_MS = 6 * 60_000;

export class GenerationCancelledError extends Error {
  constructor(message = "生成已撤销。") {
    super(message);
    this.name = "GenerationCancelledError";
  }
}

export class GenerationStageError extends Error {
  stage: GenerationFailureStage;

  constructor(stage: GenerationFailureStage, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GenerationStageError";
    this.stage = stage;
  }
}

function assertNotCancelled(options: GenerateProjectOptions): void {
  if (options.signal?.aborted || options.isCancelled?.()) {
    throw new GenerationCancelledError();
  }
}

async function timed<T>(jobId: string, label: string, options: GenerateProjectOptions, task: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await task();
  } finally {
    const durationMs = Math.round(performance.now() - started);
    console.info(`[generation:${jobId}] ${label}: ${durationMs}ms`);
    options.onTiming?.(label, durationMs);
  }
}

async function withStage<T>(stage: GenerationFailureStage, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof GenerationStageError || error instanceof GenerationCancelledError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new GenerationStageError(stage, message, { cause: error });
  }
}

function projectMetadata(
  input: GenerateInput,
  projectName: string,
  timing?: { startedAt?: string; finishedAt?: string; durationMs?: number },
  model?: string,
  accountMemory?: { used: boolean; snapshot: AccountMemorySnapshot },
): Record<string, unknown> {
  const startedAt = timing?.startedAt;
  const finishedAt = timing?.finishedAt;
  const durationMs = timing?.durationMs;
  return {
    ...input,
    projectName,
    model: model || process.env.MODEL_NAME?.trim() || process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat",
    accountMemoryUsed: Boolean(accountMemory?.used),
    accountMemorySnapshot: accountMemory?.used ? accountMemory.snapshot : {},
    generatedAt: new Date().toISOString(),
    ...(startedAt ? { generationStartedAt: startedAt } : {}),
    ...(finishedAt ? { generationFinishedAt: finishedAt } : {}),
    ...(typeof durationMs === "number" ? {
      generationDurationMs: durationMs,
      generationDurationLabel: formatDuration(durationMs),
    } : {}),
  };
}

function blockedDocumentResult(definition: ProjectDocumentDefinition, blocker: ProjectDocumentDefinition): GeneratedDocumentResult {
  return {
    definition,
    repaired: false,
    validationErrors: [`因 ${blocker.filename} 未通过校验，${definition.filename} 本次未生成`],
  };
}

function documentProgress(overrides: Partial<Record<string, { status: GenerationDocumentProgressStatus; message?: string }>> = {}): GenerationDocumentProgress[] {
  return PROJECT_DOCUMENT_DEFINITIONS.map((definition) => {
    const override = overrides[definition.filename];
    return {
      id: definition.number,
      title: definition.title,
      fileName: definition.filename,
      status: override?.status || "waiting",
      message: override?.message,
    };
  });
}

/** CLI 与 Web 共用的三文档生成流程。 */
export async function generateProject(input: GenerateInput, options: GenerateProjectOptions = {}): Promise<GenerateResult> {
  const jobId = options.jobId || `local_${Date.now()}`;
  let tempDir = "";
  let finalized = false;
  const projectName = input.projectName?.trim() || input.topic;
  const generationStartedAt = options.generationStartedAt || new Date().toISOString();
  const deadlineMs = options.deadlineMs ?? PROJECT_GENERATION_DEADLINE_MS;
  const taskSignal = combineModelRequestSignal(options.signal, deadlineMs);
  const modelCalls: GenerationModelCallRecord[] = [];
  const recordModelCall = (record: GenerationModelCallRecord) => {
    modelCalls.push(record);
    options.onModelCall?.(record);
  };
  const model = await loadModelConfig().then((config) => config.model).catch(() => undefined);
  const accountMemoryValue = await getAccountMemory().catch(() => ({ ...EMPTY_ACCOUNT_MEMORY }));
  const accountMemoryUsed = accountMemoryHasContent(accountMemoryValue);
  const accountMemoryPrompt = combineCreatorPrompts(
    accountMemoryUsed ? sanitizeAccountMemoryForPrompt(accountMemoryValue) : "",
    await creatorLearningPrompt().catch(() => ""),
  );
  const accountMemoryMetadata = { used: accountMemoryUsed, snapshot: accountMemorySnapshot(accountMemoryValue) };
  const progressState: Partial<Record<string, { status: GenerationDocumentProgressStatus; message?: string }>> = {};

  try {
    assertNotCancelled(options);
    options.onStatus?.({ status: "creating", currentDocument: "统一创作约束", progress: 0, generationProgress: documentProgress() });
    tempDir = await withStage("write", () => timed(jobId, "创建项目目录耗时", options, () => createTempProjectDirectory(jobId)));
    options.onTempDir?.(tempDir);
    const assetReferenceContext = await contentAssetPromptForTopic([input.topic, input.contentDomain, input.platform].filter(Boolean).join(" ")).catch(() => "");
    const brief = await withStage("model", () => createProjectBrief(input, accountMemoryPrompt, taskSignal, recordModelCall, assetReferenceContext));
    const resolvedInput: GenerateInput = {
      ...input,
      contentSubject: brief.contentSubject,
      contentDomain: brief.contentDomain,
      platform: brief.platform,
      style: brief.style,
      targetAudience: brief.targetAudience,
    };
    const results = new Map<string, GeneratedDocumentResult>();
    const accepted: Array<{ name: string; content: string }> = [];

    for (let index = 0; index < PROJECT_DOCUMENT_DEFINITIONS.length; index += 1) {
      await options.waitIfPaused?.();
      assertNotCancelled(options);
      const definition = PROJECT_DOCUMENT_DEFINITIONS[index];
      const context = documentContext(accepted, definition.number);
      options.onStatus?.({
        status: definition.number === "01" ? "generatingCore" : definition.number === "02" ? "generatingExecution" : "generatingPublishCopy",
        currentDocument: definition.filename,
        progress: Math.round((index / PROJECT_DOCUMENT_DEFINITIONS.length) * 100),
        generationProgress: documentProgress(progressState),
      });
      const result = await generateValidatedDocument({
        definition,
        input: resolvedInput,
        brief,
        context,
        accountMemoryPrompt,
        acceptedDocuments: accepted,
        signal: taskSignal,
        onModelCall: recordModelCall,
        onState: (state, errors = []) => {
          progressState[definition.filename] = {
            status: state === "completed" ? "completed" : state === "failed" ? "failed" : state,
            message: errors[0],
          };
          options.onStatus?.({
            status: definition.number === "01" ? "generatingCore" : definition.number === "02" ? "generatingExecution" : "generatingPublishCopy",
            currentDocument: definition.filename,
            progress: Math.round((index / PROJECT_DOCUMENT_DEFINITIONS.length) * 100),
            generationProgress: documentProgress(progressState),
          });
        },
      });
      results.set(definition.number, result);
      progressState[definition.filename] = { status: result.content ? "completed" : "failed", message: result.validationErrors[0] };
      if (!result.content) break; // 下游不能在上游真源缺失时继续生成。
      accepted.push({ name: definition.filename, content: result.content });
    }

    const blocker = [...results.values()].find((result) => !result.content)?.definition;
    if (blocker) {
      for (const definition of PROJECT_DOCUMENT_DEFINITIONS.filter((item) => Number(item.number) > Number(blocker.number))) {
        progressState[definition.filename] = { status: "blocked", message: blockedDocumentResult(definition, blocker).validationErrors[0] };
      }
    }
    const orderedResults = PROJECT_DOCUMENT_DEFINITIONS.map((definition) => results.get(definition.number)
      || (blocker ? blockedDocumentResult(definition, blocker) : { definition, repaired: false, validationErrors: ["文档未生成"] }));
    const statusRecords = orderedResults.map(statusRecord);
    const files: ContentFile[] = [];
    await withStage("write", async () => {
      for (const result of orderedResults) {
        if (!result.content) continue;
        await writeMarkdown(path.join(tempDir, result.definition.filename), result.content);
        files.push({ name: result.definition.filename, content: result.content });
      }
      const finishedAt = new Date().toISOString();
      const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(generationStartedAt));
      const complete = files.length === PROJECT_DOCUMENT_DEFINITIONS.length;
      await writeJson(path.join(tempDir, "project.json"), {
        ...projectMetadata(resolvedInput, projectName, { startedAt: generationStartedAt, finishedAt, durationMs }, model, accountMemoryMetadata),
        workflowVersion: 2,
        workflowModel: "three-document-single-source",
        projectBrief: brief,
        status: complete ? "complete" : files.length ? "partial" : "failed",
        qualityGate: {
          mode: "automatic-repair",
          passed: complete,
          repairedDocuments: statusRecords.filter((item) => item.repaired).map((item) => item.id),
          unresolved: Object.fromEntries(statusRecords.filter((item) => item.validationErrors.length).map((item) => [item.id, item.validationErrors])),
        },
        documentsStatus: Object.fromEntries(statusRecords.map((item) => [item.id, item])),
        generated: statusRecords.filter((item) => item.generated).map((item) => item.id),
        repaired: statusRecords.filter((item) => item.repaired).map((item) => item.id),
        failed: statusRecords.filter((item) => item.failed).map((item) => item.id),
        validationErrors: Object.fromEntries(statusRecords.filter((item) => item.validationErrors.length).map((item) => [item.id, item.validationErrors])),
        fallbackUsed: false,
        fallbackDocuments: [],
        generationDeadlineMs: deadlineMs,
        generationDeadlineReached: taskSignal.aborted && taskSignal.reason instanceof DOMException && taskSignal.reason.name === "TimeoutError",
        modelCalls,
      });
    });

    const projectDir = await withStage("write", () => finalizeTempProjectDirectory(tempDir, projectName));
    finalized = true;
    const projectSlug = path.basename(projectDir);
    await syncProjectDerivedState(projectSlug).catch(() => undefined);
    const documentsStatus = Object.fromEntries(statusRecords.map((record) => [record.id, record]));
    const failedDocuments = statusRecords.filter((record) => record.failed).map((record) => ({ id: record.id, fileName: record.fileName, validationErrors: record.validationErrors }));
    const status = files.length === PROJECT_DOCUMENT_DEFINITIONS.length ? "complete" : files.length ? "partial" : "failed";
    const deadlineReached = taskSignal.aborted && taskSignal.reason instanceof DOMException && taskSignal.reason.name === "TimeoutError";
    const rootFailure = statusRecords.find((record) => record.documentStatus === "failed");
    const blockedCount = statusRecords.filter((record) => record.documentStatus === "blocked").length;
    const failureMessage = rootFailure
      ? `${rootFailure.fileName} 生成失败：${rootFailure.validationErrors.join("；")}${blockedCount ? `；另有 ${blockedCount} 份下游文档因此未生成` : ""}`
      : `${files.length}/${PROJECT_DOCUMENT_DEFINITIONS.length} 份核心文档可用。`;
    options.onStatus?.({
      status: status === "complete" ? "completed" : status,
      currentDocument: status === "complete" ? "03_发布与复盘.md" : rootFailure?.fileName || "生成已结束",
      progress: Math.round((files.length / PROJECT_DOCUMENT_DEFINITIONS.length) * 100),
      message: status === "complete" ? "三份核心文档已生成，并通过自动质量门。" : failureMessage,
      generationProgress: documentProgress(progressState),
    });
    return { projectSlug, projectName, files, status, documentsStatus, failedDocuments, modelCalls, deadlineReached };
  } catch (error) {
    if (error instanceof GenerationCancelledError) {
      options.onStatus?.({ status: "cancelled", currentDocument: "已撤销", progress: 0 });
      throw error;
    }
    options.onStatus?.({ status: "failed", currentDocument: "生成失败", progress: 0, message: error instanceof Error ? error.message : "生成失败。" });
    throw error;
  } finally {
    if (tempDir && !finalized) await removeTempProjectDirectory(tempDir).catch(() => undefined);
  }
}

async function readProjectMetadata(projectDir: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** 兼容旧按钮：新流程中的增强包就是拍摄执行稿与发布复盘。 */
export async function generateEnhancedExecutionPackage(projectSlug: string): Promise<ContentFile[]> {
  const result = await regenerateProjectDocuments(projectSlug, ["02", "03"]);
  return result.files.filter((file) => file.name === "02_拍摄执行稿.md" || file.name === "03_发布与复盘.md");
}

export interface RegenerateProjectOptions {
  signal?: AbortSignal;
  deadlineMs?: number;
  onModelCall?: (record: GenerationModelCallRecord) => void;
}

export async function regenerateProjectDocuments(
  projectSlug: string,
  requestedNumbers: string[] = [],
  options: RegenerateProjectOptions = {},
): Promise<{ files: ContentFile[]; status: "complete" | "partial" | "failed"; documentsStatus: Record<string, DocumentStatusRecord>; modelCalls: GenerationModelCallRecord[]; deadlineReached: boolean }> {
  const projectDir = resolveProjectDirectory(projectSlug);
  const metadata = await readProjectMetadata(projectDir);
  const profile = resolveContentProfile(metadata);
  const input: GenerateInput = {
    projectName: typeof metadata.projectName === "string" ? metadata.projectName : projectSlug,
    topic: typeof metadata.topic === "string" ? metadata.topic : projectSlug,
    platform: typeof metadata.platform === "string" ? metadata.platform : "未指定平台",
    contentSubject: profile.contentSubject || "未指定内容主体",
    contentDomain: profile.contentDomain || "未指定内容领域",
    style: typeof metadata.style === "string" ? metadata.style : "专业但通俗",
    targetAudience: typeof metadata.targetAudience === "string" ? metadata.targetAudience : "目标用户",
    extraRequirements: typeof metadata.extraRequirements === "string" ? metadata.extraRequirements : "",
  };
  const deadlineMs = options.deadlineMs ?? PROJECT_GENERATION_DEADLINE_MS;
  const taskSignal = combineModelRequestSignal(options.signal, deadlineMs);
  const modelCalls: GenerationModelCallRecord[] = [];
  const recordModelCall = (record: GenerationModelCallRecord) => { modelCalls.push(record); options.onModelCall?.(record); };
  const accountMemory = await getAccountMemory().catch(() => ({ ...EMPTY_ACCOUNT_MEMORY }));
  const accountMemoryPrompt = combineCreatorPrompts(
    accountMemoryHasContent(accountMemory) ? sanitizeAccountMemoryForPrompt(accountMemory) : "",
    await creatorLearningPrompt().catch(() => ""),
  );
  const briefValue = metadata.projectBrief;
  const brief = briefValue && typeof briefValue === "object" && !Array.isArray(briefValue)
    ? { ...(briefValue as Awaited<ReturnType<typeof createProjectBrief>>), targetDuration: typeof (briefValue as Record<string, unknown>).targetDuration === "string" ? String((briefValue as Record<string, unknown>).targetDuration) : "45-60秒", requiredElements: typeof (briefValue as Record<string, unknown>).requiredElements === "string" ? String((briefValue as Record<string, unknown>).requiredElements) : "保留核心观点", forbiddenExpressions: typeof (briefValue as Record<string, unknown>).forbiddenExpressions === "string" ? String((briefValue as Record<string, unknown>).forbiddenExpressions) : "无" }
    : await createProjectBrief(input, accountMemoryPrompt, taskSignal, recordModelCall);

  const existing = new Map<string, string>();
  for (const definition of PROJECT_DOCUMENT_DEFINITIONS) {
    try { existing.set(definition.filename, await readFile(path.join(projectDir, definition.filename), "utf8")); } catch { /* missing */ }
  }
  const requested = new Set(requestedNumbers
    .map((number) => number.padStart(2, "0"))
    .filter((number) => PROJECT_DOCUMENT_DEFINITIONS.some((definition) => definition.number === number)));
  const firstTarget = requested.size ? Math.min(...[...requested].map(Number)) : 1;
  const targets = new Set(PROJECT_DOCUMENT_DEFINITIONS.filter((definition) => Number(definition.number) >= firstTarget).map((definition) => definition.number));
  const regenerated = new Map<string, GeneratedDocumentResult>();
  const accepted: Array<{ name: string; content: string }> = [];
  let blocker: ProjectDocumentDefinition | undefined;

  for (const definition of PROJECT_DOCUMENT_DEFINITIONS) {
    const current = existing.get(definition.filename);
    if (!targets.has(definition.number) && current) {
      accepted.push({ name: definition.filename, content: current });
      continue;
    }
    const result = await generateValidatedDocument({
      definition,
      input,
      brief,
      context: documentContext(accepted, definition.number),
      accountMemoryPrompt,
      acceptedDocuments: accepted,
      signal: taskSignal,
      onModelCall: recordModelCall,
    });
    regenerated.set(definition.number, result);
    if (!result.content) {
      blocker = definition;
      break;
    }
    if (current) await archiveDocumentVersion(projectSlug, definition.filename, current, "regenerate");
    await writeMarkdown(path.join(projectDir, definition.filename), result.content);
    existing.set(definition.filename, result.content);
    accepted.push({ name: definition.filename, content: result.content });
  }

  const records = PROJECT_DOCUMENT_DEFINITIONS.map((definition) => {
    const result = regenerated.get(definition.number);
    if (result) return statusRecord(result);
    const content = existing.get(definition.filename);
    if (content) return statusRecord({ definition, content, repaired: false, validationErrors: [] });
    return statusRecord(blocker && Number(definition.number) > Number(blocker.number)
      ? blockedDocumentResult(definition, blocker)
      : { definition, repaired: false, validationErrors: ["文档缺失"] });
  });
  const completedCount = records.filter((record) => record.generated).length;
  const status = completedCount === PROJECT_DOCUMENT_DEFINITIONS.length ? "complete" : completedCount ? "partial" : "failed";
  const documentsStatus = Object.fromEntries(records.map((record) => [record.id, record]));
  const deadlineReached = taskSignal.aborted && taskSignal.reason instanceof DOMException && taskSignal.reason.name === "TimeoutError";
  await writeJson(path.join(projectDir, "project.json"), {
    ...metadata,
    workflowVersion: 2,
    workflowModel: "three-document-single-source",
    projectBrief: brief,
    status,
    documentsStatus,
    generated: records.filter((record) => record.generated).map((record) => record.id),
    repaired: records.filter((record) => record.repaired).map((record) => record.id),
    failed: records.filter((record) => record.failed).map((record) => record.id),
    validationErrors: Object.fromEntries(records.filter((record) => record.validationErrors.length).map((record) => [record.id, record.validationErrors])),
    qualityGate: { mode: "automatic-repair", passed: status === "complete", unresolved: Object.fromEntries(records.filter((record) => record.validationErrors.length).map((record) => [record.id, record.validationErrors])) },
    regeneratedAt: new Date().toISOString(),
    lastRegeneration: { requestedDocuments: [...requested], deadlineMs, deadlineReached, modelCalls },
  });
  await syncProjectDerivedState(projectSlug);
  return { files: [...existing.entries()].map(([name, content]) => ({ name, content })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true })), status, documentsStatus, modelCalls, deadlineReached };
}

export function revisedFilename(filename: string): string {
  const stem = filename.replace(/\.md$/i, "").replace(/_修改版(?:_\d+)?$/u, "");
  return `${stem}_修改版.md`;
}

async function availableRevisedFilename(projectDir: string, filename: string): Promise<string> {
  const first = revisedFilename(filename);
  const stem = first.replace(/\.md$/i, "");
  let candidate = first;
  let version = 2;
  while (true) {
    try {
      await access(path.join(projectDir, candidate));
      candidate = `${stem}_${version++}.md`;
    } catch {
      return candidate;
    }
  }
}

function assertMarkdownFilename(filename: string): void {
  if (!filename.endsWith(".md") || filename !== path.basename(filename)) {
    throw new Error("Markdown 文件名无效。");
  }
}

function referencePackFromMetadata(metadata: Record<string, unknown>): string {
  const pack = metadata.basisPack;
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) return "";
  const source = pack as Record<string, unknown>;
  const labels: Array<[string, string]> = [["viewpoints", "确认观点"], ["facts", "已知事实"], ["drafts", "已有草稿"], ["boundaries", "禁区与边界"], ["visualReferences", "按需视觉参考"], ["sources", "事实来源与授权"]];
  return labels.map(([key, label]) => typeof source[key] === "string" && source[key].trim()
    ? `## ${label}\n${source[key].trim().slice(0, 40_000)}` : "").filter(Boolean).join("\n\n");
}

interface ProjectRefineContext {
  projectDir: string;
  metadata: Record<string, unknown>;
  content: string;
  document: RefineDocument;
  definition?: (typeof PROJECT_DOCUMENT_DEFINITIONS)[number];
  brief?: Parameters<typeof validateDocument>[4];
  input: GenerateInput;
  otherDocuments: Array<{ name: string; content: string }>;
}

async function loadProjectRefineContext(projectSlug: string, filename: string): Promise<ProjectRefineContext> {
  assertMarkdownFilename(filename);
  const projectDir = resolveProjectDirectory(projectSlug);
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8"));
    metadata = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { /* Reference material is optional. */ }
  let content: string;
  try {
    content = await readFile(path.join(projectDir, filename), "utf8");
  } catch (error) {
    throw new Error(`无法读取 Markdown 文件：${filename}`, { cause: error });
  }
  const profile = resolveContentProfile(metadata);
  const briefValue = metadata.projectBrief;
  const brief = briefValue && typeof briefValue === "object" && !Array.isArray(briefValue)
    ? briefValue as Parameters<typeof validateDocument>[4]
    : undefined;
  const input: GenerateInput = {
    projectName: typeof metadata.projectName === "string" ? metadata.projectName : projectSlug,
    topic: typeof metadata.topic === "string" ? metadata.topic : projectSlug,
    platform: typeof metadata.platform === "string" ? metadata.platform : "未指定平台",
    contentSubject: profile.contentSubject || "未指定内容主体",
    contentDomain: profile.contentDomain || "未指定内容领域",
    style: typeof metadata.style === "string" ? metadata.style : "未指定风格",
    targetAudience: typeof metadata.targetAudience === "string" ? metadata.targetAudience : "目标用户",
    extraRequirements: typeof metadata.extraRequirements === "string" ? metadata.extraRequirements : "",
  };
  const otherDocuments: Array<{ name: string; content: string }> = (await Promise.all(PROJECT_DOCUMENT_DEFINITIONS
    .filter((item) => item.filename !== filename)
    .map(async (item): Promise<{ name: string; content: string } | null> => {
      try { return { name: item.filename, content: await readFile(path.join(projectDir, item.filename), "utf8") }; } catch { return null; }
    })))
    .filter((item): item is { name: string; content: string } => item !== null);
  return {
    projectDir,
    metadata,
    content,
    document: { label: filename.replace(/\.md$/i, ""), filename, content },
    definition: PROJECT_DOCUMENT_DEFINITIONS.find((item) => item.filename === filename),
    brief,
    input,
    otherDocuments,
  };
}

function validateRefinedProjectContent(
  content: string,
  context: ProjectRefineContext,
  allowRecordedResults = false,
): string[] {
  if (!context.definition) return [];
  return validateDocument(content, context.definition, context.input, context.otherDocuments, context.brief, { allowRecordedResults });
}

const FIXED_SPEECH_RATE_PATTERN = /\d{2,3}\s*字\s*[\/／每]\s*分钟/u;
const CONFIRMATION_EXECUTION_REMINDER_PATTERN = /(?:手机|封面).{0,12}(?:预览|回放)|(?:先|需要|建议|完成后).{0,10}(?:试录|录一遍|拍一遍|试听|听(?:一下)?语气)/u;

function replaceMarkdownSectionBody(content: string, heading: string, transform: (body: string) => string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|\\n)(##\\s+${escaped}\\s*\\n)([\\s\\S]*?)(?=\\n##\\s+|$)`, "u");
  return content.replace(pattern, (_match, prefix: string, header: string, body: string) => `${prefix}${header}${transform(body)}`);
}

const REVIEW_CHECKPOINTS = ["24 小时", "72 小时", "7 天"] as const;

function normalizePublishReviewTable(content: string): string {
  return replaceMarkdownSectionBody(content, "数据复盘", (body) => {
    if (REVIEW_CHECKPOINTS.every((checkpoint) => reviewCheckpointHasUsableData(body, checkpoint, true))) return body;
    return [
      "| 回收节点 | 播放与停留 | 互动与评论 | 结论 |",
      "| --- | --- | --- | --- |",
      "| 24 小时 | 发布后填写 | 发布后填写 | 发布后填写 |",
      "| 72 小时 | 发布后填写 | 发布后填写 | 发布后填写 |",
      "| 7 天 | 发布后填写 | 发布后填写 | 发布后填写 |",
    ].join("\n");
  });
}

/** 对可确定判断的机械规则做本地兜底，避免模型已修好大部分内容后卡在同一条校验上。 */
export function normalizeAutomaticRepairCandidate(content: string, filename: string): string {
  if (filename === "03_发布与复盘.md") return normalizePublishReviewTable(content).trim();
  if (filename !== "01_创作简报.md") return content;
  let normalized = replaceMarkdownSectionBody(content, "人工确认", (body) => {
    const kept = body.split("\n").filter((line) => {
      const text = line.trim();
      if (!text) return true;
      return !FIXED_SPEECH_RATE_PATTERN.test(text) && !CONFIRMATION_EXECUTION_REMINDER_PATTERN.test(text);
    });
    const meaningful = kept.some((line) => line.replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)/u, "").trim());
    return meaningful ? kept.join("\n").trimEnd() : "无。";
  });
  normalized = normalized.split("\n").map((line) => {
    if (!FIXED_SPEECH_RATE_PATTERN.test(line)) return line;
    const prefix = line.match(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)/u)?.[0] || "";
    return `${prefix}口播时长由最终逐字稿与镜头时间码共同校验。`;
  }).join("\n");
  return normalized.replace(/\n{3,}/gu, "\n\n").trim();
}

async function parseRefinedCandidate(raw: string, filename: string): Promise<string> {
  try {
    return parseRefinedContent(raw, [filename])[filename];
  } catch (error) {
    const reason = error instanceof Error ? error.message : "模型输出格式不正确";
    const repairedRaw = await callModel(buildRefineRepairPrompt(raw, filename, reason));
    return parseRefinedContent(repairedRaw, [filename])[filename];
  }
}

async function generateRefinedProjectContent(
  context: ProjectRefineContext,
  feedback: string,
  allowRecordedResults = false,
  automaticRepair = false,
): Promise<string> {
  if (!automaticRepair) {
    const raw = await callModel(buildRefinePrompt([context.document], feedback.trim(), referencePackFromMetadata(context.metadata)));
    const candidate = await parseRefinedCandidate(raw, context.document.filename);
    const errors = validateRefinedProjectContent(candidate, context, allowRecordedResults);
    if (errors.length) throw new Error(`修改结果未通过质量门：${errors.join("；")}`);
    return candidate;
  }

  let document = context.document;
  let instruction = feedback.trim();
  let remainingErrors: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const raw = await callModel(buildRefinePrompt([document], instruction, referencePackFromMetadata(context.metadata)));
    const parsed = await parseRefinedCandidate(raw, context.document.filename);
    const candidate = normalizeAutomaticRepairCandidate(parsed, context.document.filename);
    remainingErrors = validateRefinedProjectContent(candidate, context, allowRecordedResults);
    if (!remainingErrors.length) return candidate;
    document = { ...document, content: candidate };
    instruction = `上一版自动修复后仍有以下校验错误，请只针对这些剩余问题继续修复，不要恢复已经删除的内容：\n${remainingErrors.map((error, index) => `${index + 1}. ${error}`).join("\n")}\n必须输出完整文档，并保留已经通过校验的结构、观点和事实边界。`;
  }
  throw new Error(`自动修复后仍未通过质量门：${remainingErrors.join("；")}`);
}

export function automaticRepairFeedback(filename: string, validationErrors: string[]): string {
  const numberedErrors = validationErrors.map((error, index) => `${index + 1}. ${error}`).join("\n");
  return `这是程序发起的自动质量修复，不是用户新增的创作要求。请直接修复“${filename}”中的以下校验问题：\n${numberedErrors}\n\n修复规则：\n- 保留原文已经成立的核心观点、事实边界和标题结构；\n- 只删除重复解释、无必要扩写和错误归类，不把信息改成空泛占位语；\n- 涉及长度上限时，在不丢失关键信息的前提下压缩到限制以内；\n- “人工确认”只保留确实需要用户选择、补充或核实的事项，普通执行提醒移入合适的执行章节或删除；\n- 不凭空新增事实、案例、承诺、固定语速或用户未提供的选择；\n- 输出完整可替换的 Markdown 文档。`;
}

/** 修改一个项目文件并另存，不覆盖原文。 */
export async function refineProjectFile(
  projectSlug: string,
  filename: string,
  feedback: string,
): Promise<ContentFile> {
  if (!feedback.trim()) throw new Error("修改意见不能为空。");
  const context = await loadProjectRefineContext(projectSlug, filename);
  const refinedContent = await generateRefinedProjectContent(context, feedback);
  const outputName = await availableRevisedFilename(context.projectDir, filename);
  await archiveDocumentVersion(projectSlug, filename, context.content, "refine-source");
  await archiveDocumentVersion(projectSlug, filename, refinedContent, "refine-result");
  await writeMarkdown(path.join(context.projectDir, outputName), refinedContent);
  return { name: outputName, content: refinedContent };
}

export interface AutomaticRepairResult extends ContentFile {
  repaired: boolean;
  previousValidationErrors: string[];
}

/** 根据当前质量门错误自动修复原文；通过复检后才覆盖，并保留覆盖前版本。 */
export async function autoRepairProjectFile(projectSlug: string, filename: string): Promise<AutomaticRepairResult> {
  const context = await loadProjectRefineContext(projectSlug, filename);
  if (!context.definition) throw new Error("当前文件不属于可自动修复的核心文档。");
  const validationErrors = validateRefinedProjectContent(context.content, context, true);
  if (!validationErrors.length) {
    return { name: filename, content: context.content, repaired: false, previousValidationErrors: [] };
  }
  const repairedContent = await generateRefinedProjectContent(
    context,
    automaticRepairFeedback(filename, validationErrors),
    true,
    true,
  );
  await archiveDocumentVersion(projectSlug, filename, context.content, "auto-repair");
  await writeMarkdown(path.join(context.projectDir, filename), repairedContent);
  await syncProjectDerivedState(projectSlug);
  return { name: filename, content: repairedContent, repaired: true, previousValidationErrors: validationErrors };
}

/** 扫描素材目录并将索引保存到指定项目。 */
export async function scanProjectAssets(projectSlug: string, assetPath: string): Promise<ContentFile> {
  if (!assetPath.trim()) throw new Error("素材文件夹路径不能为空。");
  const projectDir = resolveProjectDirectory(projectSlug);
  const assets = await scanAssets(assetPath.trim());
  const content = assetsToMarkdown(assetPath.trim(), assets);
  const name = "00_素材索引.md";
  await writeMarkdown(path.join(projectDir, name), content);
  return { name, content };
}
