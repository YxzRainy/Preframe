import { NextResponse } from "next/server";
import { getWorkspaceStats, resetOutputDir, setOutputDir } from "../../../../src/services/workspaceConfig";
import { apiError, readRequestJson } from "../_utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, success: true, workspace: await getWorkspaceStats() });
  } catch (error) {
    return apiError(error, "workspace", "本地工作区读取失败。", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readRequestJson(request);
    if (body.reset === true) {
      await resetOutputDir();
      return NextResponse.json({ ok: true, success: true, workspace: await getWorkspaceStats() });
    }
    if (typeof body.outputDir !== "string") throw new Error("输出目录不能为空。");
    await setOutputDir(body.outputDir);
    return NextResponse.json({ ok: true, success: true, workspace: await getWorkspaceStats() });
  } catch (error) {
    return apiError(error, "workspace", "输出目录保存失败。", 400);
  }
}
