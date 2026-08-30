/** 镜头执行数据层 — 类型定义 */

export type ShotTaskStatus = "todo" | "ready" | "shot" | "done";

export type ShotTakeOutcome = "good" | "usable" | "reshoot";

export interface ShotTake {
  id: string;
  createdAt: string;
  outcome: ShotTakeOutcome;
  note?: string;
}

export interface ShotTask {
  id: string;
  order: number;
  narration: string;
  shotType: string;
  durationSeconds?: number;
  visualDescription: string;
  requiredAssets: string[];
  existingAssets: string[];
  missingAssets: string[];
  aiPrompt?: string;
  status: ShotTaskStatus;
  notes?: string;
  /** 现场拍摄模式记录；只存决策，不复制视频文件。 */
  takes?: ShotTake[];
  bestTakeId?: string;
  needsReshoot?: boolean;
}
