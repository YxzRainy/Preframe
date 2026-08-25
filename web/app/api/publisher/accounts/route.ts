import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../_utils";
import { createAccountByPlatform, listAccounts } from "../../../../../src/services/publisherAccountStore.js";
import { PUBLISHER_PLATFORMS, type PublisherPlatform } from "../../../../../src/types/publisher.js";

export const runtime = "nodejs";

function isPlatform(value: unknown): value is PublisherPlatform {
  return typeof value === "string" && (PUBLISHER_PLATFORMS as readonly string[]).includes(value);
}

export async function GET() {
  try {
    const accounts = await listAccounts();
    return NextResponse.json({ ok: true, success: true, data: { accounts } });
  } catch (error) {
    return apiError(error, "publisher", "账号列表读取失败。", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readRequestJson(request);
    if (!isPlatform(body.platform)) return apiError(new Error("平台不合法。"), "publisher", "平台不合法。", 400);
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    // 内部 accountName 自动生成，用户无需手填
    const account = await createAccountByPlatform(body.platform, displayName);
    return NextResponse.json({ ok: true, success: true, data: { account } }, { status: 201 });
  } catch (error) {
    return apiError(error, "publisher", "账号创建失败。", 400);
  }
}
