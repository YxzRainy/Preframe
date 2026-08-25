/** 抖音半自动发布 Worker 客户端
 *
 * 职责：
 * - 通过 child_process.spawn（参数数组，禁止 exec / shell 拼接）调用 Python worker
 * - 逐行解析 stdout JSON 事件，映射到 AssistedPublishStatus 并写回会话
 * - 区分登录等待 / 视频上传 / 页面操作超时（由 worker 内部阶段超时保证，客户端做整体看门狗）
 * - 支持取消（SIGTERM → worker 取消 → 退出）
 * - 进程异常退出时恢复会话状态为 failed
 * - 不使用纯内存状态作为唯一数据源：进程元数据持久化到 publisherProcessStore
 * - 不输出 Cookie/Token/storage_state/Profile 内容
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import type { PublisherPlatform } from "../types/publisher.js";
import type { AssistedPublishStatus, PublishSessionTarget } from "../types/publishSession.js";
import { findSession, updateTargetAssisted } from "./publishSessionStore.js";
import {
  createProcess,
  findActiveByProfile,
  markCancelled,
  markDone,
  markFailed,
  updateProcess,
} from "./publisherProcessStore.js";

// ── 路径与可执行文件解析 ─────────────────────────────────────────────────
const PUBLISHER_LAB_ROOT = path.resolve(
  process.env.PUBLISHER_LAB_ROOT || "/Users/YxzRainy/Documents/Vibecoding/PreframePublisherLab",
);
const PREFRAME_ROOT = path.resolve(process.env.PREFRAME_ROOT || process.cwd());
const WORKER_SCRIPT = path.join(PUBLISHER_LAB_ROOT, "publisher-worker", "worker.py");

function resolvePython(): string {
  const fromEnv = process.env.PUBLISHER_WORKER_PYTHON;
  if (fromEnv) return fromEnv;
  // 优先用 PublisherLab 的 venv
  const venvPython = path.join(PUBLISHER_LAB_ROOT, ".venv", "bin", "python");
  return venvPython;
}

// ── 活跃进程表（内存，用于取消；持久化在 publisherProcessStore） ─────────
interface ActiveProcess {
  child: ChildProcess;
  processId: string;
  sessionId: string;
  platform: PublisherPlatform;
  /** 整体看门狗定时器 */
  watchdog: NodeJS.Timeout;
  /** 取消时的强制 SIGKILL 定时器 */
  killTimer: NodeJS.Timeout | null;
}

const activeProcesses = new Map<string, ActiveProcess>();

// 整体看门狗：覆盖登录等待(600) + 上传(900) + 填写(300) + 确认保持(3600) + 余量
const OVERALL_TIMEOUT_MS = 60 * 60 * 1000; // 60 分钟整体上限
// 取消后宽限时间：等 worker 自行清理
const CANCEL_GRACE_MS = 8000;

// ── 事件 → 状态映射 ─────────────────────────────────────────────────────
interface WorkerEvent {
  stage: string;
  success?: boolean;
  progress?: number | null;
  error?: string;
  message?: string;
  screenshot?: string;
}

function mapStageToAssisted(stage: string): AssistedPublishStatus {
  switch (stage) {
    case "launching":
    case "checking_login":
      return "launching";
    case "waiting_login":
      return "waiting_login";
    case "uploading_video":
      return "uploading";
    case "filling_title":
    case "filling_description":
    case "filling_tags":
    case "uploading_cover":
      return "filling";
    case "ready_for_confirmation":
    case "holding_done":
      return "ready_for_confirmation";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    default:
      return "launching";
  }
}

function mapStageToProcessStage(stage: string) {
  const valid = [
    "launching",
    "checking_login",
    "waiting_login",
    "uploading_video",
    "filling_title",
    "filling_description",
    "filling_tags",
    "uploading_cover",
    "ready_for_confirmation",
    "holding_done",
    "cancelled",
    "failed",
  ] as const;
  return (valid as readonly string[]).includes(stage) ? (stage as (typeof valid)[number]) : "launching";
}

/** 敏感关键字过滤：禁止写入会话的错误文案 */
function sanitizeError(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();
  if (/cookie|token|authorization|storage_state|set-cookie|sessionid/.test(lower)) {
    return "[REDACTED]";
  }
  return text.slice(0, 200);
}

// ── stdout 行解析 ────────────────────────────────────────────────────────
function parseEventLine(line: string): WorkerEvent | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed) as WorkerEvent;
  } catch {
    return null;
  }
}

// ── 启动 worker ─────────────────────────────────────────────────────────
export interface StartDouyinWorkerInput {
  sessionId: string;
  platform: PublisherPlatform;
  profile?: string;
  target: PublishSessionTarget;
  videoPath: string;
}

export interface StartDouyinWorkerResult {
  ok: boolean;
  processId?: string;
  error?: string;
}

export async function startDouyinWorker(input: StartDouyinWorkerInput): Promise<StartDouyinWorkerResult> {
  const profile = input.profile || "primary";

  // 1. 互斥：同一 profile 只允许一个活跃进程
  const active = await findActiveByProfile(input.platform, profile);
  if (active) {
    return {
      ok: false,
      error: `已有正在运行的 ${input.platform}/${profile} 发布进程，请先取消或等待完成。`,
    };
  }

  // 2. 校验会话存在
  const session = await findSession(input.sessionId);
  if (!session) return { ok: false, error: "发布会话不存在。" };

  // 3. 校验视频文件存在
  try {
    await fs.access(input.videoPath);
  } catch {
    return { ok: false, error: `视频文件不存在：${input.videoPath}` };
  }

  // 4. 创建进程记录（持久化）
  const record = await createProcess({
    sessionId: input.sessionId,
    platform: input.platform,
    profile,
    videoPath: input.videoPath,
    title: input.target.title,
  });

  // 5. 标记 target 进入 launching
  await updateTargetAssisted(input.sessionId, input.platform, {
    assistedStatus: "launching",
    assistedProgress: null,
    assistedError: undefined,
    assistedProcessId: record.id,
  });

  // 6. spawn worker（参数数组，无 shell）
  const args = [
    WORKER_SCRIPT,
    "prepare-douyin",
    "--preframe-root",
    PREFRAME_ROOT,
    "--profile",
    profile,
    "--video",
    input.videoPath,
    "--title",
    input.target.title,
    "--description",
    input.target.description,
    "--tags",
    JSON.stringify(input.target.tags || []),
  ];
  if (input.target.thumbnailPath) {
    args.push("--cover", input.target.thumbnailPath);
  }

  let child: ChildProcess;
  try {
    child = spawn(resolvePython(), args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        // 避免 worker 把 Cookie 路径写进日志
        PREFERENCE_PROFILE_DIR: "",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markFailed(record.id, `启动 worker 失败：${msg}`);
    await updateTargetAssisted(input.sessionId, input.platform, {
      assistedStatus: "failed",
      assistedError: sanitizeError(`启动 worker 失败：${msg}`),
    });
    return { ok: false, error: `启动 worker 失败：${msg}` };
  }

  // 记录 pid
  if (typeof child.pid === "number") {
    await updateProcess(record.id, { pid: child.pid });
  }

  // 7. 看门狗
  const watchdog = setTimeout(() => {
    handleTimeout(record.id);
  }, OVERALL_TIMEOUT_MS);

  const entry: ActiveProcess = {
    child,
    processId: record.id,
    sessionId: input.sessionId,
    platform: input.platform,
    watchdog,
    killTimer: null,
  };
  activeProcesses.set(record.id, entry);

  // 8. stdout 逐行解析
  let stdoutBuf = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdoutBuf += chunk;
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() || "";
    for (const line of lines) {
      const event = parseEventLine(line);
      if (event) handleEvent(record.id, input.sessionId, input.platform, event);
    }
  });

  // 9. stderr：只记录非敏感的简短行，丢弃 traceback 细节
  let stderrBuf = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderrBuf += chunk;
    const lines = stderrBuf.split("\n");
    stderrBuf = lines.pop() || "";
    // 仅在调试日志中保留最后几行，不写入会话
    if (process.env.PUBLISHER_WORKER_DEBUG === "1") {
      for (const line of lines) {
        const safe = sanitizeError(line);
        if (safe) console.error(`[worker ${record.id}] ${safe.slice(0, 120)}`);
      }
    }
  });

  // 10. 进程退出
  child.on("exit", (code, signal) => {
    handleExit(record.id, input.sessionId, input.platform, code, signal);
  });
  child.on("error", (err) => {
    void handleSpawnError(record.id, input.sessionId, input.platform, err);
  });

  return { ok: true, processId: record.id };
}

// ── 事件处理 ─────────────────────────────────────────────────────────────
async function handleEvent(
  processId: string,
  sessionId: string,
  platform: PublisherPlatform,
  event: WorkerEvent,
) {
  const assisted = mapStageToAssisted(event.stage);
  const procStage = mapStageToProcessStage(event.stage);

  // 更新进程记录
  const patch: Parameters<typeof updateProcess>[1] = { stage: procStage };
  if (typeof event.progress === "number") patch.progress = event.progress;
  else if (event.progress === null) patch.progress = null;
  if (event.success === false && event.error) patch.error = sanitizeError(event.error);
  try {
    await updateProcess(processId, patch);
  } catch {
    // 进程记录可能已被清理，忽略
  }

  // 更新会话 target
  const targetPatch: Parameters<typeof updateTargetAssisted>[2] = {
    assistedStatus: assisted,
  };
  if (typeof event.progress === "number") targetPatch.assistedProgress = event.progress;
  else if (event.progress === null && assisted === "uploading") targetPatch.assistedProgress = event.progress;
  if (event.success === false && event.error) {
    targetPatch.assistedError = sanitizeError(event.error);
  } else if (event.success === true && assisted !== "failed") {
    // 阶段成功时清空错误
    targetPatch.assistedError = undefined;
  }
  // 失败事件 → target failed
  if (event.success === false && (event.stage === "failed" || event.error)) {
    targetPatch.assistedStatus = "failed";
  }
  try {
    await updateTargetAssisted(sessionId, platform, targetPatch);
  } catch {
    // 会话可能已被删除，忽略
  }
}

// ── 退出处理 ─────────────────────────────────────────────────────────────
async function handleExit(
  processId: string,
  sessionId: string,
  platform: PublisherPlatform,
  code: number | null,
  signal: NodeJS.Signals | null,
) {
  const entry = activeProcesses.get(processId);
  if (entry) {
    clearTimeout(entry.watchdog);
    if (entry.killTimer) clearTimeout(entry.killTimer);
    activeProcesses.delete(processId);
  }

  // 被取消（SIGTERM 导致的非零退出）
  if (signal === "SIGTERM" || signal === "SIGINT" || code === 130) {
    try {
      await markCancelled(processId);
    } catch {
      /* ignore */
    }
    try {
      await updateTargetAssisted(sessionId, platform, { assistedStatus: "cancelled" });
    } catch {
      /* ignore */
    }
    return;
  }

  // 正常退出（holding_done，worker 主动退出但浏览器状态保留）
  if (code === 0) {
    try {
      await markDone(processId);
    } catch {
      /* ignore */
    }
    // 保持 ready_for_confirmation（已在事件中设置），不改动
    return;
  }

  // 其他非零退出 → 失败（若 target 仍是进行中态）
  try {
    await markFailed(processId, `worker 异常退出（code=${code ?? signal}）`);
  } catch {
    /* ignore */
  }
  try {
    const session = await findSession(sessionId);
    const target = session?.targets.find((t) => t.platform === platform);
    const stillRunning =
      target?.assistedStatus &&
      !["failed", "cancelled", "confirmed", "ready_for_confirmation"].includes(target.assistedStatus);
    if (stillRunning) {
      await updateTargetAssisted(sessionId, platform, {
        assistedStatus: "failed",
        assistedError: `worker 异常退出（code=${code ?? signal}）`,
      });
    }
  } catch {
    /* ignore */
  }
}

async function handleSpawnError(
  processId: string,
  sessionId: string,
  platform: PublisherPlatform,
  err: Error,
) {
  const entry = activeProcesses.get(processId);
  if (entry) {
    clearTimeout(entry.watchdog);
    if (entry.killTimer) clearTimeout(entry.killTimer);
    activeProcesses.delete(processId);
  }
  try {
    await markFailed(processId, `spawn error: ${err.message}`);
  } catch {
    /* ignore */
  }
  try {
    await updateTargetAssisted(sessionId, platform, {
      assistedStatus: "failed",
      assistedError: sanitizeError(`启动 worker 失败：${err.message}`),
    });
  } catch {
    /* ignore */
  }
}

async function handleTimeout(processId: string) {
  const entry = activeProcesses.get(processId);
  if (!entry) return;
  console.error(`[publisherWorkerClient] 整体超时，取消 worker ${processId}`);
  await cancelWorker(processId, "整体超时");
}

// ── 取消 ─────────────────────────────────────────────────────────────────
export async function cancelWorker(
  processId: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (reason) {
    console.error(`[publisherWorkerClient] 取消 worker ${processId}：${reason}`);
  }
  const entry = activeProcesses.get(processId);
  if (!entry) {
    // 进程已不在内存（可能已退出或服务重启）→ 仅更新持久化状态
    try {
      await markCancelled(processId);
    } catch {
      /* ignore */
    }
    return { ok: true };
  }

  // 先 SIGTERM，让 worker 走 finally 关闭浏览器
  try {
    entry.child.kill("SIGTERM");
  } catch {
    /* ignore */
  }

  // 宽限期后仍存活则 SIGKILL
  entry.killTimer = setTimeout(() => {
    try {
      entry.child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }, CANCEL_GRACE_MS);

  return { ok: true };
}

/** 取消某会话某平台的活跃 worker（UI 取消按钮调用） */
export async function cancelWorkerForTarget(
  sessionId: string,
  platform: PublisherPlatform,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  for (const entry of activeProcesses.values()) {
    if (entry.sessionId === sessionId && entry.platform === platform) {
      return cancelWorker(entry.processId, reason);
    }
  }
  return { ok: true };
}

// ── 重试 ─────────────────────────────────────────────────────────────────
/** 重试：先取消旧进程（若残留），再启动新 worker。
 * 重试按钮使用幂等键由 API 层保证；此处只负责执行。 */
export async function retryDouyinWorker(input: StartDouyinWorkerInput): Promise<StartDouyinWorkerResult> {
  await cancelWorkerForTarget(input.sessionId, input.platform, "重试前取消旧进程");
  // 等待旧进程清理
  await new Promise((r) => setTimeout(r, 500));
  return startDouyinWorker(input);
}

// ── 启动时恢复 ───────────────────────────────────────────────────────────
/** 服务启动时调用：将持久化中仍为 running 但内存无对应进程的记录标记为 failed。 */
export async function reconcileProcessesOnStartup(): Promise<void> {
  const activePids = new Set<number>();
  for (const entry of activeProcesses.values()) {
    if (typeof entry.child.pid === "number") activePids.add(entry.child.pid);
  }
  const { reconcileOnStartup } = await import("./publisherProcessStore.js");
  await reconcileOnStartup(() => activePids);
}

// ── 获取活跃进程快照（供 API 状态查询） ──────────────────────────────────
export function getActiveProcessIds(): string[] {
  return Array.from(activeProcesses.keys());
}
