import { NextResponse } from "next/server";
import { maskApiKey } from "../../../../src/services/modelClient";
import { publicWebModelConfig, webModelApiKey, WEB_MODEL_COOKIE, WEB_MODEL_NAME } from "../../../lib/model-access";
import { validateDeepSeekApiKey } from "../../../../src/services/envFile";
import { apiError, assertSameOrigin, readRequestJson } from "../_utils";

export const runtime = "nodejs";

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  };
}

function response(request: Request, apiKey?: string) {
  const config = publicWebModelConfig(request, apiKey);
  return NextResponse.json({
    ok: true,
    success: true,
    config: { ...config, maskedApiKey: maskApiKey(apiKey || webModelApiKey(request).apiKey) },
    model: WEB_MODEL_NAME,
    storage: "browser-cookie",
  });
}

export async function GET(request: Request) {
  return response(request);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readRequestJson(request);
    const apiKey = validateDeepSeekApiKey(body.apiKey);
    const result = response(request, apiKey);
    result.cookies.set(WEB_MODEL_COOKIE, apiKey, cookieOptions());
    return result;
  } catch (error) {
    return apiError(error, "model", "DeepSeek API Key 保存失败。", 400);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const result = response(request);
    result.cookies.set(WEB_MODEL_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
    return result;
  } catch (error) {
    return apiError(error, "model", "DeepSeek API Key 清除失败。", 400);
  }
}
