import { NextResponse } from "next/server";
import {
  generateProject,
  GenerationCancelledError,
  type GenerationDocumentProgress,
  GenerationStageError,
  type GenerationJobStatus,
  type GenerationStatusUpdate,
} from "../../../../src/services/contentWorkflow";
import type { GenerateInput } from "../../../../src/prompts/generatePrompt";
import { resolveContentProfile } from "../../../../src/utils/contentProfile";
import { removeTempProjectDirectory } from "../../../../src/services/projectManager";
import { PROJECT_DOCUMENT_DEFINITIONS } from "../../../../src/utils/documentDefinitions";
import { formatDuration } from "../../../../src/utils/generationTiming";
import type { GenerationModelCallRecord } from "../../../../src/services/documentGeneration";
import { markIdeaConverted } from "../../../../src/services/ideaManager";
import { runWithWebModelAccess } from "../../../lib/model-access";
import { getWebModelAccess } from "../../../../src/services/webModelAccess";
import { assertSameOrigin, publicRequestOrigin, readRequestJson } from "../_utils";
import {
  getPersistedGenerationJob,
  publicPersistedGenerationJob,
  putPersistedGenerationJob,
  updatePersistedGenerationJob,
  usesNetlifyPersistentGeneration,
  type PersistedGenerationJob,
} from "../../../../src/services/netlifyGenerationStore";

export const runtime = "nodejs";
// Supported hosts such as Vercel use this upper bound; hosts that ignore it
// still receive the event-stream keepalive returned by POST below.
export const maxDuration = 300;

interface GenerationJobSnapshot {
  jobId: string;
  status: GenerationJobStatus;
  currentDocument: string;
  progress: number;
  message: string;
  cancelled: boolean;
  pauseRequested: boolean;
  resumeStatus?: GenerationJobStatus;
  resumeWaiters: Array<() => void>;
  tempDir?: string;
  abortController: AbortController;
  timings: Array<{ label: string; durationMs: number }>;
  modelCalls: GenerationModelCallRecord[];
  generationProgress: GenerationDocumentProgress[];
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  durationLabel?: string;
  updatedAt: string;
}

const jobs = new Map<string, GenerationJobSnapshot>();

type ApiErrorStage = "generate" | "model" | "parse" | "write";
type GenerateApiPayload = Record<string, unknown>;

function initialGenerationProgress(): GenerationDocumentProgress[] {
  return PROJECT_DOCUMENT_DEFINITIONS.map((definition) => ({
    id: definition.number,
    title: definition.title,
    fileName: definition.filename,
    status: "waiting",
  }));
}

function persistedJob(jobId: string, body: Record<string, unknown>, sourceIdeaId: string): PersistedGenerationJob {
  const startedAt = new Date().toISOString();
  return {
    jobId,
    status: "creating",
    currentDocument: "创建项目任务",
    progress: 0,
    message: "任务已进入后台队列。",
    cancelled: false,
    pauseRequested: false,
    timings: [],
    modelCalls: [],
    generationProgress: initialGenerationProgress(),
    startedAt,
    updatedAt: startedAt,
    payload: body,
    sourceIdeaId: sourceIdeaId || undefined,
    dispatchToken: crypto.randomUUID(),
  };
}

async function dispatchNetlifyBackgroundJob(request: Request, jobId: string, apiKey: string, dispatchToken: string): Promise<void> {
  const endpoint = new URL("/.netlify/functions/generate-project-background", publicRequestOrigin(request));
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-piance-dispatch-token": dispatchToken,
      // The user-owned key stays in this short-lived internal request. It is
      // deliberately never added to the Blob-backed job record.
      "x-piance-model-key": apiKey,
    },
    body: JSON.stringify({ jobId }),
  });
  if (response.status !== 202) throw new Error(`后台任务派发失败（HTTP ${response.status}）。`);
}

function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空。`);
  return value.trim();
}

function preference(value: unknown, automaticValue: string): string {
  if (typeof value !== "string" || !value.trim()) return automaticValue;
  const normalized = value.trim();
  return /^(?:自动|自动判断|自动匹配)$/u.test(normalized) ? automaticValue : normalized;
}

function optionalReferenceMaterials(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (normalized.length > 40_000) throw new Error("参考材料不能超过 40,000 字符。");
  return normalized;
}

function jobIdFrom(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,120}$/u.test(value) ? value : crypto.randomUUID();
}

function createJob(jobId: string): GenerationJobSnapshot {
  const existing = jobs.get(jobId);
  if (existing?.cancelled) return existing;
  const startedAt = new Date().toISOString();
  const job: GenerationJobSnapshot = {
    jobId,
    status: "creating",
    currentDocument: "创建项目目录",
    progress: 5,
    message: "",
    cancelled: false,
    pauseRequested: false,
    resumeWaiters: [],
    abortController: new AbortController(),
    timings: [],
    modelCalls: [],
    generationProgress: initialGenerationProgress(),
    startedAt,
    updatedAt: startedAt,
  };
  jobs.set(jobId, job);
  return job;
}

function updateJob(job: GenerationJobSnapshot, update: GenerationStatusUpdate): void {
  if (update.status === "paused") {
    job.status = "paused";
  } else if (job.pauseRequested && update.status !== "failed" && update.status !== "partial" && update.status !== "cancelled" && update.status !== "completed") {
    job.resumeStatus = update.status;
    job.status = "paused";
  } else {
    job.status = update.status;
  }
  if (update.currentDocument !== undefined) job.currentDocument = update.currentDocument;
  if (update.progress !== undefined) job.progress = update.progress;
  if (update.message !== undefined) job.message = update.message;
  if (update.generationProgress !== undefined) job.generationProgress = update.generationProgress;
  job.updatedAt = new Date().toISOString();
}

function failActiveDocuments(job: GenerationJobSnapshot, message: string): void {
  job.generationProgress = job.generationProgress.map((document) => {
    if (document.status === "generating" || document.status === "validating" || document.status === "repairing") {
      return { ...document, status: "failed", message };
    }
    return document;
  });
}

function finishJob(job: GenerationJobSnapshot, endedAt = new Date().toISOString()): void {
  job.endedAt = endedAt;
  job.durationMs = Math.max(0, Date.parse(endedAt) - Date.parse(job.startedAt));
  job.durationLabel = formatDuration(job.durationMs);
  job.updatedAt = endedAt;
}

function publicJob(job: GenerationJobSnapshot) {
  return {
    jobId: job.jobId,
    status: job.status,
    currentDocument: job.currentDocument,
    progress: job.progress,
    message: job.message,
    timings: job.timings,
    modelCalls: job.modelCalls,
    generationProgress: job.generationProgress,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    durationMs: job.durationMs,
    durationLabel: job.durationLabel,
    updatedAt: job.updatedAt,
    canPause: !["idle", "partial", "completed", "cancelled", "failed"].includes(job.status),
    canResume: job.status === "paused",
  };
}

function releasePausedJob(job: GenerationJobSnapshot): void {
  const waiters = job.resumeWaiters.splice(0);
  for (const resolve of waiters) resolve();
}

async function waitIfPaused(job: GenerationJobSnapshot): Promise<void> {
  while (job.pauseRequested && !job.cancelled) {
    await new Promise<void>((resolve) => job.resumeWaiters.push(resolve));
  }
}

function errorPayload(error: unknown, stage: ApiErrorStage, status = 400, job?: GenerationJobSnapshot): { payload: GenerateApiPayload; status: number } {
  const message = error instanceof Error ? error.message : String(error || "生成失败。");
  const details = error && typeof error === "object" ? error as { status?: unknown; code?: unknown } : {};
  const errorStatus = typeof details.status === "number" && details.status >= 400 && details.status <= 599 ? details.status : status;
  const errorCode = typeof details.code === "string" ? details.code : undefined;
  if (job) {
    failActiveDocuments(job, message);
    finishJob(job);
    updateJob(job, { status: "failed", currentDocument: "生成失败", progress: 0, message });
  }
  return {
    status: errorStatus,
    payload: {
    ok: false,
    success: false,
    error: message,
    errorCode,
    stage,
    job: job ? publicJob(job) : undefined,
    },
  };
}

function jsonError(error: unknown, stage: ApiErrorStage, status = 400, job?: GenerationJobSnapshot) {
  const failure = errorPayload(error, stage, status, job);
  return NextResponse.json(failure.payload, { status: failure.status });
}

function eventStreamJsonResponse(work: () => Promise<GenerateApiPayload>): Response {
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, payload?: unknown) => {
        const data = payload === undefined ? "" : `data: ${JSON.stringify(payload)}\n`;
        controller.enqueue(encoder.encode(`event: ${event}\n${data}\n`));
      };
      send("ready", { ok: true });
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": keepalive\n\n")), 5_000);
      void work()
        .then((payload) => send("result", payload))
        .catch((error) => send("result", errorPayload(error, "generate", 500).payload))
        .finally(() => {
          if (heartbeat) clearInterval(heartbeat);
          controller.close();
        });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET(request: Request) {
  try {
    const jobId = new URL(request.url).searchParams.get("jobId") || "";
    if (usesNetlifyPersistentGeneration()) {
      const job = await getPersistedGenerationJob(jobId);
      return NextResponse.json({ ok: true, success: true, job: job ? publicPersistedGenerationJob(job) : { jobId, status: "idle", currentDocument: "", progress: 0, message: "", timings: [], modelCalls: [], generationProgress: initialGenerationProgress(), startedAt: "" } });
    }
    const job = jobs.get(jobId);
    if (!job) {
      return NextResponse.json({ ok: true, success: true, job: { jobId, status: "idle", currentDocument: "", progress: 0, message: "", timings: [], modelCalls: [], generationProgress: initialGenerationProgress(), startedAt: "" } });
    }
    return NextResponse.json({ ok: true, success: true, job: publicJob(job) });
  } catch (error) {
    return jsonError(error, "generate", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const jobId = new URL(request.url).searchParams.get("jobId") || "";
    if (usesNetlifyPersistentGeneration()) {
      const job = await updatePersistedGenerationJob(jobId, (current) => {
        const endedAt = new Date().toISOString();
        return {
          ...current,
          cancelled: true,
          pauseRequested: false,
          status: "cancelled",
          currentDocument: "已撤销",
          progress: 0,
          message: "已撤销生成。",
          endedAt,
          durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(current.startedAt)),
          durationLabel: formatDuration(Math.max(0, Date.parse(endedAt) - Date.parse(current.startedAt))),
        };
      });
      if (!job) return jsonError(new Error("生成任务不存在或已过期。"), "generate", 404);
      return NextResponse.json({ ok: true, success: true, cancelled: true, job: publicPersistedGenerationJob(job) });
    }
    const job = jobs.get(jobId);
    if (!job) {
      const cancelled = createJob(jobId || crypto.randomUUID());
      cancelled.cancelled = true;
      finishJob(cancelled);
      updateJob(cancelled, { status: "cancelled", currentDocument: "已撤销", progress: 0, message: "已撤销生成，本地临时文件已清理。" });
      return NextResponse.json({ ok: true, success: true, cancelled: true, job: publicJob(cancelled) });
    }

    job.cancelled = true;
    job.pauseRequested = false;
    releasePausedJob(job);
    job.abortController.abort();
    finishJob(job);
    updateJob(job, { status: "cancelled", currentDocument: "已撤销", progress: 0, message: "已撤销生成，本地临时文件已清理。" });
    if (job.tempDir) {
      try {
        await removeTempProjectDirectory(job.tempDir);
      } catch (error) {
        job.message = `已撤销生成，临时目录清理需稍后重试：${error instanceof Error ? error.message : String(error)}`;
      }
    }
    return NextResponse.json({ ok: true, success: true, cancelled: true, job: publicJob(job) });
  } catch (error) {
    return jsonError(error, "write", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await readRequestJson(request);
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    const action = body.action;
    if (usesNetlifyPersistentGeneration()) {
      const job = await updatePersistedGenerationJob(jobId, (current) => {
        if (["partial", "completed", "cancelled", "failed"].includes(current.status)) throw new Error("当前任务已经结束，无法修改状态。");
        if (action === "pause") {
          return { ...current, pauseRequested: true, resumeStatus: current.status, status: "paused", message: "当前模型请求完成后暂停，不会开始下一份文档。" };
        }
        if (action === "resume") {
          const status = current.resumeStatus && current.resumeStatus !== "paused" ? current.resumeStatus : "generatingCore";
          return { ...current, pauseRequested: false, status, message: "任务已恢复。" };
        }
        throw new Error("不支持的任务操作。");
      });
      if (!job) return jsonError(new Error("生成任务不存在或已过期。"), "generate", 404);
      return NextResponse.json({ ok: true, success: true, job: publicPersistedGenerationJob(job) });
    }
    const job = jobs.get(jobId);
    if (!job) return jsonError(new Error("生成任务不存在或服务已重启。"), "generate", 404);
    if (["partial", "completed", "cancelled", "failed"].includes(job.status)) {
      return jsonError(new Error("当前任务已经结束，无法修改状态。"), "generate", 409);
    }
    if (action === "pause") {
      job.pauseRequested = true;
      job.resumeStatus = job.status;
      updateJob(job, { status: "paused", currentDocument: job.currentDocument, message: "当前请求完成后暂停，不会开始下一份文档。" });
    } else if (action === "resume") {
      job.pauseRequested = false;
      const status = job.resumeStatus && job.resumeStatus !== "paused" ? job.resumeStatus : "generatingCore";
      releasePausedJob(job);
      updateJob(job, { status, currentDocument: job.currentDocument, message: "任务已恢复。" });
    } else {
      return jsonError(new Error("不支持的任务操作。"), "generate", 400);
    }
    return NextResponse.json({ ok: true, success: true, job: publicJob(job) });
  } catch (error) {
    return jsonError(error, "generate", 400);
  }
}

async function runGeneration(request: Request, body: Record<string, unknown>, job: GenerationJobSnapshot, sourceIdeaId: string): Promise<GenerateApiPayload> {
  try {
    const jobId = job.jobId;
    request.signal.addEventListener("abort", () => {
      job.cancelled = true;
      job.pauseRequested = false;
      releasePausedJob(job);
      job.abortController.abort();
      finishJob(job);
      updateJob(job, { status: "cancelled", currentDocument: "已撤销", progress: 0, message: "已撤销生成，本地临时文件已清理。" });
    }, { once: true });

    const profile = resolveContentProfile(body);
    const topic = required(body.topic, "选题主题");
    const projectName = typeof body.projectName === "string" && body.projectName.trim() ? body.projectName.trim() : topic;
    const input: GenerateInput = {
      projectName,
      topic,
      platform: preference(body.platform, "请结合选题与账号记忆自动选择最合适的发布平台"),
      contentSubject: profile.contentSubject || "请结合选题与账号记忆自动推断内容主体",
      contentDomain: profile.contentDomain || "请结合选题与账号记忆自动推断内容领域",
      style: preference(body.style, "请结合选题与账号记忆自动匹配自然、具体的表达方式"),
      targetAudience: preference(body.targetUser, "请结合选题与账号记忆自动推断最相关的目标用户"),
      extraRequirements: typeof body.extra === "string" ? body.extra.trim() : "",
      referenceMaterials: optionalReferenceMaterials(body.referenceMaterials),
    };
    const activeJob = job;
    const result = await runWithWebModelAccess(request, () => generateProject(input, {
      jobId,
      generationStartedAt: activeJob.startedAt,
      signal: activeJob.abortController.signal,
      isCancelled: () => activeJob.cancelled,
      waitIfPaused: () => waitIfPaused(activeJob),
      onTempDir: (tempDir) => {
        activeJob.tempDir = tempDir;
      },
      onStatus: (update) => {
        updateJob(activeJob, update);
      },
      onTiming: (label, durationMs) => {
        activeJob.timings.push({ label, durationMs });
      },
      onModelCall: (record) => {
        activeJob.modelCalls.push(record);
      },
    }));
    if (job.cancelled) throw new GenerationCancelledError();
    if (sourceIdeaId) {
      try {
        await markIdeaConverted(sourceIdeaId, result.projectSlug);
      } catch (markError) {
        console.warn(`灵感转换状态写入失败：${markError instanceof Error ? markError.message : String(markError)}`);
      }
    }
    finishJob(job);
    const rootFailure = Object.values(result.documentsStatus).find((record) => record.documentStatus === "failed");
    const blockedCount = Object.values(result.documentsStatus).filter((record) => record.documentStatus === "blocked").length;
    updateJob(job, {
      status: result.status === "complete" ? "completed" : result.status,
      currentDocument: result.status === "complete" ? "3 份核心工作稿" : rootFailure?.fileName || "生成已结束",
      progress: Math.round((result.files.length / PROJECT_DOCUMENT_DEFINITIONS.length) * 100),
      message: result.status === "complete"
        ? ""
        : result.deadlineReached
          ? `任务达到 06:00 截止时间，已保存 ${result.files.length}/${PROJECT_DOCUMENT_DEFINITIONS.length} 份通过校验的核心工作稿。`
          : rootFailure
            ? `${rootFailure.fileName} 生成失败：${rootFailure.validationErrors.join("；")}${blockedCount ? `；另有 ${blockedCount} 份下游文档因此未生成` : ""}`
            : `${result.files.length}/${PROJECT_DOCUMENT_DEFINITIONS.length} 份核心工作稿可用。`,
    });
    return { ok: true, success: true, job: publicJob(job), ...result };
  } catch (error) {
    if (error instanceof GenerationCancelledError) {
      finishJob(job);
      updateJob(job, { status: "cancelled", currentDocument: "已撤销", progress: 0, message: "已撤销生成，本地临时文件已清理。" });
      return { ok: false, success: false, cancelled: true, error: "已撤销生成，本地临时文件已清理。", stage: "generate", job: publicJob(job) };
    }
    if (error instanceof GenerationStageError) {
      return errorPayload(error, error.stage, 400, job).payload;
    }
    return errorPayload(error, "generate", 400, job).payload;
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readRequestJson(request);
    if (usesNetlifyPersistentGeneration()) {
      // Keep the same browser-cookie validation used by local generation.
      const access = getWebModelAccess(request);
      const jobId = jobIdFrom(body.jobId);
      const sourceIdeaId = typeof body.ideaId === "string" ? body.ideaId.trim() : "";
      const job = persistedJob(jobId, body, sourceIdeaId);
      await putPersistedGenerationJob(job);
      try {
        await dispatchNetlifyBackgroundJob(request, jobId, access.config.apiKey, job.dispatchToken!);
      } catch (error) {
        const failedAt = new Date().toISOString();
        job.status = "failed";
        job.dispatchToken = undefined;
        job.currentDocument = "任务派发失败";
        job.message = error instanceof Error ? error.message : String(error);
        job.endedAt = failedAt;
        job.durationMs = Math.max(0, Date.parse(failedAt) - Date.parse(job.startedAt));
        job.durationLabel = formatDuration(job.durationMs);
        await putPersistedGenerationJob(job);
        throw error;
      }
      return NextResponse.json({ ok: true, success: true, accepted: true, job: publicPersistedGenerationJob(job) }, { status: 202 });
    }
    const job = createJob(jobIdFrom(body.jobId));
    if (job.cancelled) throw new GenerationCancelledError();
    const sourceIdeaId = typeof body.ideaId === "string" ? body.ideaId.trim() : "";
    return eventStreamJsonResponse(() => runGeneration(request, body, job, sourceIdeaId));
  } catch (error) {
    return jsonError(error, "generate", 400);
  }
}
