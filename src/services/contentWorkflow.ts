import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  buildGeneratePrompt,
  buildGenerateRepairPrompt,
  fallbackCoreMarkdown,
  type GeneratedContent,
  hasCompleteExecutionPackage,
  type GenerateInput,
  parseGeneratedContent,
} from "../prompts/generatePrompt.js";
import {
  buildEnhancePrompt,
  buildFallbackExecutionPackage,
  executionContext,
  executionDocumentInstructions,
  ENHANCED_EXECUTION_FILES,
  type EnhancedExecutionPackage,
  parseEnhancedExecutionPackage,
} from "../prompts/enhancePrompt.js";
import { CORE_PROJECT_DOCUMENT_DEFINITIONS, EXECUTION_DOCUMENT_DEFINITIONS, PROJECT_DOCUMENT_DEFINITIONS } from "../utils/documentDefinitions.js";
import {
  buildRefinePrompt,
  buildRefineRepairPrompt,
  parseRefinedContent,
  type RefineDocument,
} from "../prompts/refinePrompt.js";
import { scanAssets, assetsToMarkdown } from "./assetScanner.js";
import { writeJson, writeMarkdown } from "./fileWriter.js";
import { callModel, loadModelConfig } from "./modelClient.js";
import { generateImage, type CoverRatio } from "./imageClient.js";
import {
  accountMemoryHasContent,
  accountMemorySnapshot,
  EMPTY_ACCOUNT_MEMORY,
  getAccountMemory,
  sanitizeAccountMemoryForPrompt,
  type AccountMemorySnapshot,
} from "./accountMemory.js";
import {
  createProjectDirectory,
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
  validateDocument,
  type DocumentQualityStatus,
  type DocumentState,
  type DocumentStatusRecord,
  type GeneratedDocumentResult,
} from "./documentGeneration.js";

export interface ContentFile {
  name: string;
  content: string;
  fallbackUsed?: boolean;
}

export interface GenerateResult {
  projectSlug: string;
  projectName: string;
  files: ContentFile[];
}

export type GenerationJobStatus =
  | "idle"
  | "creating"
  | "generatingCore"
  | "generatingExecution"
  | "generatingPublishCopy"
  | "writing"
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
export type GenerationDocumentProgressStatus = "waiting" | "generating" | "validating" | "completed" | "repairing" | "failed";

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
  onTiming?: (label: string, durationMs: number) => void;
}

export class GenerationCancelledError extends Error {
  constructor(message = "生成已撤销。") {
    super(message);
    this.name = "GenerationCancelledError";
  }
}

export class PartialGenerationError extends Error {
  projectSlug: string;
  projectName: string;
  files: ContentFile[];
  failedStage: string;

  constructor(message: string, detail: { projectSlug: string; projectName: string; files: ContentFile[]; failedStage: string; cause?: unknown }) {
    super(message, { cause: detail.cause });
    this.name = "PartialGenerationError";
    this.projectSlug = detail.projectSlug;
    this.projectName = detail.projectName;
    this.files = detail.files;
    this.failedStage = detail.failedStage;
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

export interface GeneratedCover {
  name: string;
  ratio: CoverRatio;
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

function parseWithStage<T>(task: () => T): T {
  try {
    return task();
  } catch (error) {
    if (error instanceof GenerationStageError || error instanceof GenerationCancelledError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new GenerationStageError("parse", message, { cause: error });
  }
}

function recordTiming(jobId: string, label: string, started: number, options: GenerateProjectOptions): void {
  const durationMs = Math.round(performance.now() - started);
  console.info(`[generation:${jobId}] ${label}: ${durationMs}ms`);
  options.onTiming?.(label, durationMs);
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

function progressWithCore(status: GenerationDocumentProgressStatus, message?: string): GenerationDocumentProgress[] {
  return documentProgress(Object.fromEntries(CORE_PROJECT_DOCUMENT_DEFINITIONS.map((definition) => [
    definition.filename,
    { status, message },
  ])));
}

function progressAfterCore(overrides: Partial<Record<string, { status: GenerationDocumentProgressStatus; message?: string }>> = {}): GenerationDocumentProgress[] {
  const coreCompleted = Object.fromEntries(CORE_PROJECT_DOCUMENT_DEFINITIONS.map((definition) => [
    definition.filename,
    { status: "completed" as const },
  ]));
  return documentProgress({ ...coreCompleted, ...overrides });
}

function progressWithAll(status: GenerationDocumentProgressStatus, message?: string): GenerationDocumentProgress[] {
  return documentProgress(Object.fromEntries(PROJECT_DOCUMENT_DEFINITIONS.map((definition) => [
    definition.filename,
    { status, message },
  ])));
}

function documentsFromGeneratedContent(content: GeneratedContent): ContentFile[] {
  return CORE_PROJECT_DOCUMENT_DEFINITIONS.map(({ key, filename }) => ({
    name: filename,
    content: content[key],
  }));
}

function selectedExecutionContextDocuments(content: GeneratedContent): ContentFile[] {
  const selected = new Set(["01_项目概览.md", "03_口播脚本.md", "04_分镜与剪辑节奏.md", "06_封面标题与发布文案.md", "08_内容质检报告.md"]);
  return documentsFromGeneratedContent(content).filter((document) => selected.has(document.name));
}

interface CoreContentResult {
  content: GeneratedContent;
  fallbackKeys: Set<string>;
}

function fallbackCoreContent(): GeneratedContent {
  return Object.fromEntries(CORE_PROJECT_DOCUMENT_DEFINITIONS.map(({ key }) => [
    key,
    fallbackCoreMarkdown(key),
  ])) as GeneratedContent;
}

function fallbackKeysFromContent(content: GeneratedContent): Set<string> {
  return new Set(CORE_PROJECT_DOCUMENT_DEFINITIONS
    .filter(({ key }) => content[key].includes("模型未完整返回"))
    .map(({ key }) => key));
}

function safeOutputPreview(raw: string): string {
  return raw
    .slice(0, 300)
    .replace(/(?:sk-|sess-|xox[baprs]-)[A-Za-z0-9_-]+/giu, "[REDACTED]")
    .replace(/\s+/gu, " ")
    .trim();
}

interface ExecutionPackageResult {
  executionPackage: EnhancedExecutionPackage;
  usedFallback: boolean;
}

async function parseCoreContent(raw: string, jobId: string, options: GenerateProjectOptions, accountMemoryPrompt?: string): Promise<CoreContentResult> {
  const parseStarted = performance.now();
  try {
    const content = parseWithStage(() => parseGeneratedContent(raw));
    recordTiming(jobId, "解析耗时", parseStarted, options);
    return { content, fallbackKeys: new Set() };
  } catch (error) {
    if (error instanceof GenerationStageError && error.stage !== "parse") throw error;
    recordTiming(jobId, "解析耗时", parseStarted, options);
    assertNotCancelled(options);
    const reason = error instanceof Error ? error.message : "输出格式无效";
    console.warn(`[generation:${jobId}] parse failed: ${safeOutputPreview(raw)}`);
    options.onStatus?.({
      status: "generatingCore",
      currentDocument: "01-08 核心文档修复中",
      progress: 0,
      message: "模型输出结构需要自动修复。",
      generationProgress: progressWithCore("repairing", "修复 JSON 结构"),
    });
    const repairPromptStarted = performance.now();
    const repairPrompt = buildGenerateRepairPrompt(raw, reason, accountMemoryPrompt);
    recordTiming(jobId, "自动修复 prompt 构造耗时", repairPromptStarted, options);
    console.info(`[generation:${jobId}] repair used`);
    const repairedRaw = await withStage("model", () => timed(jobId, "自动修复耗时", options, () => callModel(repairPrompt, { signal: options.signal })));
    assertNotCancelled(options);
    const repairParseStarted = performance.now();
    try {
      const repaired = parseGeneratedContent(repairedRaw, { allowDocumentFallback: true });
      const fallbackKeys = fallbackKeysFromContent(repaired);
      recordTiming(jobId, "自动修复解析耗时", repairParseStarted, options);
      if (fallbackKeys.size) console.warn(`[generation:${jobId}] fallback used: ${fallbackKeys.size}/8 core documents`);
      return { content: repaired, fallbackKeys };
    } catch {
      recordTiming(jobId, "自动修复解析耗时", repairParseStarted, options);
      console.warn(`[generation:${jobId}] parse failed: ${safeOutputPreview(repairedRaw)}`);
      console.warn(`[generation:${jobId}] fallback used: 8/8 core documents`);
      return {
        content: fallbackCoreContent(),
        fallbackKeys: new Set(CORE_PROJECT_DOCUMENT_DEFINITIONS.map(({ key }) => key)),
      };
    }
  }
}

async function generateExecutionPackage(
  input: GenerateInput,
  projectName: string,
  content: GeneratedContent,
  options: GenerateProjectOptions,
  accountMemoryPrompt?: string,
  accountMemory?: { used: boolean; snapshot: AccountMemorySnapshot },
): Promise<ExecutionPackageResult> {
  if (hasCompleteExecutionPackage(content)) {
    return {
      executionPackage: {
        finalExecutionScript: content.finalExecutionScript,
        postEngagementCopy: content.postEngagementCopy,
      },
      usedFallback: false,
    };
  }

  const jobId = options.jobId || "local";
  const model = await loadModelConfig().then((config) => config.model).catch(() => undefined);
  const metadata = projectMetadata(input, projectName, undefined, model, accountMemory);
  const documents = selectedExecutionContextDocuments(content);
  const promptStarted = performance.now();
  const prompt = buildEnhancePrompt({ projectName, metadata, documents, accountMemoryPrompt });
  recordTiming(jobId, "09/10 prompt 构造耗时", promptStarted, options);

  try {
    options.onStatus?.({
      status: "generatingExecution",
      currentDocument: "09_成片执行稿.md",
      progress: 80,
      generationProgress: progressAfterCore({
        "09_成片执行稿.md": { status: "generating" },
      }),
    });
    const raw = await timed(jobId, "09/10 模型请求耗时", options, () => callModel(prompt, { signal: options.signal }));
    assertNotCancelled(options);
    options.onStatus?.({
      status: "generatingPublishCopy",
      currentDocument: "10_发布承接话术.md",
      progress: 90,
      generationProgress: progressAfterCore({
        "09_成片执行稿.md": { status: "completed" },
        "10_发布承接话术.md": { status: "generating" },
      }),
    });
    const parseStarted = performance.now();
    const enhanced = parseEnhancedExecutionPackage(raw);
    recordTiming(jobId, "09/10 解析耗时", parseStarted, options);
    options.onStatus?.({
      status: "generatingPublishCopy",
      currentDocument: "10_发布承接话术.md",
      progress: 100,
      generationProgress: progressAfterCore({
        "09_成片执行稿.md": { status: "completed" },
        "10_发布承接话术.md": { status: "completed" },
      }),
    });
    return { executionPackage: enhanced, usedFallback: false };
  } catch (error) {
    assertNotCancelled(options);
    const detail = error instanceof Error ? error.message : "未知错误";
    console.warn(`[generation:${jobId}] fallback used: 09/10 (${detail.slice(0, 300)})`);
    options.onStatus?.({
      status: "generatingPublishCopy",
      currentDocument: "09/10 备用模板",
      progress: 100,
      message: "09/10 生成不完整，已写入备用模板。",
      generationProgress: progressAfterCore({
        "09_成片执行稿.md": { status: "failed", message: "生成失败" },
        "10_发布承接话术.md": { status: "failed", message: "生成失败" },
      }),
    });
    return { executionPackage: buildFallbackExecutionPackage(), usedFallback: true };
  }
}

async function writeCompleteProject(
  tempDir: string,
  input: GenerateInput,
  projectName: string,
  coreContent: GeneratedContent,
  executionPackage: EnhancedExecutionPackage,
  generationStartedAt: string,
  model?: string,
  accountMemory?: { used: boolean; snapshot: AccountMemorySnapshot },
  coreFallbackKeys: Set<string> = new Set(),
  executionFallbackUsed = false,
): Promise<ContentFile[]> {
  const files: ContentFile[] = [];
  for (const { key, filename: name } of CORE_PROJECT_DOCUMENT_DEFINITIONS) {
    const content = coreContent[key];
    await writeMarkdown(path.join(tempDir, name), content);
    files.push({ name, content, ...(coreFallbackKeys.has(key) ? { fallbackUsed: true } : {}) });
  }
  for (const { key, filename: name } of EXECUTION_DOCUMENT_DEFINITIONS) {
    const content = executionPackage[key];
    await writeMarkdown(path.join(tempDir, name), content);
    files.push({ name, content, ...(executionFallbackUsed ? { fallbackUsed: true } : {}) });
  }
  const generationFinishedAt = new Date().toISOString();
  const startedMs = Date.parse(generationStartedAt);
  const finishedMs = Date.parse(generationFinishedAt);
  const generationDurationMs = Number.isFinite(startedMs) && Number.isFinite(finishedMs)
    ? Math.max(0, finishedMs - startedMs)
    : 0;
  await writeJson(path.join(tempDir, "project.json"), {
    ...projectMetadata(input, projectName, {
    startedAt: generationStartedAt,
    finishedAt: generationFinishedAt,
    durationMs: generationDurationMs,
    }, model, accountMemory),
    fallbackUsed: coreFallbackKeys.size > 0 || executionFallbackUsed,
    fallbackDocuments: files
      .filter((file) => file.fallbackUsed)
      .map((file) => ({ name: file.name, fallbackUsed: true })),
  });
  return files;
}

/** CLI 与 Web 共用的完整生成流程。 */
export async function generateProject(input: GenerateInput, options: GenerateProjectOptions = {}): Promise<GenerateResult> {
  const jobId = options.jobId || `local_${Date.now()}`;
  let tempDir = "";
  let finalized = false;
  const projectName = input.projectName?.trim() || input.topic;
  const generationStartedAt = options.generationStartedAt || new Date().toISOString();
  const model = await loadModelConfig().then((config) => config.model).catch(() => undefined);
  const accountMemoryValue = await getAccountMemory().catch((error) => {
    console.warn(`[generation:${jobId}] 账号记忆读取失败，继续按空记忆生成：${error instanceof Error ? error.message : String(error)}`);
    return { ...EMPTY_ACCOUNT_MEMORY };
  });
  const accountMemoryUsed = accountMemoryHasContent(accountMemoryValue);
  const accountMemoryPrompt = accountMemoryUsed ? sanitizeAccountMemoryForPrompt(accountMemoryValue) : "";
  const accountMemoryMetadata = {
    used: accountMemoryUsed,
    snapshot: accountMemorySnapshot(accountMemoryValue),
  };

  try {
    assertNotCancelled(options);
    options.onStatus?.({ status: "creating", currentDocument: "统一项目简报", progress: 0, generationProgress: documentProgress() });
    tempDir = await withStage("write", () => timed(jobId, "创建项目目录耗时", options, () => createTempProjectDirectory(jobId)));
    options.onTempDir?.(tempDir);

    const brief = await withStage("model", () => timed(jobId, "projectBrief 生成耗时", options, () => createProjectBrief(input, accountMemoryPrompt, options.signal)));
    assertNotCancelled(options);

    const progressState = new Map<string, { status: GenerationDocumentProgressStatus; message?: string }>();
    const results = new Map<string, GeneratedDocumentResult>();
    const report = (definition: (typeof PROJECT_DOCUMENT_DEFINITIONS)[number], state: DocumentState, errors: string[] = []) => {
      progressState.set(definition.filename, { status: state, message: errors.join("；") || undefined });
      const completed = [...progressState.values()].filter((item) => item.status === "completed").length;
      options.onStatus?.({
        status: definition.number === "09" ? "generatingExecution" : definition.number === "10" ? "generatingPublishCopy" : "generatingCore",
        currentDocument: definition.filename,
        progress: completed * 10,
        generationProgress: documentProgress(Object.fromEntries(progressState)),
      });
    };
    const generateDefinition = async (definition: (typeof PROJECT_DOCUMENT_DEFINITIONS)[number], context = "") => {
      assertNotCancelled(options);
      const accepted = [...results.values()].filter((result) => result.content).map((result) => ({ name: result.definition.filename, content: result.content as string }));
      const result = await generateValidatedDocument({
        definition, input, brief, context, accountMemoryPrompt, acceptedDocuments: accepted, signal: options.signal,
        onState: (state, errors) => report(definition, state, errors),
      });
      results.set(definition.number, result);
      report(definition, result.content ? "completed" : "failed", result.validationErrors);
    };

    const coreQueue = [...CORE_PROJECT_DOCUMENT_DEFINITIONS];
    let queueIndex = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (queueIndex < coreQueue.length) {
        const definition = coreQueue[queueIndex++];
        await generateDefinition(definition);
      }
    }));
    assertNotCancelled(options);

    const acceptedCore = [...results.values()].filter((result) => result.content).map((result) => ({ name: result.definition.filename, content: result.content as string }));
    for (const result of [...results.values()].filter((item) => item.content)) {
      const others = acceptedCore.filter((item) => item.name !== result.definition.filename);
      const duplicateErrors = validateDocument(result.content as string, result.definition, input, others).filter((error) => error.includes("高度重复"));
      if (duplicateErrors.length) {
        results.set(result.definition.number, { ...result, content: undefined, validationErrors: duplicateErrors });
        report(result.definition, "failed", duplicateErrors);
      }
    }

    const validDocuments = () => [...results.values()].filter((result) => result.content).map((result) => ({ name: result.definition.filename, content: result.content as string }));
    for (const number of ["09", "10"] as const) {
      const definition = PROJECT_DOCUMENT_DEFINITIONS.find((item) => item.number === number)!;
      const requiredNames = number === "09"
        ? ["01_项目概览.md", "03_口播脚本.md", "04_分镜与剪辑节奏.md", "05_拍摄清单.md", "08_内容质检报告.md"]
        : ["01_项目概览.md", "03_口播脚本.md", "06_封面标题与发布文案.md", "08_内容质检报告.md", "09_成片执行稿.md"];
      const available = validDocuments();
      const missing = requiredNames.filter((name) => !available.some((document) => document.name === name));
      if (missing.length) {
        const failed: GeneratedDocumentResult = { definition, repaired: false, validationErrors: [`依赖文档未通过校验：${missing.join("、")}`] };
        results.set(number, failed);
        report(definition, "failed", failed.validationErrors);
      } else {
        await generateDefinition(definition, `${executionDocumentInstructions(number)}\n\n${executionContext(available, number)}`);
      }
    }

    assertNotCancelled(options);
    const orderedResults = PROJECT_DOCUMENT_DEFINITIONS.map((definition) => results.get(definition.number) || ({ definition, repaired: false, validationErrors: ["未生成"] }));
    const statusRecords = orderedResults.map(statusRecord);
    const files: ContentFile[] = [];
    options.onStatus?.({ status: "writing", currentDocument: "写入已通过校验的文档", progress: statusRecords.filter((item) => item.generated).length * 10, generationProgress: documentProgress(Object.fromEntries(progressState)) });
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
        ...projectMetadata(input, projectName, { startedAt: generationStartedAt, finishedAt, durationMs }, model, accountMemoryMetadata),
        projectBrief: brief,
        status: complete ? "complete" : files.length ? "partial" : "failed",
        documentsStatus: Object.fromEntries(statusRecords.map((item) => [item.id, item])),
        generated: statusRecords.filter((item) => item.generated).map((item) => item.id),
        repaired: statusRecords.filter((item) => item.repaired).map((item) => item.id),
        failed: statusRecords.filter((item) => item.failed).map((item) => item.id),
        validationErrors: Object.fromEntries(statusRecords.filter((item) => item.validationErrors.length).map((item) => [item.id, item.validationErrors])),
        fallbackUsed: statusRecords.some((item) => item.documentStatus === "fallback"),
        fallbackDocuments: statusRecords.filter((item) => item.documentStatus === "fallback").map((item) => item.id),
      });
    });
    const projectDir = await withStage("write", () => finalizeTempProjectDirectory(tempDir, projectName));
    finalized = true;
    const projectSlug = path.basename(projectDir);
    if (files.length < PROJECT_DOCUMENT_DEFINITIONS.length) {
      const failedCount = PROJECT_DOCUMENT_DEFINITIONS.length - files.length;
      throw new PartialGenerationError(`${files.length}/10 可用，${failedCount} 份生成失败。`, { projectSlug, projectName, files, failedStage: "document-validation" });
    }
    options.onStatus?.({ status: "completed", currentDocument: "10_发布承接话术.md", progress: 100, generationProgress: progressWithAll("completed") });
    return { projectSlug, projectName, files };
  } catch (error) {
    if (error instanceof GenerationCancelledError) {
      options.onStatus?.({ status: "cancelled", currentDocument: "已撤销", progress: 0 });
      throw error;
    }
    options.onStatus?.({
      status: "failed",
      currentDocument: "生成失败",
      progress: 0,
      message: error instanceof Error ? error.message : "生成失败。",
    });
    throw error;
  } finally {
    if (tempDir && !finalized) {
      try {
        await removeTempProjectDirectory(tempDir);
      } catch (cleanupError) {
        console.warn(`[generation:${jobId}] 临时目录清理失败：${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
    }
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

export async function generateEnhancedExecutionPackage(projectSlug: string): Promise<ContentFile[]> {
  const result = await regenerateProjectDocuments(projectSlug, ["09", "10"]);
  return result.files.filter((file) => file.name === "09_成片执行稿.md" || file.name === "10_发布承接话术.md");
}

export async function regenerateProjectDocuments(projectSlug: string, requestedNumbers: string[] = []): Promise<{ files: ContentFile[]; status: "complete" | "partial" | "failed"; documentsStatus: Record<string, DocumentStatusRecord> }> {
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
  const accountMemory = await getAccountMemory().catch(() => ({ ...EMPTY_ACCOUNT_MEMORY }));
  const accountMemoryPrompt = accountMemoryHasContent(accountMemory) ? sanitizeAccountMemoryForPrompt(accountMemory) : "";
  const briefValue = metadata.projectBrief;
  const brief = briefValue && typeof briefValue === "object" && !Array.isArray(briefValue)
    ? briefValue as Awaited<ReturnType<typeof createProjectBrief>>
    : await createProjectBrief(input, accountMemoryPrompt);

  const existing = new Map<string, string>();
  const invalid = new Map<string, string[]>();
  // 第一遍：读取所有文档，构建现有文档 Map
  const allContents = new Map<string, string>();
  for (const definition of PROJECT_DOCUMENT_DEFINITIONS) {
    try {
      const content = await readFile(path.join(projectDir, definition.filename), "utf8");
      allContents.set(definition.filename, content);
    } catch {
      // 文档缺失，稍后标记 invalid
    }
  }
  // 第二遍：校验每份文档，传入其余文档做跨文档重复检测
  for (const definition of PROJECT_DOCUMENT_DEFINITIONS) {
    const content = allContents.get(definition.filename);
    if (!content) {
      invalid.set(definition.number, ["文档缺失"]);
      continue;
    }
    const others = [...allContents.entries()]
      .filter(([name]) => name !== definition.filename)
      .map(([name, otherContent]) => ({ name, content: otherContent }));
    const errors = validateDocument(content, definition, input, others);
    if (errors.length) invalid.set(definition.number, errors);
    else existing.set(definition.filename, content);
  }

  const requested = new Set(requestedNumbers.map((number) => number.padStart(2, "0")));
  const targets = new Set(requested.size ? [...requested].filter((number) => invalid.has(number)) : invalid.keys());
  const dependencyMap: Record<string, string[]> = {
    "09": ["01", "03", "04", "05", "08"],
    "10": ["01", "03", "06", "08", "09"],
  };
  for (const number of [...targets]) {
    for (const dependency of dependencyMap[number] || []) if (invalid.has(dependency)) targets.add(dependency);
  }

  const regenerated = new Map<string, GeneratedDocumentResult>();
  const generate = async (definition: (typeof PROJECT_DOCUMENT_DEFINITIONS)[number], context = "") => {
    const accepted = [...existing.entries()].map(([name, content]) => ({ name, content }));
    const result = await generateValidatedDocument({ definition, input, brief, context, accountMemoryPrompt, acceptedDocuments: accepted });
    regenerated.set(definition.number, result);
    if (result.content) existing.set(definition.filename, result.content);
  };
  const coreTargets = CORE_PROJECT_DOCUMENT_DEFINITIONS.filter((definition) => targets.has(definition.number));
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(3, Math.max(1, coreTargets.length)) }, async () => {
    while (index < coreTargets.length) await generate(coreTargets[index++]);
  }));
  for (const number of ["09", "10"] as const) {
    if (!targets.has(number)) continue;
    const definition = PROJECT_DOCUMENT_DEFINITIONS.find((item) => item.number === number)!;
    const docs = [...existing.entries()].map(([name, content]) => ({ name, content }));
    const required = dependencyMap[number].map((id) => PROJECT_DOCUMENT_DEFINITIONS.find((item) => item.number === id)!.filename);
    const missing = required.filter((name) => !existing.has(name));
    if (missing.length) regenerated.set(number, { definition, repaired: false, validationErrors: [`依赖文档未通过校验：${missing.join("、")}`] });
    else await generate(definition, `${executionDocumentInstructions(number)}\n\n${executionContext(docs, number)}`);
  }

  for (const number of targets) {
    const definition = PROJECT_DOCUMENT_DEFINITIONS.find((item) => item.number === number);
    if (!definition) continue;
    const result = regenerated.get(number);
    if (result?.content) await writeMarkdown(path.join(projectDir, definition.filename), result.content);
    else await rm(path.join(projectDir, definition.filename), { force: true });
  }

  const records: DocumentStatusRecord[] = PROJECT_DOCUMENT_DEFINITIONS.map((definition) => {
    const result = regenerated.get(definition.number);
    if (result) return statusRecord(result);
    const content = existing.get(definition.filename);
    const completed = Boolean(content);
    // 检测现有文档是否含占位语
    const hasFallback = completed && PLACEHOLDER_PHRASES.some((phrase) => content!.includes(phrase));
    const documentStatus: DocumentQualityStatus = !completed ? "failed" : hasFallback ? "fallback" : "generated";
    return {
      id: definition.number,
      fileName: definition.filename,
      status: completed && !hasFallback ? "completed" : "failed",
      documentStatus,
      generated: completed && !hasFallback,
      repaired: false,
      failed: !completed || hasFallback,
      validationErrors: completed && !hasFallback ? [] : invalid.get(definition.number) || ["文档缺失"],
    };
  });
  const completedCount = records.filter((record) => record.generated).length;
  const status = completedCount === 10 ? "complete" : completedCount ? "partial" : "failed";
  const documentsStatus = Object.fromEntries(records.map((record) => [record.id, record]));
  await writeJson(path.join(projectDir, "project.json"), {
    ...metadata,
    projectBrief: brief,
    status,
    documentsStatus,
    generated: records.filter((record) => record.generated).map((record) => record.id),
    repaired: records.filter((record) => record.repaired).map((record) => record.id),
    failed: records.filter((record) => record.failed).map((record) => record.id),
    validationErrors: Object.fromEntries(records.filter((record) => record.validationErrors.length).map((record) => [record.id, record.validationErrors])),
    fallbackUsed: records.some((record) => record.documentStatus === "fallback"),
    fallbackDocuments: records.filter((record) => record.documentStatus === "fallback").map((record) => record.id),
    regeneratedAt: new Date().toISOString(),
  });
  return {
    files: [...existing.entries()].map(([name, content]) => ({ name, content })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true })),
    status,
    documentsStatus,
  };
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

/** 修改一个项目文件并另存，不覆盖原文。 */
export async function refineProjectFile(
  projectSlug: string,
  filename: string,
  feedback: string,
): Promise<ContentFile> {
  assertMarkdownFilename(filename);
  if (!feedback.trim()) throw new Error("修改意见不能为空。");
  const projectDir = resolveProjectDirectory(projectSlug);
  let content: string;
  try {
    content = await readFile(path.join(projectDir, filename), "utf8");
  } catch (error) {
    throw new Error(`无法读取 Markdown 文件：${filename}`, { cause: error });
  }
  const document: RefineDocument = { label: filename.replace(/\.md$/i, ""), filename, content };
  const raw = await callModel(buildRefinePrompt([document], feedback.trim()));
  let refined;
  try {
    refined = parseRefinedContent(raw, [filename]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "输出格式无效";
    const repairedRaw = await callModel(buildRefineRepairPrompt(raw, filename, reason));
    refined = parseRefinedContent(repairedRaw, [filename]);
  }
  const outputName = await availableRevisedFilename(projectDir, filename);
  await writeMarkdown(path.join(projectDir, outputName), refined[filename]);
  return { name: outputName, content: refined[filename] };
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

/** 根据视觉提示词生成封面，并持久化到当前项目 covers 目录。 */
export async function generateProjectCover(
  projectSlug: string,
  prompt: string,
  ratio: CoverRatio,
): Promise<GeneratedCover> {
  const projectDir = resolveProjectDirectory(projectSlug);
  try {
    if (!(await stat(projectDir)).isDirectory()) throw new Error("不是文件夹");
  } catch (error) {
    throw new Error(`项目不存在：${projectSlug}`, { cause: error });
  }
  const image = await generateImage(prompt, ratio);
  const coversDir = path.join(projectDir, "covers");
  await mkdir(coversDir, { recursive: true });
  const safeRatio = ratio.replace(":", "x");
  const name = `cover_${new Date().toISOString().replace(/[:.]/g, "-")}_${safeRatio}.${image.extension}`;
  await writeFile(path.join(coversDir, name), image.bytes);
  return { name, ratio };
}
