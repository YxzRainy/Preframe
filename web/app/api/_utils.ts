import { NextResponse } from "next/server";
import { recordDiagnostic } from "../../../src/services/diagnosticLog";

export type ApiStage = "account-memory" | "config" | "generate" | "model" | "parse" | "write" | "read" | "refine" | "scan" | "workspace" | "project" | "task" | "idea" | "stage" | "publish" | "publisher" | "weather" | "media" | "feedback";

export function apiError(error: unknown, stage: ApiStage, fallback: string, status = 400) {
  void recordDiagnostic(error, stage).catch(() => undefined);
  return NextResponse.json({
    ok: false,
    success: false,
    error: error instanceof Error ? error.message : fallback,
    stage,
  }, { status });
}

export async function readRequestJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return {};
    return body as Record<string, unknown>;
  } catch (error) {
    throw new Error("请求体不是合法 JSON。", { cause: error });
  }
}
