import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import os from "node:os";
import { apiError, readRequestJson } from "../../../../_utils";
import { findPreparation, updatePreparation } from "../../../../../../../src/services/publishPreparationStore.js";
import { exportPreparation } from "../../../../../../../src/services/publishPreparationExport.js";
import { checkPreparation } from "../../../../../../../src/services/publishPreparationCheck.js";

export const runtime = "nodejs";

/** macOS 原生目录选择对话框，返回 { path, canceled, error } */
function pickFolder(prompt: string): Promise<{ path: string; canceled: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (os.platform() !== "darwin") {
      resolve({ path: "", canceled: false, error: "目录选择当前仅支持 macOS。" });
      return;
    }
    const args = [
      "-e", 'tell application "System Events" to activate',
      "-e", `tell application "System Events" to choose folder with prompt "${prompt.replace(/"/g, '\\"')}"`,
      "-e", "POSIX path of result",
    ];
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn("osascript", args, { stdio: "pipe" });
    const timer = setTimeout(() => {
      settled = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve({ path: "", canceled: false, error: "选择超时" });
    }, 120_000);
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ path: "", canceled: false, error: err.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 && /cancel|cancelled/i.test(stderr)) {
        resolve({ path: "", canceled: true });
        return;
      }
      if (code !== 0) {
        resolve({ path: "", canceled: false, error: stderr.trim() || `osascript 退出码 ${code}` });
        return;
      }
      resolve({ path: stdout.trim(), canceled: false });
    });
  });
}

async function isWritableDir(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    if (!s.isDirectory()) return false;
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const preparation = await findPreparation(id);
    if (!preparation) return apiError(new Error("发布准备任务不存在。"), "publisher", "发布准备任务不存在。", 404);
    const check = await checkPreparation(preparation);
    if (check.level === "blocked") {
      const errors = check.targets.flatMap((target) => target.errors);
      return apiError(new Error(errors.join("；") || "发布前检查未通过。"), "publisher", "发布前检查未通过，暂不能导出发布包。", 400);
    }

    const body = await readRequestJson(request).catch((): Record<string, unknown> => ({}));
    let outputDir = typeof body.outputDir === "string" ? body.outputDir.trim() : "";
    const copyVideo = body.copyVideo === true;

    // 未指定 outputDir 时弹出 macOS 目录选择
    if (!outputDir) {
      const picked = await pickFolder("选择发布包导出目录");
      if (picked.canceled) return NextResponse.json({ ok: true, success: true, data: { canceled: true } });
      if (picked.error) return apiError(new Error(picked.error), "publisher", "目录选择失败。", 400);
      outputDir = picked.path;
    }
    if (!outputDir) return apiError(new Error("未选择导出目录。"), "publisher", "未选择导出目录。", 400);
    if (outputDir === "/" || outputDir === "/System" || outputDir === "/Library") {
      return apiError(new Error("安全限制：禁止选择系统根目录。"), "publisher", "安全限制：禁止选择系统根目录。", 400);
    }
    const writable = await isWritableDir(outputDir);
    if (!writable) return apiError(new Error("所选目录不存在或不可写。"), "publisher", "所选目录不存在或不可写。", 400);

    const result = await exportPreparation({ preparation, outputDir, copyVideo });
    const updated = await updatePreparation(id, { exportDir: result.exportDir, status: "exported" });
    return NextResponse.json({
      ok: true,
      success: true,
      data: { preparation: updated, export: result },
    });
  } catch (error) {
    return apiError(error, "publisher", "发布包导出失败。", 500);
  }
}
