import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../../_utils";
import { openCreatorBackend } from "../../../../../../../src/services/publishBackendOpener.js";
import { PREPARATION_PLATFORMS, type PublisherPlatform } from "../../../../../../../src/types/publisher.js";

export const runtime = "nodejs";

function isPlatform(value: unknown): value is PublisherPlatform {
  return typeof value === "string" && (PREPARATION_PLATFORMS as readonly string[]).includes(value);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await readRequestJson(request).catch((): Record<string, unknown> => ({}));
    if (!isPlatform(body.platform)) {
      return apiError(new Error("平台不合法。"), "publisher", "平台不合法。", 400);
    }
    const result = await openCreatorBackend(body.platform);
    return NextResponse.json({ ok: true, success: true, data: { id, result } });
  } catch (error) {
    return apiError(error, "publisher", "打开官方后台失败。", 500);
  }
}
