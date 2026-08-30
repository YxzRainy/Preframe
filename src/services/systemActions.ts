/** 系统操作服务 — 剪贴板写入、Finder 定位、打开文件
 * 全部使用 spawn 参数数组，禁止 exec / shell 字符串拼接。
 * 不自动输入密码、不绕过登录、不自动点击发布、不输出 Cookie/Token。 */

import { spawn } from "node:child_process";
import os from "node:os";


export interface SystemActionResult {
  ok: boolean;
  method: string;
  error?: string;
}

function runSpawn(command: string, args: string[], timeoutMs = 5000): Promise<SystemActionResult> {
  return new Promise((resolve) => {
    let settled = false;
    let child;
    try {
      child = spawn(command, args, { stdio: "ignore", detached: false });
    } catch (err) {
      resolve({ ok: false, method: command, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve({ ok: false, method: command, error: "执行超时" });
    }, timeoutMs);
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, method: command, error: err.message });
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, method: command, error: code === 0 ? undefined : `退出码 ${code}` });
    });
  });
}

/** 将文本写入系统剪贴板。macOS: pbcopy；Linux: xclip/xsel；Windows: clip */
export async function copyToClipboard(text: string): Promise<SystemActionResult> {
  const platform = os.platform();
  if (platform === "darwin") {
    // pbcopy 从 stdin 读取
    return new Promise((resolve) => {
      let settled = false;
      const child = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
        resolve({ ok: false, method: "pbcopy", error: "剪贴板写入超时" });
      }, 5000);
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, method: "pbcopy", error: err.message });
      });
      child.on("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: code === 0, method: "pbcopy", error: code === 0 ? undefined : `退出码 ${code}` });
      });
      child.stdin?.end(text, "utf8");
    });
  }
  if (platform === "win32") {
    // clip 从 stdin 读取
    return new Promise((resolve) => {
      let settled = false;
      const child = spawn("clip", [], { stdio: ["pipe", "ignore", "ignore"] });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
        resolve({ ok: false, method: "clip", error: "剪贴板写入超时" });
      }, 5000);
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, method: "clip", error: err.message });
      });
      child.on("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: code === 0, method: "clip", error: code === 0 ? undefined : `退出码 ${code}` });
      });
      child.stdin?.end(text, "utf8");
    });
  }
  // Linux: xclip
  return runSpawn("xclip", ["-selection", "clipboard"]);
}

/** 在 Finder 中定位并选中文件。macOS: open -R */
export async function revealInFinder(filePath: string): Promise<SystemActionResult> {
  const platform = os.platform();
  if (platform === "darwin") {
    return runSpawn("open", ["-R", filePath]);
  }
  if (platform === "win32") {
    return runSpawn("explorer", ["/select,", filePath]);
  }
  // Linux: 打开所在目录
  return runSpawn("xdg-open", [filePath.replace(/[/\\][^/\\]+$/, "")]);
}

/** 在系统文件管理器中打开目录（不定位具体文件）。macOS: open <dir> */
export async function openDirectory(dirPath: string): Promise<SystemActionResult> {
  const platform = os.platform();
  if (platform === "darwin") {
    return runSpawn("open", [dirPath]);
  }
  if (platform === "win32") {
    return runSpawn("explorer", [dirPath]);
  }
  return runSpawn("xdg-open", [dirPath]);
}

/** 使用系统默认播放器打开文件（视频/图片）。macOS: open <file> */
export async function openInDefaultPlayer(filePath: string): Promise<SystemActionResult> {
  const platform = os.platform();
  if (platform === "darwin") {
    return runSpawn("open", [filePath]);
  }
  if (platform === "win32") {
    return runSpawn("cmd", ["/c", "start", "", filePath]);
  }
  return runSpawn("xdg-open", [filePath]);
}
