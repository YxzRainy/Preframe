/** 剪辑准备工作台 — 类型定义
 *
 * 设计原则：
 * - Preframe 不是剪辑软件：只做素材整理 / Proxy / 文件管理 / 路径管理 / 元数据 / 交付准备
 * - 不复制原素材，editing/media 默认使用 symlink 指向真实素材
 * - 不移动、不重命名原始素材（仅重命名 editing/media 中的 symlink）
 * - Proxy 状态、cache key、stale 全部基于源文件指纹，避免重复生成 */

export type EditingAssetType = "video" | "audio" | "image";

/** Proxy 预设：第一版固定两个，不暴露大型配置表单 */
export type ProxyPreset = "fast" | "high";

/** Proxy 状态机 */
export type ProxyStatus =
  | "not_needed" // 普通格式/低分辨率，可能无需 Proxy
  | "recommended" // HEVC/4K/高码率/特殊 codec，建议生成
  | "queued" // 已入队等待生成
  | "generating" // ffmpeg 正在生成
  | "ready" // 已生成可用
  | "failed"; // 生成失败

/** editing/media 中的一条素材记录（symlink 条目） */
export interface EditingManifestEntry {
  assetId: string;
  /** 真实素材绝对路径（symlink 目标） */
  originalPath: string;
  /** editing/media 中的 symlink 路径 */
  editingPath: string;
  /** 剪辑友好名（重命名后的 symlink 文件名，如 S01_口播_VID0412.mov） */
  displayName: string;
  /** 原始文件名（重命名前），用于追溯 */
  originalFileName: string;
  type: EditingAssetType;
  sizeBytes: number;
  /** symlink 是否创建成功（失败时 manifest 仍记录 originalPath） */
  symlinkOk: boolean;
  // ── 视频元数据（ffprobe 提取，复用 MediaAsset）──
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  orientation?: "portrait" | "landscape" | "square";
  bitrate?: number;
  // ── ShotTask 关联（若已匹配）──
  shotTaskId?: string;
  shotOrder?: number;
  // ── Proxy 状态（由 proxyManager 维护）──
  proxyStatus?: ProxyStatus;
  proxyPreset?: ProxyPreset;
  proxyPath?: string;
  proxySizeBytes?: number;
  proxyStale?: boolean;
  /** 生成 proxy 时源文件的指纹（size+mtime），用于 stale 判断 */
  proxySourceFingerprint?: string;
  addedAt: string;
  updatedAt?: string;
}

/** 项目剪辑工作区清单 */
export interface EditingManifest {
  projectSlug: string;
  /** editing 目录绝对路径 */
  editingDir: string;
  createdAt: string;
  updatedAt: string;
  entries: EditingManifestEntry[];
}

/** Proxy 生成任务（持久化到 .piance/proxy-jobs.json） */
export interface ProxyJob {
  id: string;
  projectSlug: string;
  assetId: string;
  /** 源素材绝对路径 */
  sourcePath: string;
  preset: ProxyPreset;
  status: ProxyStatus;
  /** 0-100 进度 */
  progress: number;
  /** proxy 输出路径 */
  proxyPath: string;
  /** cache key：sourcePath|size|mtime|preset 的 hash */
  cacheKey: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export const PROXY_PRESET_LABELS: Record<ProxyPreset, string> = {
  fast: "快速代理",
  high: "高质量代理",
};

export const PROXY_STATUS_LABELS: Record<ProxyStatus, string> = {
  not_needed: "无需 Proxy",
  recommended: "建议生成",
  queued: "已排队",
  generating: "生成中",
  ready: "已准备",
  failed: "生成失败",
};
