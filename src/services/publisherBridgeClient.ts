/** 桥接层客户端 — 通过 child_process.spawn 调用 publisher_bridge.py
 *
 * 安全约束：
 * - 参数以数组传递，绝不字符串拼接 Shell 命令
 * - 禁止 exec
 * - 设置执行超时
 * - 只解析 stdout 中最后一个合法 JSON 结果
 * - 日志屏蔽 Cookie / Token / authorization
 * - 路径不存在时返回明确错误
 * - 进程退出后正确清理
 */

import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const LAB_DIR = "/Users/YxzRainy/Documents/Vibecoding/PreframePublisherLab";
export const PUBLISHER_PYTHON =
  process.env.PUBLISHER_PYTHON || path.join(LAB_DIR, ".venv", "bin", "python");
export const PUBLISHER_BRIDGE =
  process.env.PUBLISHER_BRIDGE ||
  path.join(LAB_DIR, "publisher-bridge", "publisher_bridge.py");
const BRIDGE_ACCOUNTS_FILE = path.join(LAB_DIR, "publisher-bridge", "accounts.json");
/** social-auto-upload 的 cookie 落盘目录 */
const SAU_COOKIES_DIR = path.join(LAB_DIR, "social-auto-upload", "cookies");

export interface BridgeResult {
  success: boolean;
  data: Record<string, unknown> | null;
  error: string | null;
  stage: string | null;
  /** 脱敏后的 stderr 摘要，仅用于排障 */
  stderrPreview: string;
  timedOut: boolean;
}

const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:sk|sess|xox[baprs])-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_TOKEN]"],
  [/\b(?:api[_-]?key|token|secret|access[_-]?token|refresh[_-]?token|authorization|cookie)\b\s*[:=]\s*\S+/gi, "$1: [REDACTED]"],
];

function sanitize(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    out = out.replace(pattern, replacement as string);
  }
  return out;
}

/** 从 stdout 中提取最后一个合法 JSON 对象 */
function extractLastJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // 快速路径：整段就是 JSON
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // 继续 fallback
  }
  // 从后向前找最后一个 `{` 起始的平衡 JSON
  let end = trimmed.lastIndexOf("}");
  if (end === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;
  for (let i = end; i >= 0; i -= 1) {
    const ch = trimmed[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "}") depth += 1;
    else if (ch === "{") {
      depth -= 1;
      if (depth === 0) { start = i; break; }
    }
  }
  if (start === -1) return null;
  const slice = trimmed.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  return null;
}

export async function assertBridgeAvailable(): Promise<void> {
  try {
    await access(PUBLISHER_PYTHON);
  } catch {
    throw new Error(`桥接层 Python 不存在：${PUBLISHER_PYTHON}`);
  }
  try {
    await access(PUBLISHER_BRIDGE);
  } catch {
    throw new Error(`桥接层脚本不存在：${PUBLISHER_BRIDGE}`);
  }
}

interface RunOptions {
  /** 超时毫秒，默认 60s */
  timeoutMs?: number;
  /** login 等长任务用 detached 模式（不等待退出，立即返回） */
  detached?: boolean;
}

function runBridge(args: string[], options: RunOptions = {}): Promise<BridgeResult> {
  const { timeoutMs = 60_000, detached = false } = options;
  let child: ChildProcess | null = null;
  let settled = false;

  return new Promise<BridgeResult>((resolve) => {
    try {
      child = spawn(PUBLISHER_PYTHON, [PUBLISHER_BRIDGE, ...args], {
        cwd: path.dirname(PUBLISHER_BRIDGE),
        env: { ...process.env },
        detached,
        stdio: detached ? "ignore" : "pipe",
      });
    } catch (err) {
      resolve({
        success: false,
        data: null,
        error: `启动桥接进程失败：${err instanceof Error ? err.message : String(err)}`,
        stage: "spawn",
        stderrPreview: "",
        timedOut: false,
      });
      return;
    }

    // detached 模式：不收集输出，立即返回
    if (detached) {
      try { child.unref(); } catch { /* ignore */ }
      resolve({
        success: true,
        data: null,
        error: null,
        stage: "detached_started",
        stderrPreview: "",
        timedOut: false,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      settled = true;
      try { child?.kill("SIGKILL"); } catch { /* ignore */ }
      resolve({
        success: false,
        data: null,
        error: `桥接进程超时（${timeoutMs}ms）`,
        stage: "timeout",
        stderrPreview: sanitize(stderr).slice(-500),
        timedOut: true,
      });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        success: false,
        data: null,
        error: `桥接进程异常：${err.message}`,
        stage: "spawn_error",
        stderrPreview: sanitize(stderr).slice(-500),
        timedOut: false,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const data = extractLastJson(stdout);
      const success = code === 0 && Boolean(data?.success);
      resolve({
        success,
        data,
        error: success ? null : (typeof data?.error === "string" ? data.error : `桥接进程退出码 ${code}`),
        stage: typeof data?.stage === "string" ? data.stage : null,
        stderrPreview: sanitize(stderr).slice(-500),
        timedOut: false,
      });
    });
  });
}

/** 账号校验（同步等待结果，用于 validate） */
export function validateAccount(accountName: string): Promise<BridgeResult> {
  return runBridge(["validate", "--account", accountName], { timeoutMs: 120_000 });
}

/** 计算 social-auto-upload 的 storage_state 文件路径：cookies/<platform>_<accountName>.json */
export function cookieFilePath(platform: string, accountName: string): string {
  return path.join(SAU_COOKIES_DIR, `${platform}_${accountName}.json`);
}

/** 轻量级 cookie 存在性检查（仅读文件系统，不调用 sau_cli，用于登录轮询） */
export async function cookieExists(platform: string, accountName: string): Promise<boolean> {
  try {
    await access(cookieFilePath(platform, accountName));
    return true;
  } catch {
    return false;
  }
}

/** 读取 cookie 文件最近修改时间（用于"上次检查时间"展示） */
export async function cookieMtime(platform: string, accountName: string): Promise<string | undefined> {
  try {
    const s = await stat(cookieFilePath(platform, accountName));
    return s.mtime.toISOString();
  } catch {
    return undefined;
  }
}

/** 登录（detached，浏览器在用户桌面打开扫码，立即返回） */
export function loginAccount(accountName: string): Promise<BridgeResult> {
  return runBridge(["login", "--account", accountName], { timeoutMs: 60_000, detached: true });
}

/** dry-run 预检（同步等待结果） */
export interface DryRunArgs {
  accountName: string;
  videoPath: string;
  title: string;
  description?: string;
  tags?: string[];
}

export function dryRunPublish(args: DryRunArgs): Promise<BridgeResult> {
  const cliArgs = [
    "publish",
    "--account", args.accountName,
    "--video", args.videoPath,
    "--title", args.title,
  ];
  if (args.description && args.description.trim()) {
    cliArgs.push("--description", args.description);
  }
  if (args.tags && args.tags.length > 0) {
    cliArgs.push("--tags", args.tags.join(","));
  }
  cliArgs.push("--dry-run");
  return runBridge(cliArgs, { timeoutMs: 60_000 });
}

/** 把 Preframe 账号列表同步写入桥接层 accounts.json（原子写入） */
export async function syncBridgeAccounts(accounts: Array<{ accountName: string; platform: string; displayName: string }>): Promise<void> {
  const records = accounts.map((acc) => ({
    name: acc.accountName,
    platform: acc.platform,
    description: acc.displayName || acc.accountName,
  }));
  const payload = `${JSON.stringify({ accounts: records }, null, 2)}\n`;
  await mkdir(path.dirname(BRIDGE_ACCOUNTS_FILE), { recursive: true });
  const tmp = `${BRIDGE_ACCOUNTS_FILE}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, payload, "utf8");
  try {
    await rename(tmp, BRIDGE_ACCOUNTS_FILE);
  } catch (err) {
    try { await unlink(tmp); } catch { /* ignore */ }
    throw err;
  }
}
