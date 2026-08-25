import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../../../_utils";
import { updateTarget } from "../../../../../../../../src/services/publishPreparationStore.js";
import type { PublishDraftTarget } from "../../../../../../../../src/types/publisher.js";

export const runtime = "nodejs";

type TargetPatch = Partial<Pick<PublishDraftTarget, "title" | "description" | "tags" | "thumbnailPath" | "enabled" | "validationErrors" | "publishResult" | "publishUrl" | "publishNote">>;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; targetId: string }> }) {
  try {
    const { id, targetId } = await params;
    const body = await readRequestJson(request);
    const patch: TargetPatch = {};
    if (typeof body.title === "string") patch.title = body.title;
    if (typeof body.description === "string") patch.description = body.description;
    if (Array.isArray(body.tags)) patch.tags = body.tags.filter((t): t is string => typeof t === "string");
    if (typeof body.thumbnailPath === "string") patch.thumbnailPath = body.thumbnailPath;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (Array.isArray(body.validationErrors)) patch.validationErrors = body.validationErrors.filter((t): t is string => typeof t === "string");
    if (body.publishResult === "published" || body.publishResult === "failed") patch.publishResult = body.publishResult;
    if (typeof body.publishUrl === "string") patch.publishUrl = body.publishUrl;
    if (typeof body.publishNote === "string") patch.publishNote = body.publishNote;
    const preparation = await updateTarget(id, targetId, patch);
    return NextResponse.json({ ok: true, success: true, data: { preparation } });
  } catch (error) {
    return apiError(error, "publisher", "发布目标更新失败。", 400);
  }
}
