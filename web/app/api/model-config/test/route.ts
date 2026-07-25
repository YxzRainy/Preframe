import { NextResponse } from "next/server";
import { testModelConnection } from "../../../../../src/services/modelClient";
import { apiError, readRequestJson } from "../../_utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readRequestJson(request);
    const result = await testModelConnection(body && Object.keys(body).length ? body : undefined);
    return NextResponse.json({ ok: true, success: true, message: result.message, config: result.config });
  } catch (error) {
    return apiError(error, "model", "模型连接失败，请检查 API Key、Base URL 或模型名称。", 400);
  }
}
