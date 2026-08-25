import { NextResponse } from "next/server";
import { importProjectArchive } from "../../../../../src/services/projectArchive";
import { apiError } from "../../_utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("请选择项目归档文件。");
    if (file.size > 700 * 1024 * 1024) throw new Error("项目归档不能超过 700 MB。");
    const archive = JSON.parse(await file.text()) as unknown;
    const imported = await importProjectArchive(archive);
    return NextResponse.json({ ok: true, success: true, imported });
  } catch (error) {
    return apiError(error, "project", "项目导入失败。", 400);
  }
}
