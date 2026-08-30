import { NextResponse } from "next/server";
import { clearDeepSeekApiKey, localEnvPath, saveDeepSeekApiKey } from "../../../../src/services/envFile";
import { maskApiKey } from "../../../../src/services/modelClient";
import { publicWebModelConfig, WEB_MODEL_NAME } from "../../../lib/model-access";
import { apiError, assertSameOrigin, readRequestJson } from "../_utils";

export const runtime = "nodejs";

function response() {
  const config = publicWebModelConfig();
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim() || "";
  return NextResponse.json({
    ok: true,
    success: true,
    config: { ...config, maskedApiKey: maskApiKey(apiKey) },
    model: WEB_MODEL_NAME,
    envPath: localEnvPath(),
  });
}

export async function GET() {
  return response();
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readRequestJson(request);
    await saveDeepSeekApiKey(body.apiKey);
    return response();
  } catch (error) {
    return apiError(error, "model", "DeepSeek API Key 保存失败。", 400);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    await clearDeepSeekApiKey();
    return response();
  } catch (error) {
    return apiError(error, "model", "DeepSeek API Key 清除失败。", 400);
  }
}
