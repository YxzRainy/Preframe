import { NextResponse } from "next/server";
import { testModelConnection } from "../../../../../src/services/modelClient";
import { runWithWebModelAccess } from "../../../../lib/model-access";
import { apiError, assertSameOrigin, readRequestJson } from "../../_utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readRequestJson(request);
    const normalizedBody = typeof body.apiKey === "string"
      ? { modelConfig: { apiKey: body.apiKey } }
      : body;
    const result = await runWithWebModelAccess(normalizedBody, ({ config }) => testModelConnection({ ...config }, ""));
    return NextResponse.json({ ok: true, success: true, message: result.message, config: result.config });
  } catch (error) {
    return apiError(error, "model", "DeepSeek Flash 连接失败，请检查 API Key。", 400);
  }
}
