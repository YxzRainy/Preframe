/** 拍摄后复盘与下一版内容的数据模型。 */

export type ShotActualOutcome = "used" | "removed" | "reshoot" | "not_shot";

export interface ShotActualRecord {
  shotTaskId: string;
  order: number;
  label?: string;
  plannedDurationSeconds?: number;
  actualDurationSeconds?: number;
  outcome: ShotActualOutcome;
  issue?: string;
  note?: string;
}

export interface AddedShotRecord {
  id: string;
  label: string;
  actualDurationSeconds?: number;
  reason?: string;
}

export interface ShootingFeedback {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  shootDate?: string;
  location?: string;
  shotRecords: ShotActualRecord[];
  addedShots: AddedShotRecord[];
  onSetIssues: string[];
  overallNote?: string;
  scriptAdjustments?: string;
  storyboardAdjustments?: string;
  checklistAdjustments?: string;
}

export interface ShootingFeedbackInput {
  id?: string;
  title?: string;
  shootDate?: string;
  location?: string;
  shotRecords?: ShotActualRecord[];
  addedShots?: Array<Partial<AddedShotRecord> & { label: string }>;
  onSetIssues?: string[];
  overallNote?: string;
  scriptAdjustments?: string;
  storyboardAdjustments?: string;
  checklistAdjustments?: string;
}

export interface RevisionFileSummary {
  filename: string;
  originalFilename: string;
  lineAdded: number;
  lineRemoved: number;
}

export interface FeedbackRevision {
  id: string;
  createdAt: string;
  feedbackId: string;
  sourceFiles: string[];
  files: RevisionFileSummary[];
  directory: string;
  status: "ready" | "failed";
  error?: string;
}
