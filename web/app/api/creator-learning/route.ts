import { NextResponse } from "next/server";
import { decideLearningItem, getCreatorLearning, scanCreatorLearning } from "../../../../src/services/creatorLearningStore";
import { apiError, assertSameOrigin, readRequestJson } from "../_utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, success: true, learning: await getCreatorLearning() });
  } catch (error) {
    return apiError(error, "learning", "创作者学习读取失败。", 500);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readRequestJson(request);
    if (body.action === "scan") {
      return NextResponse.json({ ok: true, success: true, learning: await scanCreatorLearning() });
    }
    const kind = body.kind;
    const id = body.id;
    const decision = body.decision;
    if (kind !== "fact" && kind !== "pattern" && kind !== "strategy") throw new Error("学习条目类型无效。");
    if (typeof id !== "string" || !id) throw new Error("缺少学习条目标识。");
    if (decision !== "confirm" && decision !== "reject" && decision !== "retire" && decision !== "reactivate") throw new Error("学习决策无效。");
    const learning = await decideLearningItem(kind, id, decision);
    return NextResponse.json({ ok: true, success: true, learning });
  } catch (error) {
    return apiError(error, "learning", "创作者学习更新失败。", 400);
  }
}
