import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { GenerateInput } from "../prompts/generatePrompt.js";
import {
  executionContext,
  executionDocumentInstructions,
  productionContext,
  qualityReviewContext,
  QUALITY_REVIEW_CONTEXT_FILES,
} from "../prompts/enhancePrompt.js";
import { CORE_PROJECT_DOCUMENT_DEFINITIONS, PROJECT_DOCUMENT_DEFINITIONS } from "../utils/documentDefinitions.js";
import {
  buildRefinePrompt,
  buildRefineRepairPrompt,
  parseRefinedContent,
  type RefineDocument,
} from "../prompts/refinePrompt.js";
import { scanAssets, assetsToMarkdown } from "./assetScanner.js";
import { writeJson, writeMarkdown } from "./fileWriter.js";
import { callModel, combineModelRequestSignal, loadModelConfig } from "./modelClient.js";
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
  type GenerationModelCallRecord,
  type GeneratedDocumentResult,
} from "./documentGeneration.js";
import { syncProjectDerivedState } from "./projectLifecycle.js";
import { archiveDocumentVersion } from "./documentVersionStore.js";

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

/** CLI 与 Web 共用的完整生成流程。 */
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
    console.info(`[generation:${jobId}] model ${record.fileName} attempt=${record.attempt} status=${record.status} duration=${record.durationMs}ms kind=${record.failureKind || "none"} promptChars=${record.promptChars} totalTokens=${record.totalTokens ?? "unknown"}`);
    options.onModelCall?.(record);
  };
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

    const brief = await withStage("model", () => timed(jobId, "projectBrief 生成耗时", options, async () => {
      try {
        return await createProjectBrief(input, accountMemoryPrompt, taskSignal, recordModelCall);
      } catch (error) {
        if (options.signal?.aborted || options.isCancelled?.()) throw new GenerationCancelledError();
        throw error;
      }
    }));
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
      await options.waitIfPaused?.();
      assertNotCancelled(options);
      const accepted = [...results.values()].filter((result) => result.content).map((result) => ({ name: result.definition.filename, content: result.content as string }));
      let result: GeneratedDocumentResult;
      try {
        result = await generateValidatedDocument({
          definition, input, brief, context, accountMemoryPrompt, acceptedDocuments: accepted, signal: taskSignal,
          onState: (state, errors) => report(definition, state, errors),
          onModelCall: recordModelCall,
        });
      } catch (error) {
        if (options.signal?.aborted || options.isCancelled?.()) throw new GenerationCancelledError();
        throw error;
      }
      results.set(definition.number, result);
      if (result.content) await writeMarkdown(path.join(tempDir, result.definition.filename), result.content);
      report(definition, result.content ? "completed" : "failed", result.validationErrors);
    };

    const generateCoreBatch = async (queue: Array<(typeof CORE_PROJECT_DOCUMENT_DEFINITIONS)[number]>) => {
      let queueIndex = 0;
      await Promise.all(Array.from({ length: Math.min(3, Math.max(1, queue.length)) }, async () => {
        while (queueIndex < queue.length) {
          const definition = queue[queueIndex++];
          const available = [...results.values()]
            .filter((result) => result.content)
            .map((result) => ({ name: result.definition.filename, content: result.content as string }));
          const context = definition.number === "08"
            ? qualityReviewContext(available)
            : definition.number === "04" || definition.number === "05"
              ? productionContext(available)
              : "";
          if (definition.number === "08") {
            const missing = QUALITY_REVIEW_CONTEXT_FILES.filter((name) => !available.some((document) => document.name === name));
            if (missing.length) {
              const failed: GeneratedDocumentResult = { definition, repaired: false, validationErrors: [`依赖文档未通过校验：${missing.join("、")}`] };
              results.set(definition.number, failed);
              report(definition, "failed", failed.validationErrors);
              continue;
            }
          }
          await generateDefinition(definition, context);
        }
      }));
    };

    // 先生成质检和执行文档依赖的三份主文档；第二阶段仍保持三并发，
    // 但 04/05 可继承口播稿，08 也能审查真实内容，核心阶段仍是三轮请求。
    const firstPhaseNumbers = new Set(["01", "03", "06"]);
    await generateCoreBatch(CORE_PROJECT_DOCUMENT_DEFINITIONS.filter((definition) => firstPhaseNumbers.has(definition.number)));
    const qualityDefinition = CORE_PROJECT_DOCUMENT_DEFINITIONS.find((definition) => definition.number === "08")!;
    await generateCoreBatch([
      qualityDefinition,
      ...CORE_PROJECT_DOCUMENT_DEFINITIONS.filter((definition) => !firstPhaseNumbers.has(definition.number) && definition.number !== "08"),
    ]);
    assertNotCancelled(options);

    const acceptedCore = [...results.values()].filter((result) => result.content).map((result) => ({ name: result.definition.filename, content: result.content as string }));
    for (const result of [...results.values()].filter((item) => item.content)) {
      const others = acceptedCore.filter((item) => item.name !== result.definition.filename);
      const duplicateErrors = validateDocument(result.content as string, result.definition, input, others).filter((error) => error.includes("高度重复"));
      if (duplicateErrors.length) {
        results.set(result.definition.number, { ...result, content: undefined, validationErrors: duplicateErrors });
        await rm(path.join(tempDir, result.definition.filename), { force: true });
        report(result.definition, "failed", duplicateErrors);
      }
    }

    const qualityResult = results.get("08");
    if (qualityResult?.content) {
      const availableNames = new Set([...results.values()].filter((result) => result.content).map((result) => result.definition.filename));
      const missing = QUALITY_REVIEW_CONTEXT_FILES.filter((name) => !availableNames.has(name));
      if (missing.length) {
        const errors = [`依赖文档未通过校验：${missing.join("、")}`];
        results.set("08", { ...qualityResult, content: undefined, validationErrors: errors });
        await rm(path.join(tempDir, qualityResult.definition.filename), { force: true });
        report(qualityResult.definition, "failed", errors);
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
      const deadlineReached = taskSignal.aborted && taskSignal.reason instanceof DOMException && taskSignal.reason.name === "TimeoutError";
      const status = complete ? "complete" : files.length ? "partial" : "failed";
      await writeJson(path.join(tempDir, "project.json"), {
        ...projectMetadata(input, projectName, { startedAt: generationStartedAt, finishedAt, durationMs }, model, accountMemoryMetadata),
        projectBrief: brief,
        status,
        documentsStatus: Object.fromEntries(statusRecords.map((item) => [item.id, item])),
        generated: statusRecords.filter((item) => item.generated).map((item) => item.id),
        repaired: statusRecords.filter((item) => item.repaired).map((item) => item.id),
        failed: statusRecords.filter((item) => item.failed).map((item) => item.id),
        validationErrors: Object.fromEntries(statusRecords.filter((item) => item.validationErrors.length).map((item) => [item.id, item.validationErrors])),
        fallbackUsed: statusRecords.some((item) => item.documentStatus === "fallback"),
        fallbackDocuments: statusRecords.filter((item) => item.documentStatus === "fallback").map((item) => item.id),
        generationDeadlineMs: deadlineMs,
        generationDeadlineReached: deadlineReached,
        modelCalls,
      });
    });
    const projectDir = await withStage("write", () => finalizeTempProjectDirectory(tempDir, projectName));
    finalized = true;
    const projectSlug = path.basename(projectDir);
    await syncProjectDerivedState(projectSlug).catch((error) => {
      console.warn(`[generation:${jobId}] 项目派生状态同步失败：${error instanceof Error ? error.message : String(error)}`);
    });
    const documentsStatus = Object.fromEntries(statusRecords.map((record) => [record.id, record]));
    const failedDocuments = statusRecords
      .filter((record) => record.failed)
      .map((record) => ({ id: record.id, fileName: record.fileName, validationErrors: record.validationErrors }));
    const status = files.length === PROJECT_DOCUMENT_DEFINITIONS.length ? "complete" : files.length ? "partial" : "failed";
    const deadlineReached = taskSignal.aborted && taskSignal.reason instanceof DOMException && taskSignal.reason.name === "TimeoutError";
    const message = status === "complete"
      ? undefined
      : deadlineReached
        ? `任务达到 ${formatDuration(deadlineMs)} 截止时间，已保存 ${files.length}/${PROJECT_DOCUMENT_DEFINITIONS.length} 份通过校验的文档。`
        : `${files.length}/${PROJECT_DOCUMENT_DEFINITIONS.length} 份文档可用，失败文档已保留为待重试状态。`;
    options.onStatus?.({
      status: status === "complete" ? "completed" : status,
      currentDocument: status === "complete" ? "10_发布承接话术.md" : "生成已结束",
      progress: files.length * 10,
      message,
      generationProgress: documentProgress(Object.fromEntries(progressState)),
    });
    return { projectSlug, projectName, files, status, documentsStatus, failedDocuments, modelCalls, deadlineReached };
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
  const deadlineMs = options.deadlineMs ?? PROJECT_GENERATION_DEADLINE_MS;
  const taskSignal = combineModelRequestSignal(options.signal, deadlineMs);
  const modelCalls: GenerationModelCallRecord[] = [];
  const regenerationId = `regenerate_${projectSlug}_${Date.now()}`;
  const recordModelCall = (record: GenerationModelCallRecord) => {
    modelCalls.push(record);
    console.info(`[generation:${regenerationId}] model ${record.fileName} attempt=${record.attempt} status=${record.status} duration=${record.durationMs}ms kind=${record.failureKind || "none"} promptChars=${record.promptChars} totalTokens=${record.totalTokens ?? "unknown"}`);
    options.onModelCall?.(record);
  };
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
    : await createProjectBrief(input, accountMemoryPrompt, taskSignal, recordModelCall);

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
  const targets = new Set(requested.size
    ? [...requested].filter((number) => PROJECT_DOCUMENT_DEFINITIONS.some((definition) => definition.number === number))
    : invalid.keys());
  const dependencyMap: Record<string, string[]> = {
    "08": ["01", "03", "06"],
    "09": ["01", "03", "04", "05", "08"],
    "10": ["01", "03", "06", "08", "09"],
  };
  const dependencyQueue = [...targets];
  for (let index = 0; index < dependencyQueue.length; index += 1) {
    for (const dependency of dependencyMap[dependencyQueue[index]] || []) {
      if (!invalid.has(dependency) || targets.has(dependency)) continue;
      targets.add(dependency);
      dependencyQueue.push(dependency);
    }
  }

  const regenerated = new Map<string, GeneratedDocumentResult>();
  const generate = async (definition: (typeof PROJECT_DOCUMENT_DEFINITIONS)[number], context = "") => {
    const accepted = [...existing.entries()]
      .filter(([name]) => name !== definition.filename)
      .map(([name, content]) => ({ name, content }));
    const result = await generateValidatedDocument({ definition, input, brief, context, accountMemoryPrompt, acceptedDocuments: accepted, signal: taskSignal, onModelCall: recordModelCall });
    regenerated.set(definition.number, result);
    if (result.content) existing.set(definition.filename, result.content);
  };
  const coreTargets = CORE_PROJECT_DOCUMENT_DEFINITIONS.filter((definition) => targets.has(definition.number) && definition.number !== "08");
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(3, Math.max(1, coreTargets.length)) }, async () => {
    while (index < coreTargets.length) {
      const definition = coreTargets[index++];
      const context = definition.number === "04" || definition.number === "05"
        ? productionContext([...existing.entries()].map(([name, content]) => ({ name, content })))
        : "";
      await generate(definition, context);
    }
  }));
  if (targets.has("08")) {
    const definition = PROJECT_DOCUMENT_DEFINITIONS.find((item) => item.number === "08")!;
    const missing = dependencyMap["08"].map((id) => PROJECT_DOCUMENT_DEFINITIONS.find((item) => item.number === id)!.filename).filter((name) => !existing.has(name));
    if (missing.length) regenerated.set("08", { definition, repaired: false, validationErrors: [`依赖文档未通过校验：${missing.join("、")}`] });
    else await generate(definition, qualityReviewContext([...existing.entries()].map(([name, content]) => ({ name, content }))));
  }
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
    const previousContent = allContents.get(definition.filename);
    if (result?.content) {
      if (previousContent) await archiveDocumentVersion(projectSlug, definition.filename, previousContent, "regenerate");
      await writeMarkdown(path.join(projectDir, definition.filename), result.content);
    }
  }

  const records: DocumentStatusRecord[] = PROJECT_DOCUMENT_DEFINITIONS.map((definition) => {
    const result = regenerated.get(definition.number);
    const content = existing.get(definition.filename);
    if (result?.content) return statusRecord(result);
    // 手动重试一份原本有效的文档失败时，保留原版本及其可用状态。
    if (result && content) {
      return {
        id: definition.number,
        fileName: definition.filename,
        status: "completed",
        documentStatus: "generated",
        generated: true,
        repaired: false,
        failed: false,
        validationErrors: [],
      };
    }
    if (result) return statusRecord(result);
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
  const deadlineReached = taskSignal.aborted && taskSignal.reason instanceof DOMException && taskSignal.reason.name === "TimeoutError";
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
    lastRegeneration: {
      requestedDocuments: [...requested],
      deadlineMs,
      deadlineReached,
      modelCalls,
    },
  });
  await syncProjectDerivedState(projectSlug);
  return {
    files: [...existing.entries()].map(([name, content]) => ({ name, content })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true })),
    status,
    documentsStatus,
    modelCalls,
    deadlineReached,
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
  await archiveDocumentVersion(projectSlug, filename, content, "refine-source");
  await archiveDocumentVersion(projectSlug, filename, refined[filename], "refine-result");
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
