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
import { consumeFreeTrial, getTrialStatus } from "../../../lib/supabase/trial";
import { readRequestJson } from "../_utils";

export const runtime = "nodejs";

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
const ipWindows = new Map<string, { minuteStartedAt: number; minuteCount: number; dayStartedAt: number; dayCount: number }>();
const userWindows = new Map<string, { dayStartedAt: number; dayCount: number }>();

type ApiErrorStage = "generate" | "model" | "parse" | "write";

class ApiGateError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
    this.name = "ApiGateError";
  }
}

function initialGenerationProgress(): GenerationDocumentProgress[] {
  return PROJECT_DOCUMENT_DEFINITIONS.map((definition) => ({
    id: definition.number,
    title: definition.title,
    fileName: definition.filename,
    status: "waiting",
  }));
}

function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空。`);
  return value.trim();
}

function optional(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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
    if (document.status === "generating" || document.status === "repairing") {
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

function jsonError(error: unknown, stage: ApiErrorStage, status = 400, job?: GenerationJobSnapshot) {
  const message = error instanceof Error ? error.message : String(error || "生成失败。");
  if (job) {
    failActiveDocuments(job, message);
    finishJob(job);
    updateJob(job, { status: "failed", currentDocument: "生成失败", progress: 0, message });
  }
  return NextResponse.json({
    ok: false,
    success: false,
    error: message,
    errorCode: error instanceof ApiGateError ? error.code : undefined,
    stage,
    job: job ? publicJob(job) : undefined,
  }, { status });
}

function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("x-real-ip") || "unknown";
}

function assertRateLimit(request: Request, userId: string): void {
  const now = Date.now();
  const ip = clientIp(request);
  const minuteMs = 60_000;
  const dayMs = 24 * 60 * 60_000;
  const ipWindow = ipWindows.get(ip) || { minuteStartedAt: now, minuteCount: 0, dayStartedAt: now, dayCount: 0 };
  if (now - ipWindow.minuteStartedAt > minuteMs) {
    ipWindow.minuteStartedAt = now;
    ipWindow.minuteCount = 0;
  }
  if (now - ipWindow.dayStartedAt > dayMs) {
    ipWindow.dayStartedAt = now;
    ipWindow.dayCount = 0;
  }
  ipWindow.minuteCount += 1;
  ipWindow.dayCount += 1;
  ipWindows.set(ip, ipWindow);

  const userWindow = userWindows.get(userId) || { dayStartedAt: now, dayCount: 0 };
  if (now - userWindow.dayStartedAt > dayMs) {
    userWindow.dayStartedAt = now;
    userWindow.dayCount = 0;
  }
  userWindow.dayCount += 1;
  userWindows.set(userId, userWindow);

  if (ipWindow.minuteCount > 6) throw new ApiGateError("请求过于频繁，请稍后再试。", 429, "RATE_LIMITED");
  if (ipWindow.dayCount > 30 || userWindow.dayCount > 12) throw new ApiGateError("今日免费体验请求过多，请明天再试或配置自己的模型 API。", 429, "RATE_LIMITED");
}

async function authorizeGeneration(request: Request): Promise<void> {
  const status = await getTrialStatus();
  if (status.canUseCustomModel) return;
  if (!status.serverModelAvailable) throw new ApiGateError("服务器模型不可用，请先在设置中心配置自己的模型 API。", 503, "MODEL_UNAVAILABLE");
  if (!status.supabaseConfigured || !status.adminConfigured) throw new ApiGateError("免费体验服务未配置，请先配置 Supabase Auth。", 503, "TRIAL_UNAVAILABLE");
  if (!status.authenticated || !status.userId) throw new ApiGateError("请先登录后再使用免费体验生成。", 401, "LOGIN_REQUIRED");
  if (status.freeTrialRemaining <= 0) throw new ApiGateError("免费体验次数已用完，请在设置中心配置自己的模型 API。", 402, "TRIAL_EXHAUSTED");

  assertRateLimit(request, status.userId);
  try {
    await consumeFreeTrial(status.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/exhausted|用完|limit/i.test(message)) {
      throw new ApiGateError("免费体验次数已用完，请在设置中心配置自己的模型 API。", 402, "TRIAL_EXHAUSTED");
    }
    throw new ApiGateError("免费体验扣次失败，请稍后再试。", 500, "TRIAL_CONSUME_FAILED");
  }
}

export async function GET(request: Request) {
  try {
    const jobId = new URL(request.url).searchParams.get("jobId") || "";
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

export async function POST(request: Request) {
  let job: GenerationJobSnapshot | undefined;
  let sourceIdeaId = "";
  try {
    const body = await readRequestJson(request);
    const jobId = jobIdFrom(body.jobId);
    job = createJob(jobId);
    if (job.cancelled) throw new GenerationCancelledError();
    request.signal.addEventListener("abort", () => {
      if (!job) return;
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
    sourceIdeaId = typeof body.ideaId === "string" ? body.ideaId.trim() : "";
    const input: GenerateInput = {
      projectName,
      topic,
      platform: optional(body.platform, "小红书"),
      contentSubject: profile.contentSubject || "内容创作者",
      contentDomain: profile.contentDomain || "未指定",
      style: optional(body.style, "专业但通俗"),
      targetAudience: optional(body.targetUser, "对该选题感兴趣的人"),
      extraRequirements: typeof body.extra === "string" ? body.extra.trim() : "",
    };
    await authorizeGeneration(request);
    const result = await generateProject(input, {
      jobId,
      generationStartedAt: job.startedAt,
      signal: job.abortController.signal,
      isCancelled: () => Boolean(job?.cancelled),
      waitIfPaused: () => job ? waitIfPaused(job) : Promise.resolve(),
      onTempDir: (tempDir) => {
        if (job) job.tempDir = tempDir;
      },
      onStatus: (update) => {
        if (job) updateJob(job, update);
      },
      onTiming: (label, durationMs) => {
        job?.timings.push({ label, durationMs });
      },
      onModelCall: (record) => {
        job?.modelCalls.push(record);
      },
    });
    if (job.cancelled) throw new GenerationCancelledError();
    if (sourceIdeaId) {
      try {
        await markIdeaConverted(sourceIdeaId, result.projectSlug);
      } catch (markError) {
        console.warn(`灵感转换状态写入失败：${markError instanceof Error ? markError.message : String(markError)}`);
      }
    }
    finishJob(job);
    updateJob(job, {
      status: result.status === "complete" ? "completed" : result.status,
      currentDocument: result.status === "complete" ? "10 份文档" : "生成已结束",
      progress: result.files.length * 10,
      message: result.status === "complete"
        ? ""
        : result.deadlineReached
          ? `任务达到 06:00 截止时间，已保存 ${result.files.length}/10 份通过校验的文档。`
          : `${result.files.length}/10 份文档可用，可在项目中继续生成失败项。`,
    });
    return NextResponse.json({ ok: true, success: true, job: publicJob(job), ...result });
  } catch (error) {
    if (error instanceof GenerationCancelledError) {
      if (job) finishJob(job);
      if (job) updateJob(job, { status: "cancelled", currentDocument: "已撤销", progress: 0, message: "已撤销生成，本地临时文件已清理。" });
      return NextResponse.json({ ok: false, success: false, cancelled: true, error: "已撤销生成，本地临时文件已清理。", stage: "generate", job: job ? publicJob(job) : undefined }, { status: 499 });
    }
    if (error instanceof GenerationStageError) {
      return jsonError(error, error.stage, 400, job);
    }
    if (error instanceof ApiGateError) {
      return jsonError(error, "generate", error.status, job);
    }
    return jsonError(error, "generate", 400, job);
  }
}
