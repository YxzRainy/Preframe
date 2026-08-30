import { NextResponse } from "next/server";
import { migrateProjectToCurrentWorkflow } from "../../../../../../src/services/projectMigration";
import { apiError, assertSameOrigin, readRequestJson } from "../../../_utils";
import { runWithWebModelAccess } from "../../../../../lib/model-access";

export const runtime = "nodejs";

function wantsProgressStream(request: Request): boolean {
  return request.headers.get("accept")?.includes("text/event-stream") || false;
}

function streamError(error: unknown) {
  const details = error && typeof error === "object" ? error as { code?: unknown } : {};
  return {
    error: error instanceof Error ? error.message : "项目迁移失败。",
    errorCode: typeof details.code === "string" ? details.code : undefined,
  };
}

function migrationProgressStream(projectSlug: string, body: Record<string, unknown>, signal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      void (async () => {
        send("progress", { stage: "preparing", progress: 3, message: "正在检查历史项目与迁移条件。" });
        try {
          const result = await runWithWebModelAccess(body, () => migrateProjectToCurrentWorkflow(projectSlug, {
            signal,
            onProgress: (event) => send("progress", event),
          }));
          if (result.status === "failed") {
            send("error", {
              error: result.documentsStatus["01"]?.validationErrors?.[0] || "项目迁移失败。",
              errorCode: "MIGRATION_FAILED",
              result,
            });
          } else {
            send("complete", result);
          }
        } catch (error) {
          send("error", streamError(error));
        } finally {
          controller.close();
        }
      })();
    },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    assertSameOrigin(request);
    const { slug } = await params;
    const body = await readRequestJson(request);
    if (wantsProgressStream(request)) {
      return new Response(migrationProgressStream(slug, body, request.signal), {
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "Content-Type": "text/event-stream; charset=utf-8",
          Connection: "keep-alive",
        },
      });
    }
    const result = await runWithWebModelAccess(body, () => migrateProjectToCurrentWorkflow(slug, { signal: request.signal }));
    if (result.status === "failed") {
      const error = result.documentsStatus["01"]?.validationErrors?.[0] || "项目迁移失败。";
      return NextResponse.json({ ok: false, success: false, error, errorCode: "MIGRATION_FAILED", ...result }, { status: 422 });
    }
    return NextResponse.json({ ok: true, success: true, ...result });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "project", "项目迁移失败。", status);
  }
}
