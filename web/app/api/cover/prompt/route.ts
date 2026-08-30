import { NextResponse } from "next/server";
import { buildCoverPromptRegenerationPrompt, normalizeGeneratedCoverPrompt } from "../../../../../src/prompts/coverPrompt";
import { callModel } from "../../../../../src/services/modelClient";
import { runWithWebModelAccess } from "../../../../lib/model-access";
import { apiError, assertSameOrigin, readRequestJson } from "../../_utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readRequestJson(request);
    if (typeof body.content !== "string" || typeof body.ratio !== "string") {
      throw new Error("发布内容和封面比例均为必填项。");
    }
    const content = body.content;
    const ratio = body.ratio;
    const prompt = await runWithWebModelAccess(body, async () => (
      normalizeGeneratedCoverPrompt(await callModel(buildCoverPromptRegenerationPrompt(content, ratio)))
    ));
    return NextResponse.json({ ok: true, success: true, prompt });
  } catch (error) {
    return apiError(error, "cover", "封面提示词生成失败。", 400);
  }
}
