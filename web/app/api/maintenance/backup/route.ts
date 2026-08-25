import { NextResponse } from "next/server";
import { createConfigBackup, restoreConfigBackup } from "../../../../../src/services/configBackup";
import { apiError } from "../../_utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    const backup = await createConfigBackup(false);
    const filename = `preframe-config-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(`${JSON.stringify(backup, null, 2)}\n`, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return apiError(error, "config", "配置备份失败。", 500);
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("请选择配置备份文件。");
    if (file.size > 100 * 1024 * 1024) throw new Error("配置备份不能超过 100 MB。");
    const restored = await restoreConfigBackup(JSON.parse(await file.text()) as unknown);
    return NextResponse.json({ ok: true, success: true, restored });
  } catch (error) {
    return apiError(error, "config", "配置恢复失败。", 400);
  }
}
