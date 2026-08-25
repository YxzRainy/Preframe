import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { apiError } from "../../_utils";

export const runtime = "nodejs";

const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);

function runOsascript(scriptLines: string[]): Promise<{ stdout: string; canceled: boolean; error?: string }> {
  return new Promise((resolve) => {
    const args = scriptLines.flatMap((line) => ["-e", line]);
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn("osascript", args, { stdio: "pipe" });
    const timer = setTimeout(() => {
      settled = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve({ stdout: "", canceled: false, error: "选择超时" });
    }, 120_000);
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: "", canceled: false, error: err.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 && /cancel|cancelled/i.test(stderr)) {
        resolve({ stdout: "", canceled: true });
        return;
      }
      if (code !== 0) {
        resolve({ stdout: "", canceled: false, error: stderr.trim() || `osascript 退出码 ${code}` });
        return;
      }
      resolve({ stdout: stdout.trim(), canceled: false });
    });
  });
}

/** 原生文件选择：选择封面图片（兜底，当自动匹配未找到封面时使用） */
export async function POST() {
  try {
    if (os.platform() !== "darwin") {
      return apiError(new Error("封面选择当前仅支持 macOS。"), "publisher", "封面选择当前仅支持 macOS。", 400);
    }
    const result = await runOsascript([
      'tell application "System Events" to activate',
      'set theFile to choose file with prompt "选择封面图片"',
      'POSIX path of theFile',
    ]);
    if (result.canceled) return NextResponse.json({ ok: true, success: true, data: { canceled: true } });
    if (result.error) return apiError(new Error(result.error), "publisher", "封面选择失败。", 500);

    const coverPath = result.stdout.trim();
    if (!coverPath) return NextResponse.json({ ok: true, success: true, data: { canceled: true } });

    const ext = path.extname(coverPath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return apiError(
        new Error(`不支持的图片格式：${ext || "无扩展名"}（仅支持 jpg/jpeg/png/webp/bmp）`),
        "publisher",
        "不支持的图片格式。",
        400,
      );
    }

    try {
      await stat(coverPath);
    } catch {
      return apiError(new Error("所选文件无法读取。"), "publisher", "所选文件无法读取。", 400);
    }

    return NextResponse.json({
      ok: true,
      success: true,
      data: { canceled: false, coverPath, name: path.basename(coverPath) },
    });
  } catch (error) {
    return apiError(error, "publisher", "封面选择失败。", 500);
  }
}
