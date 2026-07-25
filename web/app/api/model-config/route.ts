import { NextResponse } from "next/server";
import {
  currentPublicModelConfig,
  providerOptions,
  resetModelConfig,
  saveModelConfig,
} from "../../../../src/services/modelClient";
import { apiError, readRequestJson } from "../_utils";

export const runtime = "nodejs";

function jsonError(error: unknown, status = 400) {
  return apiError(error, "config", "模型配置操作失败。", status);
}

export async function GET() {
  try {
    const config = await currentPublicModelConfig();
    return NextResponse.json({ ok: true, success: true, config, providers: providerOptions() });
  } catch (error) {
    return jsonError(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readRequestJson(request);
    const config = body.reset ? await resetModelConfig() : await saveModelConfig(body);
    return NextResponse.json({ ok: true, success: true, config, providers: providerOptions() });
  } catch (error) {
    return jsonError(error, 400);
  }
}
