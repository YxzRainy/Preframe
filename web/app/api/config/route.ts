import { NextResponse } from "next/server";
import { formatModelLabel } from "../../../../src/utils/modelLabel";
import { publicWebModelConfig } from "../../../lib/model-access";

export const runtime = "nodejs";

/** 只返回可公开的运行配置，绝不返回 API Key。 */
export async function GET() {
  const config = publicWebModelConfig();
  const modelLabel = `${config.providerLabel} · ${formatModelLabel(config.model)}`;
  return NextResponse.json({ ok: true, success: true, model: config.model, modelLabel, config });
}
