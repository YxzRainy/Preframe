import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../_utils";
import { deleteJob, findJob, updateJob } from "../../../../../../src/services/publishJobStore.js";
import type { PublishJobStatus, PublishMasterContent, PublishTarget } from "../../../../../../src/types/publisher.js";

export const runtime = "nodejs";

const JOB_STATUSES: readonly PublishJobStatus[] = ["draft", "validating", "ready", "running", "partial", "completed", "failed", "cancelled"];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const job = await findJob(id);
    if (!job) return apiError(new Error("发布任务不存在。"), "publisher", "发布任务不存在。", 404);
    return NextResponse.json({ ok: true, success: true, data: { job } });
  } catch (error) {
    return apiError(error, "publisher", "发布任务读取失败。", 500);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await readRequestJson(request);
    const input: {
      videoPath?: string;
      thumbnailPath?: string;
      masterContent?: PublishMasterContent;
      status?: PublishJobStatus;
      targets?: PublishTarget[];
    } = {};
    if (typeof body.videoPath === "string") input.videoPath = body.videoPath;
    if (typeof body.thumbnailPath === "string") input.thumbnailPath = body.thumbnailPath;
    if (body.masterContent && typeof body.masterContent === "object") {
      const m = body.masterContent as Record<string, unknown>;
      input.masterContent = {
        title: typeof m.title === "string" ? m.title : "",
        description: typeof m.description === "string" ? m.description : "",
        tags: Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === "string") : [],
      };
    }
    if (typeof body.status === "string" && (JOB_STATUSES as readonly string[]).includes(body.status)) {
      input.status = body.status as PublishJobStatus;
    }
    if (Array.isArray(body.targets)) input.targets = body.targets as PublishTarget[];
    const job = await updateJob(id, input);
    return NextResponse.json({ ok: true, success: true, data: { job } });
  } catch (error) {
    return apiError(error, "publisher", "发布任务更新失败。", 400);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteJob(id);
    return NextResponse.json({ ok: true, success: true, data: { deleted: true } });
  } catch (error) {
    return apiError(error, "publisher", "发布任务删除失败。", 400);
  }
}
