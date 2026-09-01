import { NextResponse } from "next/server";
import { recordDiagnostic } from "../../../src/services/diagnosticLog";

export type ApiStage = "account-memory" | "config" | "generate" | "model" | "parse" | "write" | "read" | "refine" | "scan" | "workspace" | "project" | "task" | "idea" | "stage" | "weather" | "media" | "feedback" | "learning" | "assets" | "cover";

export class RequestSecurityError extends Error {
  readonly status = 403;
  readonly code = "CROSS_ORIGIN_REQUEST";

  constructor() {
    super("拒绝跨来源请求。");
    this.name = "RequestSecurityError";
  }
}

export function publicRequestOrigin(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https" ? forwardedProtocol : requestUrl.protocol.slice(0, -1);
  return host ? `${protocol}://${host}` : requestUrl.origin;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const requestOrigin = new URL(request.url).origin;
  if (origin !== requestOrigin && origin !== publicRequestOrigin(request)) throw new RequestSecurityError();
}

export function apiError(error: unknown, stage: ApiStage, fallback: string, status = 400) {
  void recordDiagnostic(error, stage).catch(() => undefined);
  const details = error && typeof error === "object" ? error as { status?: unknown; code?: unknown } : {};
  const errorStatus = typeof details.status === "number" && details.status >= 400 && details.status <= 599 ? details.status : status;
  const errorCode = typeof details.code === "string" ? details.code : undefined;
  return NextResponse.json({
    ok: false,
    success: false,
    error: error instanceof Error ? error.message : fallback,
    errorCode,
    stage,
  }, { status: errorStatus });
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
