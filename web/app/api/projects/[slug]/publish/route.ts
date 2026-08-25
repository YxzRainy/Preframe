import { NextResponse } from "next/server";
import { readPublishData, updatePublishData, type PublishData } from "../../../../../../src/services/projectStage";
import { readRequestJson, apiError } from "../../../_utils";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    return NextResponse.json({ ok: true, success: true, publishData: await readPublishData(slug) });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "publish", "发布数据读取失败。", status);
  }
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  }
  return undefined;
}

export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = await readRequestJson(request);
    const data: PublishData = {};
    if (typeof body.platform === "string") data.platform = body.platform;
    if (typeof body.publishUrl === "string") data.publishUrl = body.publishUrl;
    if (typeof body.publishedAt === "string") data.publishedAt = body.publishedAt;
    if (body.views !== undefined) data.views = normalizeNumber(body.views);
    if (body.likes !== undefined) data.likes = normalizeNumber(body.likes);
    if (body.favorites !== undefined) data.favorites = normalizeNumber(body.favorites);
    if (body.comments !== undefined) data.comments = normalizeNumber(body.comments);
    if (body.completionRate !== undefined) {
      const rate = normalizeNumber(body.completionRate);
      data.completionRate = rate !== undefined ? Math.min(100, Math.max(0, rate)) : undefined;
    }
    if (typeof body.reviewNote === "string") data.reviewNote = body.reviewNote;
    if (typeof body.nextTopic === "string") data.nextTopic = body.nextTopic;
    const merged = await updatePublishData(slug, data);
    return NextResponse.json({ ok: true, success: true, publishData: merged });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "publish", "发布数据保存失败。", status);
  }
}
