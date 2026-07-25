import { NextResponse } from "next/server";
import { formatModelLabel } from "../../../../src/utils/modelLabel";
import { currentPublicModelConfig } from "../../../../src/services/modelClient";
import { apiError } from "../_utils";

export const runtime = "nodejs";

/** 只返回可公开的运行配置，绝不返回 API Key。 */
export async function GET() {
  try {
    const config = await currentPublicModelConfig();
    const modelLabel = `${config.providerLabel} · ${formatModelLabel(config.model)}`;
    return NextResponse.json({ ok: true, success: true, model: config.model, modelLabel, config });
  } catch (error) {
    return apiError(error, "config", "配置读取失败。", 500);
  }
}
