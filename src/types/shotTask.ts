/** 镜头执行数据层 — 类型定义 */

export type ShotTaskStatus = "todo" | "ready" | "shot" | "done";

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
}
