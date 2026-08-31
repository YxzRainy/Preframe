import { NextResponse } from "next/server";
import { testModelConnection } from "../../../../../src/services/modelClient";
import { runWithWebModelAccess } from "../../../../lib/model-access";
import { apiError, assertSameOrigin } from "../../_utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const result = await runWithWebModelAccess(request, ({ config }) => testModelConnection({ ...config }, ""));
    return NextResponse.json({ ok: true, success: true, message: result.message, config: result.config });
  } catch (error) {
    return apiError(error, "model", "DeepSeek Flash 连接失败，请检查当前浏览器保存的 API Key。", 400);
  }
}
