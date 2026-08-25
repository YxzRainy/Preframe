/** 素材自动整理 — 类型定义
 *
 * 设计原则：
 * - 不复制/移动原始素材文件，仅记录路径与关系
 * - 素材必须关联现有 ShotTask，不建立第二套镜头结构
 * - 视频元数据优先调用系统 ffprobe，缺失时降级为基础文件信息
 * - 去重使用轻量指纹（首尾 64KB hash + size + 规范化文件名），不读完整大文件 */

export type MediaAssetKind = "video" | "image";

/** 扫描能力等级：
 * - full: ffprobe 可用，视频元数据完整
 * - basic: ffprobe 缺失，仅基础文件信息（path/size/time）
 * - ffprobe_missing: 显式标记 ffprobe 不可用 */
export type ScanCapability = "full" | "basic";

export type MediaOrientation = "landscape" | "portrait" | "square";

/** 素材监听目录配置（一次性，全局，不按项目重复设置） */
export interface MediaWatchedDirectory {
  id: string;
  path: string;
  enabled: boolean;
}

export interface MediaPreferences {
  watchedDirectories: MediaWatchedDirectory[];
}

/** 素材资产记录。不存储文件内容，只存路径与轻量指纹。 */
export interface MediaAsset {
  id: string;
  path: string;
  fileName: string;
  ext: string;
  kind: MediaAssetKind;
  sizeBytes: number;
  /** 文件创建时间（birthtime，不可用时回退 mtime） */
  createdAt: string;
  /** 文件修改时间 */
  modifiedAt: string;
  /** 规范化文件名（去后缀/导出标记/标点/小写），用于改名后去重 */
  normalizedName: string;
  /** 轻量指纹：首 64KB hash */
  hashHead?: string;
  /** 轻量指纹：尾 64KB hash */
  hashTail?: string;
  stable: boolean;

  // ── 视频元数据（仅 ffprobe 可用时填充） ──
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  orientation?: MediaOrientation;
  codec?: string;

  // ── 项目自动匹配结果 ──
  projectSlug?: string;
  projectMatchScore?: number;
  projectMatchReasons?: string[];
  projectMatchStatus?: "confirmed" | "candidate" | "unmatched";
  projectCandidates?: ProjectMatchCandidate[];

  scannedAt: string;
}

/** 项目匹配候选 */
export interface ProjectMatchCandidate {
  projectSlug: string;
  projectName: string;
  score: number;
  reasons: string[];
}

/** 扫描目录信息（用于前端显示目录状态） */
export interface MediaScannedDirectory {
  id: string;
  path: string;
  enabled: boolean;
  exists: boolean;
  error?: string;
  fileCount: number;
}

export interface MediaScanResult {
  assets: MediaAsset[];
  capability: ScanCapability;
  scannedAt: string;
  directories: MediaScannedDirectory[];
  /** 本次新增的稳定资产数 */
  newCount: number;
}

// ── 镜头-素材关系 ──

export type ShotAssetLinkSource = "automatic" | "visual_analysis" | "manual";
export type ShotAssetLinkStatus = "suggested" | "confirmed" | "rejected";

/** 镜头-素材关系。不移动原始文件，仅记录关联。
 * - 一个 ShotTask 可对应多个素材（主素材 + 备用）
 * - 一个素材默认只确认到一个主要 ShotTask，可重新指定 */
export interface ShotAssetLink {
  id: string;
  projectSlug: string;
  shotTaskId: string;
  assetId: string;
  confidence: number;
  source: ShotAssetLinkSource;
  status: ShotAssetLinkStatus;
  /** 是否为主素材（一个镜头最多一个主素材） */
  primary?: boolean;
  createdAt: string;
  updatedAt?: string;
}

/** 镜头在素材维度的状态（用于 UI 显示） */
export type ShotAssetState =
  | "not_shot" // 未拍：无任何素材
  | "has_candidate" // 有候选素材（suggested 未确认）
  | "has_asset" // 已有素材（confirmed）
  | "confirmed" // 已确认主素材
  | "not_needed"; // 不需要

export const SHOT_ASSET_STATE_LABELS: Record<ShotAssetState, string> = {
  not_shot: "未拍",
  has_candidate: "有候选素材",
  has_asset: "已有素材",
  confirmed: "已确认",
  not_needed: "不需要",
};
