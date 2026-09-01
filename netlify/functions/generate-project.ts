import type { Config } from "@netlify/functions";
import { formatDuration } from "../../src/utils/generationTiming.js";
import { generateProject, GenerationCancelledError, GenerationStageError, type GenerationStatusUpdate } from "../../src/services/contentWorkflow.js";
import { markIdeaConverted } from "../../src/services/ideaManager.js";
import { persistProjectDirectory, getPersistedGenerationJob, putPersistedGenerationJob, type PersistedGenerationJob } from "../../src/services/netlifyGenerationStore.js";
import { modelConfigFromInput, withModelConfig } from "../../src/services/modelClient.js";
import { WEB_MODEL_MAX_TOKENS, WEB_MODEL_NAME } from "../../src/services/webModelAccess.js";
import { resolveContentProfile } from "../../src/utils/contentProfile.js";
import type { GenerateInput } from "../../src/prompts/generatePrompt.js";
import path from "node:path";
import { getOutputDir } from "../../src/services/workspaceConfig.js";

export const config: Config = { background: true, path: "/.netlify/functions/generate-project" };

function initialJobError(job: PersistedGenerationJob, error: unknown): PersistedGenerationJob {
  const message = error instanceof Error ? error.message : String(error || "生成失败。");
  const endedAt = new Date().toISOString();
  return {
    ...job,
    status: job.cancelled ? "cancelled" : "failed",
    currentDocument: job.cancelled ? "已撤销" : "生成失败",
    progress: job.cancelled ? 0 : job.progress,
    message: job.cancelled ? "已撤销生成。" : message,
    endedAt,
    durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(job.startedAt)),
    durationLabel: formatDuration(Math.max(0, Date.parse(endedAt) - Date.parse(job.startedAt))),
  };
}

function inputFrom(job: PersistedGenerationJob): GenerateInput {
  const body = job.payload;
  const profile = resolveContentProfile(body);
  const preferred = (value: unknown, automatic: string) => typeof value === "string" && value.trim() && !/^(?:自动|自动判断|自动匹配)$/u.test(value.trim()) ? value.trim() : automatic;
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) throw new Error("选题主题不能为空。");
  return {
    projectName: typeof body.projectName === "string" && body.projectName.trim() ? body.projectName.trim() : topic,
    topic,
    platform: preferred(body.platform, "请结合选题与账号记忆自动选择最合适的发布平台"),
    contentSubject: profile.contentSubject || "请结合选题与账号记忆自动推断内容主体",
    contentDomain: profile.contentDomain || "请结合选题与账号记忆自动推断内容领域",
    style: preferred(body.style, "请结合选题与账号记忆自动匹配自然、具体的表达方式"),
    targetAudience: preferred(body.targetUser, "请结合选题与账号记忆自动推断最相关的目标用户"),
    extraRequirements: typeof body.extra === "string" ? body.extra.trim() : "",
    referenceMaterials: typeof body.referenceMaterials === "string" ? body.referenceMaterials.trim().slice(0, 40_000) : "",
  };
}

export default async function generateProjectInBackground(request: Request): Promise<void> {
  const token = request.headers.get("x-piance-dispatch-token") || "";
  if (!process.env.PIANCE_BACKGROUND_DISPATCH_TOKEN || token !== process.env.PIANCE_BACKGROUND_DISPATCH_TOKEN) return;
  const { jobId } = await request.json().catch(() => ({})) as { jobId?: unknown };
  if (typeof jobId !== "string") return;
  let job = await getPersistedGenerationJob(jobId);
  if (!job || job.cancelled || job.status === "completed") return;
  const apiKey = request.headers.get("x-piance-model-key") || "";
  if (!apiKey) {
    await putPersistedGenerationJob(initialJobError(job, new Error("生成密钥未随内部任务派发，请重新发起生成。")));
    return;
  }

  let writes = Promise.resolve();
  const save = (change: (current: PersistedGenerationJob) => PersistedGenerationJob) => {
    writes = writes.then(async () => {
      const latest = await getPersistedGenerationJob(jobId);
      if (!latest) return;
      job = change(latest);
      await putPersistedGenerationJob(job);
    });
    return writes;
  };
  const controller = new AbortController();
  const cancellationWatch = setInterval(() => {
    void getPersistedGenerationJob(jobId).then((latest) => {
      if (latest?.cancelled) controller.abort();
    }).catch(() => undefined);
  }, 1_000);
  const waitIfPaused = async () => {
    while (true) {
      const latest = await getPersistedGenerationJob(jobId);
      if (!latest?.pauseRequested) return;
      if (latest.cancelled) throw new GenerationCancelledError();
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
  };
  const onStatus = (update: GenerationStatusUpdate) => {
    void save((current) => {
      if (current.cancelled) return { ...current, status: "cancelled", currentDocument: "已撤销", progress: 0, message: "已撤销生成。" };
      const paused = current.pauseRequested && !["completed", "partial", "failed", "cancelled"].includes(update.status);
      return { ...current, ...update, status: paused ? "paused" : update.status, resumeStatus: paused ? update.status : current.resumeStatus };
    });
  };
  const configValue = modelConfigFromInput({ provider: "deepseek", baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1", apiKey, model: WEB_MODEL_NAME, temperature: 0.7, maxTokens: WEB_MODEL_MAX_TOKENS, thinkingMode: "low" });
  try {
    const result = await withModelConfig(configValue, () => generateProject(inputFrom(job!), {
      jobId,
      generationStartedAt: job!.startedAt,
      signal: controller.signal,
      isCancelled: () => job?.cancelled || false,
      waitIfPaused,
      onStatus,
      onTiming: (label, durationMs) => { void save((current) => ({ ...current, timings: [...current.timings, { label, durationMs }] })); },
      onModelCall: (record) => { void save((current) => ({ ...current, modelCalls: [...current.modelCalls, record] })); },
    }));
    await writes;
    if (job?.cancelled) throw new GenerationCancelledError();
    const projectDirectory = path.join(await getOutputDir(), result.projectSlug);
    await persistProjectDirectory(projectDirectory);
    if (job?.sourceIdeaId) await markIdeaConverted(job.sourceIdeaId, result.projectSlug).catch(() => undefined);
    const endedAt = new Date().toISOString();
    await save((current) => ({
      ...current,
      status: result.status === "complete" ? "completed" : result.status,
      currentDocument: result.status === "complete" ? "03_发布与复盘.md" : "生成已结束",
      progress: Math.round((result.files.length / 3) * 100),
      message: result.status === "complete" ? "三份核心文档已生成，并通过自动质量门。" : `${result.files.length}/3 份核心文档可用。`,
      endedAt,
      durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(current.startedAt)),
      durationLabel: formatDuration(Math.max(0, Date.parse(endedAt) - Date.parse(current.startedAt))),
      result: result as unknown as Record<string, unknown>,
    }));
  } catch (error) {
    await writes;
    const latest = await getPersistedGenerationJob(jobId);
    if (latest) await putPersistedGenerationJob(initialJobError(latest, error instanceof GenerationStageError ? error : error));
  } finally {
    clearInterval(cancellationWatch);
  }
}
