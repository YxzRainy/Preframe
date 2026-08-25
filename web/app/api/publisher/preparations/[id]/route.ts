import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../_utils";
import {
  deletePreparation,
  findPreparation,
  updatePreparation,
  type UpdatePreparationInput,
} from "../../../../../../src/services/publishPreparationStore.js";
import {
  type PublishDraftTarget,
  type PublishPreparationMaster,
  type PublishPreparationStatus,
  type PublisherPlatform,
} from "../../../../../../src/types/publisher.js";

export const runtime = "nodejs";

const STATUSES: readonly PublishPreparationStatus[] = [
  "draft", "checking", "ready", "exported", "manually_published", "archived",
];
const PREP_PLATFORMS: readonly string[] = [
  "douyin", "xiaohongshu", "bilibili", "tencent", "kuaishou", "youtube",
];

function isStatus(value: unknown): value is PublishPreparationStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}
function isPlatform(value: unknown): value is PublisherPlatform {
  return typeof value === "string" && PREP_PLATFORMS.includes(value);
}

function normalizeMaster(value: unknown): PublishPreparationMaster {
  const rec = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    title: typeof rec.title === "string" ? rec.title : "",
    description: typeof rec.description === "string" ? rec.description : "",
    tags: Array.isArray(rec.tags) ? rec.tags.filter((t): t is string => typeof t === "string") : [],
    thumbnailPath: typeof rec.thumbnailPath === "string" ? rec.thumbnailPath : undefined,
  };
}

function normalizeTarget(value: unknown): PublishDraftTarget | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (!isPlatform(rec.platform)) return null;
  return {
    id: typeof rec.id === "string" ? rec.id : "",
    platform: rec.platform,
    title: typeof rec.title === "string" ? rec.title : "",
    description: typeof rec.description === "string" ? rec.description : "",
    tags: Array.isArray(rec.tags) ? rec.tags.filter((t): t is string => typeof t === "string") : [],
    thumbnailPath: typeof rec.thumbnailPath === "string" ? rec.thumbnailPath : undefined,
    enabled: typeof rec.enabled === "boolean" ? rec.enabled : true,
    validationErrors: Array.isArray(rec.validationErrors) ? rec.validationErrors.filter((t): t is string => typeof t === "string") : [],
    manuallyPublished: typeof rec.manuallyPublished === "boolean" ? rec.manuallyPublished : undefined,
    manuallyPublishedAt: typeof rec.manuallyPublishedAt === "string" ? rec.manuallyPublishedAt : undefined,
    publishResult: rec.publishResult === "published" || rec.publishResult === "failed" ? rec.publishResult : undefined,
    publishUrl: typeof rec.publishUrl === "string" ? rec.publishUrl : undefined,
    publishNote: typeof rec.publishNote === "string" ? rec.publishNote : undefined,
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const preparation = await findPreparation(id);
    if (!preparation) return apiError(new Error("发布准备任务不存在。"), "publisher", "发布准备任务不存在。", 404);
    return NextResponse.json({ ok: true, success: true, data: { preparation } });
  } catch (error) {
    return apiError(error, "publisher", "发布准备读取失败。", 500);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await readRequestJson(request);
    const input: UpdatePreparationInput = {};
    if (typeof body.videoPath === "string") input.videoPath = body.videoPath.trim();
    if (body.masterContent && typeof body.masterContent === "object") input.masterContent = normalizeMaster(body.masterContent);
    if (typeof body.status === "string" && isStatus(body.status)) input.status = body.status;
    if (Array.isArray(body.targets)) {
      const targets = body.targets.map(normalizeTarget).filter(Boolean) as PublishDraftTarget[];
      if (targets.length === 0) return apiError(new Error("至少保留一个目标平台。"), "publisher", "至少保留一个目标平台。", 400);
      input.targets = targets;
    }
    if (typeof body.exportDir === "string") input.exportDir = body.exportDir;
    const preparation = await updatePreparation(id, input);
    return NextResponse.json({ ok: true, success: true, data: { preparation } });
  } catch (error) {
    return apiError(error, "publisher", "发布准备更新失败。", 400);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deletePreparation(id);
    return NextResponse.json({ ok: true, success: true, data: { deleted: true } });
  } catch (error) {
    return apiError(error, "publisher", "发布准备删除失败。", 400);
  }
}
