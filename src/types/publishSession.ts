/** 零表单发布会话 — 类型定义 */

import type { PublisherPlatform } from "./publisher.js";

export type PublishSessionStatus = "ready" | "running" | "paused" | "completed" | "archived";

export type PublishSessionTargetStatus = "pending" | "opened" | "published" | "skipped";

/**
 * 抖音半自动发布执行状态。
 * 由 publisher-worker 通过 JSON 事件驱动流转。
 * 仅抖音使用；其他平台仍走手动辅助（opened/published/skipped）。
 */
export type AssistedPublishStatus =
  | "pending"
  | "launching"
  | "waiting_login"
  | "uploading"
  | "filling"
  | "ready_for_confirmation"
  | "confirmed"
  | "failed"
  | "cancelled";

export interface PublishSessionTarget {
  platform: PublisherPlatform;
  title: string;
  description: string;
  tags: string[];
  thumbnailPath?: string;
  status: PublishSessionTargetStatus;
  openedAt?: string;
  publishedAt?: string;
  /** 半自动发布执行状态（仅抖音） */
  assistedStatus?: AssistedPublishStatus;
  /** 半自动发布最近一次错误（不含敏感信息） */
  assistedError?: string;
  /** 半自动发布视频上传进度 0-100，无法读取时为 null */
  assistedProgress?: number | null;
  /** 半自动发布当前 worker 进程 id（用于取消/互斥） */
  assistedProcessId?: string;
  /** 半自动发布最近一次阶段更新时间 */
  assistedUpdatedAt?: string;
  /** 内容来源标记（title/description/tags 各自来源），用于区分真实提取与 fallback */
  source?: TargetContentSource;
  /** 是否经过 AI 智能适配改写（用户可撤销） */
  adapted?: boolean;
}

/** 各字段内容来源：明确区分平台专属提取 / 通用 fallback / AI 适配，不静默伪装 */
export interface TargetContentSource {
  title: string;
  description: string;
  tags: string;
}

export interface PublishSession {
  id: string;
  videoPath: string;
  projectSlug?: string;
  projectName?: string;
  currentIndex: number;
  status: PublishSessionStatus;
  targets: PublishSessionTarget[];
  /** 首次标记发布的时间（用于项目阶段推进） */
  firstPublishedAt?: string;
  /** 创建时自动预检结果摘要 */
  precheckSummary?: string;
  /** 自动匹配到的封面候选（高置信度已选中并写入 target.thumbnailPath） */
  coverCandidates?: CoverCandidate[];
  /** 发布就绪度（ready/warning/blocked） */
  readiness?: PublishReadiness;
  /** 真实使用行为日志（用于未来创作偏好学习，不另建分析系统） */
  usageLog?: UsageLogEntry[];
  /** 自动准备前的原始内容快照（用于 AI 适配后撤销） */
  originalSnapshot?: Record<string, { title: string; description: string; tags: string[] }>;
  createdAt: string;
  updatedAt: string;
}

/** 封面候选 */
export interface CoverCandidate {
  path: string;
  score: number;
  reasons: string[];
}

/** 发布就绪度 */
export type ReadinessLevel = "ready" | "warning" | "blocked";

export interface PublishReadiness {
  level: ReadinessLevel;
  videoExists: boolean;
  videoStable: boolean;
  projectMatchClear: boolean;
  hasTitle: boolean;
  hasDescription: boolean;
  coverPresent: boolean;
  backendUrlConfigured: boolean;
  blockers: string[];
  warnings: string[];
}

/** 使用行为日志 */
export type UsageEvent =
  | "session_started"
  | "cover_chosen"
  | "target_edited"
  | "target_adapted"
  | "target_adapt_reverted"
  | "target_skipped"
  | "target_published";

export interface UsageLogEntry {
  event: UsageEvent;
  platform?: PublisherPlatform;
  detail?: string;
  at: string;
}

export const PUBLISH_SESSION_STATUS_LABELS: Record<PublishSessionStatus, string> = {
  ready: "待开始",
  running: "进行中",
  paused: "已暂停",
  completed: "已完成",
  archived: "已归档",
};

export const PUBLISH_SESSION_TARGET_STATUS_LABELS: Record<PublishSessionTargetStatus, string> = {
  pending: "待发布",
  opened: "已打开后台",
  published: "已发布",
  skipped: "已跳过",
};

/** 抖音半自动发布状态标签 */
export const ASSISTED_PUBLISH_STATUS_LABELS: Record<AssistedPublishStatus, string> = {
  pending: "待开始",
  launching: "正在准备抖音发布",
  waiting_login: "等待扫码登录",
  uploading: "视频上传中",
  filling: "正在填写文案",
  ready_for_confirmation: "等待你检查并发布",
  confirmed: "已发布",
  failed: "发布准备失败",
  cancelled: "已取消",
};

/** 成片发现记录 */
export interface FinalVideoRecord {
  path: string;
  name: string;
  sizeBytes: number;
  mtime: string;
  /** 是否已被用户忽略或已创建会话 */
  dismissed?: boolean;
  dismissedAt?: string;
  /** 关联的发布会话 id */
  sessionId?: string;
  /** 轻量指纹：规范化文件名（用于改名/移动后去重） */
  normalizedName?: string;
  /** 轻量指纹：首 64KB 的 hash（可选，用于强去重） */
  hashHead?: string;
  /** 轻量指纹：尾 64KB 的 hash（可选，用于强去重） */
  hashTail?: string;
  /** 文件是否已稳定（连续两次扫描 size+mtime 一致） */
  stable?: boolean;
}

/** 监听的成片目录 */
export interface WatchedDirectory {
  path: string;
  enabled: boolean;
}

/** 平台预设 */
export interface PublisherPreferences {
  enabledPlatforms: PublisherPlatform[];
  platformOrder: PublisherPlatform[];
  /** 多目录监听（替代旧的单 finalVideoDirectory） */
  watchedVideoDirectories: WatchedDirectory[];
  /** @deprecated 已迁移到 watchedVideoDirectories，仅向后兼容读取 */
  finalVideoDirectory?: string;
}

/** 项目自动匹配候选 */
export interface ProjectMatchCandidate {
  projectSlug: string;
  projectName: string;
  score: number;
  reasons: string[];
}

/** 自动预检结果 */
export type PrecheckLevel = "ok" | "warning" | "blocked";

export interface PrecheckResult {
  level: PrecheckLevel;
  videoExists: boolean;
  videoFormatValid: boolean;
  titlePresent: boolean;
  enabledPlatformCount: number;
  coverExists?: boolean;
  backendUrlConfigured: boolean;
  projectReadOk: boolean;
  warnings: string[];
  errors: string[];
}
