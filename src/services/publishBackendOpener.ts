/** 打开平台官方创作者后台 — 使用系统默认浏览器，只打开页面，不自动填写、不自动点击发布。 */

import { spawn } from "node:child_process";
import os from "node:os";

import { PLATFORM_PUBLISH_PROFILES, type PublisherPlatform } from "../types/publisher.js";

export interface OpenBackendResult {
  opened: boolean;
  url: string;
  method: string;
  error?: string;
}

/** 使用系统默认浏览器打开 URL。macOS: open；Linux: xdg-open；Windows: start。 */
export function openUrlInDefaultBrowser(url: string): Promise<OpenBackendResult> {
  return new Promise((resolve) => {
    const platform = os.platform();
    let command: string;
    let args: string[];
    if (platform === "darwin") {
      command = "open";
      args = [url];
    } else if (platform === "win32") {
      command = "cmd";
      args = ["/c", "start", "", url];
    } else {
      command = "xdg-open";
      args = [url];
    }
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve({ opened: false, url, method: command, error: "打开超时" });
    }, 5000);
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ opened: false, url, method: command, error: err.message });
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ opened: code === 0, url, method: command, error: code === 0 ? undefined : `退出码 ${code}` });
    });
  });
}

export async function openCreatorBackend(platform: PublisherPlatform): Promise<OpenBackendResult> {
  const profile = PLATFORM_PUBLISH_PROFILES[platform];
  if (!profile.creatorBackendUrl) {
    return {
      opened: false,
      url: "",
      method: "skip",
      error: profile.creatorBackendNote || `${profile.label}暂无已知官方创作者后台 URL，请手动前往平台上传页。`,
    };
  }
  return openUrlInDefaultBrowser(profile.creatorBackendUrl);
}
