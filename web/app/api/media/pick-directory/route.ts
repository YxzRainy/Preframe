import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import os from "node:os";
import { apiError } from "../../_utils";

export const runtime = "nodejs";

/** 使用系统原生文件夹选择器选择一个素材监听目录，仅返回路径。 */
export async function POST() {
  try {
    if (os.platform() !== "darwin") {
      return NextResponse.json(
        { ok: false, error: "原生文件夹选择当前仅支持 macOS，请手动输入路径。" },
        { status: 400 },
      );
    }

    const result = await new Promise<string | null>((resolve) => {
      const child = spawn("osascript", [
        "-e",
        'tell application "System Events" to activate',
        "-e",
        'tell application "System Events" to choose folder with prompt "选择素材监听目录"',
        "-e",
        "POSIX path of result",
      ], { stdio: ["ignore", "pipe", "pipe"] });

      let stdout = "";
      child.stdout?.on("data", (d) => { stdout += d.toString(); });

      const timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
        resolve(null);
      }, 120_000);

      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          resolve(null);
          return;
        }
        resolve(stdout.trim() || null);
      });

      child.on("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
    });

    if (!result) {
      return NextResponse.json({ ok: true, success: true, data: { canceled: true } });
    }

    if (result === "/" || result === "/System" || result === "/Library") {
      return NextResponse.json(
        { ok: false, error: "安全限制：禁止选择系统根目录。" },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true, success: true, data: { directory: result } });
  } catch (error) {
    return apiError(error, "media", "文件夹选择失败。", 500);
  }
}
