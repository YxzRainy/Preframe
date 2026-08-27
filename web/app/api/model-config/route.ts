import { NextResponse } from "next/server";
import { publicWebModelConfig, WEB_MODEL_NAME } from "../../../lib/model-access";

export const runtime = "nodejs";

export async function GET() {
  const config = publicWebModelConfig();
  return NextResponse.json({
    ok: true,
    success: true,
    config,
    model: WEB_MODEL_NAME,
    browserConfigSupported: true,
  });
}
