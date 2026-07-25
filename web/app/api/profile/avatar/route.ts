import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getAvatarFile } from "../../../../../src/services/profileConfig";

export const runtime = "nodejs";

export async function GET() {
  try {
    const avatar = await getAvatarFile();
    if (!avatar) return NextResponse.json({ success: false, error: "未设置头像。" }, { status: 404 });
    const bytes = await readFile(avatar.path);
    return new Response(bytes, {
      headers: {
        "Content-Type": avatar.mimeType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "头像读取失败。" }, { status: 404 });
  }
}
