import { NextResponse } from "next/server";
import { createIdea, listIdeas } from "../../../../src/services/ideaManager";
import { readRequestJson, apiError } from "../_utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, success: true, ideas: await listIdeas() });
  } catch (error) {
    return apiError(error, "idea", "灵感读取失败。", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readRequestJson(request);
    const title = typeof body.title === "string" ? body.title : "";
    if (!title.trim()) throw new Error("灵感标题不能为空。");
    const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [];
    const idea = await createIdea({
      title,
      note: typeof body.note === "string" ? body.note : undefined,
      source: typeof body.source === "string" ? body.source : undefined,
      tags,
    });
    return NextResponse.json({ ok: true, success: true, idea });
  } catch (error) {
    return apiError(error, "idea", "灵感创建失败。", 400);
  }
}
