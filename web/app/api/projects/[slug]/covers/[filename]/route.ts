import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { resolveProjectDirectory } from "../../../../../../../src/services/projectManager";

export const runtime = "nodejs";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; filename: string }> }) {
  try {
    const { slug, filename: encodedFilename } = await params;
    const filename = decodeURIComponent(encodedFilename);
    const extension = path.extname(filename).toLowerCase();
    if (filename !== path.basename(filename) || !MIME_TYPES[extension]) throw new Error("封面文件名无效。");
    const bytes = await readFile(path.join(resolveProjectDirectory(slug), "covers", filename));
    return new Response(bytes, {
      headers: {
        "Content-Type": MIME_TYPES[extension],
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "封面读取失败。" }, { status: 404 });
  }
}
