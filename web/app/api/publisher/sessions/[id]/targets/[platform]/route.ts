import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../../../_utils";
import { updateTargetStatus } from "../../../../../../../../src/services/publishSessionStore.js";
import { PUBLISHER_PLATFORMS, type PublisherPlatform } from "../../../../../../../../src/types/publisher.js";
import type { PublishSessionTargetStatus } from "../../../../../../../../src/types/publishSession.js";

export const runtime = "nodejs";

const TARGET_STATUSES: readonly PublishSessionTargetStatus[] = ["pending", "opened", "published", "skipped"];

function isPlatform(value: unknown): value is PublisherPlatform {
  return typeof value === "string" && (PUBLISHER_PLATFORMS as readonly string[]).includes(value);
}
function isTargetStatus(value: unknown): value is PublishSessionTargetStatus {
  return typeof value === "string" && (TARGET_STATUSES as readonly string[]).includes(value);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; platform: string }> }) {
  try {
    const { id, platform } = await params;
    if (!isPlatform(platform)) return apiError(new Error("平台不合法。"), "publisher", "平台不合法。", 400);
    const body = await readRequestJson(request);
    const patch: {
      status?: PublishSessionTargetStatus;
      title?: string;
      description?: string;
      tags?: string[];
      thumbnailPath?: string;
    } = {};
    if (isTargetStatus(body.status)) patch.status = body.status;
    if (typeof body.title === "string") patch.title = body.title;
    if (typeof body.description === "string") patch.description = body.description;
    if (Array.isArray(body.tags)) patch.tags = body.tags.filter((t): t is string => typeof t === "string");
    if (typeof body.thumbnailPath === "string") patch.thumbnailPath = body.thumbnailPath;
    const session = await updateTargetStatus(id, platform, patch);
    return NextResponse.json({ ok: true, success: true, data: { session } });
  } catch (error) {
    return apiError(error, "publisher", "发布目标更新失败。", 400);
  }
}
