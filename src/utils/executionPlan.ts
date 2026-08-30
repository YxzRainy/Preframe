export type ExecutionShootingStatus = "todo" | "ready" | "shot" | "done";
export type ExecutionEditingStatus = "pending" | "editing" | "done";

export interface ExecutionSegment {
  id: string;
  order: number;
  time: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  spokenText: string;
  shot: string;
  subtitle: string;
  broll: string;
  mustShoot: boolean;
  shootingStatus: ExecutionShootingStatus;
  editingStatus: ExecutionEditingStatus;
}

export interface ExecutionPlan {
  sourceDocument: "02_拍摄执行稿.md";
  sourceType: "markdown-execution-table";
  derivedAt: string;
  totalDurationSeconds: number;
  segments: ExecutionSegment[];
}

function clockSeconds(minutes: string, seconds: string): number {
  return Number(minutes) * 60 + Number(seconds);
}

export function parseTimeRange(value: string): { startSeconds: number; endSeconds: number } | null {
  const clocks = value.match(/(\d{1,2}):(\d{2})\s*[-–—~至]\s*(\d{1,2}):(\d{2})/u);
  if (clocks) {
    const startSeconds = clockSeconds(clocks[1], clocks[2]);
    const endSeconds = clockSeconds(clocks[3], clocks[4]);
    return endSeconds > startSeconds ? { startSeconds, endSeconds } : null;
  }
  const seconds = value.match(/(\d{1,3})\s*[-–—~至]\s*(\d{1,3})\s*(?:s|秒)/iu);
  if (!seconds) return null;
  const startSeconds = Number(seconds[1]);
  const endSeconds = Number(seconds[2]);
  return endSeconds > startSeconds ? { startSeconds, endSeconds } : null;
}

function shootingStatus(value: string): ExecutionShootingStatus {
  if (/已完成|完成/u.test(value)) return "done";
  if (/已拍/u.test(value)) return "shot";
  if (/素材已齐|就绪/u.test(value)) return "ready";
  return "todo";
}

function normalizedHeader(line: string): string {
  return line.replace(/[\s：:／/\-|]/gu, "").toLowerCase();
}

/** 02 的镜头执行表是口播、镜头、字幕、素材和执行状态的唯一结构化来源。 */
export function parseExecutionSegments(markdown: string): ExecutionSegment[] {
  const lines = markdown.split("\n");
  const headerIndex = lines.findIndex((line) => {
    const normalized = normalizedHeader(line);
    return line.trim().startsWith("|") && ["时间", "最终口播", "画面动作", "字幕重点", "broll素材", "拍摄状态"].every((term) => normalized.includes(term));
  });
  if (headerIndex < 0) return [];
  const segments: ExecutionSegment[] = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index]?.trim() || "";
    if (!/^\|.*\|$/u.test(line)) break;
    const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
    if (cells.length < 6) continue;
    const range = parseTimeRange(cells[0] || "");
    if (!range) continue;
    const order = segments.length + 1;
    segments.push({
      id: `segment-${String(order).padStart(3, "0")}`,
      order,
      time: cells[0] || "",
      startSeconds: range.startSeconds,
      endSeconds: range.endSeconds,
      durationSeconds: range.endSeconds - range.startSeconds,
      spokenText: cells[1] || "",
      shot: cells[2] || "",
      subtitle: cells[3] || "",
      broll: cells[4] || "",
      mustShoot: !/可选|备选/u.test(`${cells[2]} ${cells[4]}`),
      shootingStatus: shootingStatus(cells[5] || ""),
      editingStatus: "pending",
    });
  }
  return segments;
}

export function executionPlanFromMarkdown(markdown: string, previous?: unknown): ExecutionPlan {
  const previousSegments = previous && typeof previous === "object" && !Array.isArray(previous)
    ? (previous as { segments?: unknown }).segments
    : undefined;
  const previousList = Array.isArray(previousSegments) ? previousSegments as Array<Record<string, unknown>> : [];
  const previousByText = new Map(previousList.map((segment) => [String(segment.spokenText || "").replace(/\s+/gu, ""), segment]));
  const segments = parseExecutionSegments(markdown).map((segment) => {
    const old = previousByText.get(segment.spokenText.replace(/\s+/gu, ""));
    return {
      ...segment,
      shootingStatus: old && ["todo", "ready", "shot", "done"].includes(String(old.shootingStatus)) ? old.shootingStatus as ExecutionShootingStatus : segment.shootingStatus,
      editingStatus: old && ["pending", "editing", "done"].includes(String(old.editingStatus)) ? old.editingStatus as ExecutionEditingStatus : segment.editingStatus,
    };
  });
  return {
    sourceDocument: "02_拍摄执行稿.md",
    sourceType: "markdown-execution-table",
    derivedAt: new Date().toISOString(),
    totalDurationSeconds: segments.at(-1)?.endSeconds || 0,
    segments,
  };
}
