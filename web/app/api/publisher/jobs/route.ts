import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../_utils";
import { createJob, listJobs } from "../../../../../src/services/publishJobStore.js";
import type { PublishMasterContent, PublishTarget } from "../../../../../src/types/publisher.js";

export const runtime = "nodejs";

function normalizeMaster(value: unknown): PublishMasterContent {
  const rec = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    title: typeof rec.title === "string" ? rec.title : "",
    description: typeof rec.description === "string" ? rec.description : "",
    tags: Array.isArray(rec.tags) ? rec.tags.filter((t): t is string => typeof t === "string") : [],
  };
}

function normalizeTargetInput(value: unknown): Omit<PublishTarget, "id" | "status" | "updatedAt" | "error"> | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.accountId !== "string" || typeof rec.platform !== "string") return null;
  return {
    accountId: rec.accountId,
    platform: rec.platform as PublishTarget["platform"],
    title: typeof rec.title === "string" ? rec.title : "",
    description: typeof rec.description === "string" ? rec.description : "",
    tags: Array.isArray(rec.tags) ? rec.tags.filter((t): t is string => typeof t === "string") : [],
    thumbnailPath: typeof rec.thumbnailPath === "string" ? rec.thumbnailPath : undefined,
  };
}

export async function GET() {
  try {
    const jobs = await listJobs();
    return NextResponse.json({ ok: true, success: true, data: { jobs } });
  } catch (error) {
    return apiError(error, "publisher", "发布任务列表读取失败。", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readRequestJson(request);
    const videoPath = typeof body.videoPath === "string" ? body.videoPath.trim() : "";
    if (!videoPath) return apiError(new Error("视频文件路径不能为空。"), "publisher", "视频文件路径不能为空。", 400);
    const projectSlug = typeof body.projectSlug === "string" ? body.projectSlug.trim() : undefined;
    const thumbnailPath = typeof body.thumbnailPath === "string" ? body.thumbnailPath.trim() : undefined;
    const masterContent = normalizeMaster(body.masterContent);
    const rawTargets = Array.isArray(body.targets) ? body.targets : [];
    const targets = rawTargets.map(normalizeTargetInput).filter(Boolean) as Array<Omit<PublishTarget, "id" | "status" | "updatedAt" | "error">>;
    if (targets.length === 0) return apiError(new Error("至少选择一个发布账号。"), "publisher", "至少选择一个发布账号。", 400);

    const job = await createJob({ projectSlug, videoPath, thumbnailPath, masterContent, targets });
    return NextResponse.json({ ok: true, success: true, data: { job } }, { status: 201 });
  } catch (error) {
    return apiError(error, "publisher", "发布任务创建失败。", 400);
  }
}
