import { NextResponse } from "next/server";
import {
  accountMemoryHasContent,
  getAccountMemory,
  saveAccountMemory,
} from "../../../../src/services/accountMemory";
import { apiError, readRequestJson } from "../_utils";

export const runtime = "nodejs";

function jsonError(error: unknown, status = 400) {
  return apiError(error, "account-memory", "账号记忆操作失败。", status);
}

export async function GET() {
  try {
    const memory = await getAccountMemory();
    return NextResponse.json({ ok: true, success: true, memory, hasMemory: accountMemoryHasContent(memory) });
  } catch (error) {
    return jsonError(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readRequestJson(request);
    const memory = await saveAccountMemory(body);
    return NextResponse.json({ ok: true, success: true, memory, hasMemory: accountMemoryHasContent(memory) });
  } catch (error) {
    return jsonError(error, 400);
  }
}
