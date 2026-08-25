import { NextResponse } from "next/server";
import { clearDiagnostics, listDiagnostics } from "../../../../../src/services/diagnosticLog";
import { apiError } from "../../_utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, success: true, entries: await listDiagnostics() });
  } catch (error) {
    return apiError(error, "read", "诊断日志读取失败。", 500);
  }
}

export async function DELETE() {
  try {
    await clearDiagnostics();
    return NextResponse.json({ ok: true, success: true });
  } catch (error) {
    return apiError(error, "write", "诊断日志清理失败。", 500);
  }
}
