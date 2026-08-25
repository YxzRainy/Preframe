/** 矩阵发布中心 — 类型定义 */

export type PublisherPlatform =
  | "douyin"
  | "xiaohongshu"
  | "bilibili"
  | "tencent"
  | "kuaishou"
  | "youtube";

export const PUBLISHER_PLATFORMS: readonly PublisherPlatform[] = [
  "douyin",
  "xiaohongshu",
  "bilibili",
  "tencent",
  "kuaishou",
  "youtube",
];

export const PUBLISHER_PLATFORM_LABELS: Record<PublisherPlatform, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  bilibili: "B站",
  tencent: "视频号",
  kuaishou: "快手",
  youtube: "YouTube",
};

// ── 真实能力矩阵 ──────────────────────────────────────────
// 仅记录已通过实际运行验证的能力，禁止把"存在代码"写成"已验证"。
// login: 是否已实测扫码登录并生成有效 storage_state
// videoUpload: 是否已实测视频上传流程
// finalPublish: 最终发布一律标记未实现（禁止真实点击）
// multiAccount: 同平台多账号隔离机制

export type CapabilityStatus = "verified" | "unverified";

export interface PlatformCapability {
  /** 登录扫码流程是否已实测通过（生成有效 storage_state） */
  login: CapabilityStatus;
  /** 视频上传流程是否已实测通过 */
  videoUpload: CapabilityStatus;
  /** 最终发布：一律未实现 */
  finalPublish: "not_implemented";
  /** 多账号隔离机制 */
  multiAccount: "mechanism_supported_unverified" | "verified";
  /** 是否具备真实扫码登录 UI 流程（按钮文案据此切换） */
  loginFlowReady: boolean;
}

export const PLATFORM_CAPABILITIES: Record<PublisherPlatform, PlatformCapability> = {
  // 抖音：扫码登录流程已验证（能打开浏览器、生成二维码），但尚未完成真实扫码生成 storage_state
  douyin: {
    login: "unverified",
    videoUpload: "unverified",
    finalPublish: "not_implemented",
    multiAccount: "mechanism_supported_unverified",
    loginFlowReady: true,
  },
  // 小红书：同抖音
  xiaohongshu: {
    login: "unverified",
    videoUpload: "unverified",
    finalPublish: "not_implemented",
    multiAccount: "mechanism_supported_unverified",
    loginFlowReady: true,
  },
  // 视频号：sau_cli 支持 --headed，但未实测
  tencent: {
    login: "unverified",
    videoUpload: "unverified",
    finalPublish: "not_implemented",
    multiAccount: "mechanism_supported_unverified",
    loginFlowReady: false,
  },
  // B站：sau_cli login 不支持 --headed（走 biliup），bridge 调用会失败，未实测
  bilibili: {
    login: "unverified",
    videoUpload: "unverified",
    finalPublish: "not_implemented",
    multiAccount: "mechanism_supported_unverified",
    loginFlowReady: false,
  },
  kuaishou: {
    login: "unverified",
    videoUpload: "unverified",
    finalPublish: "not_implemented",
    multiAccount: "mechanism_supported_unverified",
    loginFlowReady: false,
  },
  youtube: {
    login: "unverified",
    videoUpload: "unverified",
    finalPublish: "not_implemented",
    multiAccount: "mechanism_supported_unverified",
    loginFlowReady: false,
  },
};

/** 默认在发布中心首页展示的平台（用户明确要求：抖音/小红书/视频号/B站） */
export const PUBLISH_HOME_PLATFORMS: readonly PublisherPlatform[] = [
  "douyin",
  "xiaohongshu",
  "tencent",
  "bilibili",
];

export const CAPABILITY_LABELS = {
  login: { verified: "登录：已验证", unverified: "登录：未验证" },
  videoUpload: { verified: "视频上传：已验证", unverified: "视频上传：未验证" },
  finalPublish: { not_implemented: "最终发布：未实现" },
  multiAccount: {
    mechanism_supported_unverified: "多账号：机制支持 / 实测未验证",
    verified: "多账号：已验证",
  },
} as const;

// ── 平台发布字段配置（集中配置，禁止散落 if/else） ─────────
// 官方创作者后台 URL 全部取自 social-auto-upload uploader 代码中 page.goto 的真实地址，
// 不自行猜测；B 站走 biliup CLI，代码中无网页后台 URL，故留空。
export interface PlatformPublishProfile {
  platform: PublisherPlatform;
  label: string;
  titleRequired: boolean;
  descriptionSupported: boolean;
  tagsSupported: boolean;
  thumbnailSupported: boolean;
  /** 自动发布能力状态：一律不得标记为 verified */
  autoPublishStatus: "unverified" | "experimental" | "verified";
  /** 官方创作者后台/上传页 URL（来自 social-auto-upload 代码），无则 undefined */
  creatorBackendUrl?: string;
  /** 后台来源说明 */
  creatorBackendNote?: string;
  /** 自动化登录是否已端到端验证（当前全部为 false） */
  loginVerified: boolean;
}

export const PLATFORM_PUBLISH_PROFILES: Record<PublisherPlatform, PlatformPublishProfile> = {
  douyin: {
    platform: "douyin",
    label: "抖音",
    titleRequired: true,
    descriptionSupported: true,
    tagsSupported: true,
    thumbnailSupported: true,
    autoPublishStatus: "experimental",
    creatorBackendUrl: "https://creator.douyin.com/creator-micro/content/upload",
    creatorBackendNote: "来源：douyin_uploader main.py page.goto",
    loginVerified: false,
  },
  xiaohongshu: {
    platform: "xiaohongshu",
    label: "小红书",
    titleRequired: true,
    descriptionSupported: true,
    tagsSupported: true,
    thumbnailSupported: true,
    autoPublishStatus: "experimental",
    creatorBackendUrl: "https://creator.xiaohongshu.com/publish/publish?from=homepage&target=video",
    creatorBackendNote: "来源：xiaohongshu_uploader main.py _build_xhs_creator_url",
    loginVerified: false,
  },
  tencent: {
    platform: "tencent",
    label: "视频号",
    titleRequired: true,
    descriptionSupported: true,
    tagsSupported: false,
    thumbnailSupported: true,
    autoPublishStatus: "unverified",
    creatorBackendUrl: "https://channels.weixin.qq.com/platform/post/create",
    creatorBackendNote: "来源：tencent_uploader main.py TENCENT_UPLOAD_URL",
    loginVerified: false,
  },
  bilibili: {
    platform: "bilibili",
    label: "B站",
    titleRequired: true,
    descriptionSupported: true,
    tagsSupported: true,
    thumbnailSupported: true,
    autoPublishStatus: "unverified",
    // biliup 走 CLI，social-auto-upload 代码中无网页后台 URL，不猜测
    creatorBackendNote: "B 站通过 biliup CLI 管理，social-auto-upload 未含网页后台 URL",
    loginVerified: false,
  },
  kuaishou: {
    platform: "kuaishou",
    label: "快手",
    titleRequired: true,
    descriptionSupported: true,
    tagsSupported: true,
    thumbnailSupported: true,
    autoPublishStatus: "unverified",
    creatorBackendUrl: "https://cp.kuaishou.com/article/publish/video",
    creatorBackendNote: "来源：ks_uploader main.py KUAISHOU_UPLOAD_URL",
    loginVerified: false,
  },
  youtube: {
    platform: "youtube",
    label: "YouTube",
    titleRequired: true,
    descriptionSupported: true,
    tagsSupported: true,
    thumbnailSupported: true,
    autoPublishStatus: "unverified",
    creatorBackendUrl: "https://www.youtube.com/upload",
    creatorBackendNote: "来源：youtube_uploader main.py UPLOAD_URL",
    loginVerified: false,
  },
};

/** 发布准备可选平台（用户要求：抖音/小红书/视频号/B站/快手/YouTube） */
export const PREPARATION_PLATFORMS: readonly PublisherPlatform[] = [
  "douyin",
  "xiaohongshu",
  "tencent",
  "bilibili",
  "kuaishou",
  "youtube",
];

export type PublisherAccountStatus =
  | "not_logged_in"
  | "checking"
  | "logged_in"
  | "expired"
  | "error";

export interface PublisherAccount {
  id: string;
  platform: PublisherPlatform;
  accountName: string;
  displayName: string;
  enabled: boolean;
  status: PublisherAccountStatus;
  lastCheckedAt?: string;
  message?: string;
}

/** 桥接层 accounts.json 所需的最小字段 */
export interface BridgeAccountRecord {
  name: string;
  platform: PublisherPlatform;
  description: string;
}

export type PublishJobStatus =
  | "draft"
  | "validating"
  | "ready"
  | "running"
  | "partial"
  | "completed"
  | "failed"
  | "cancelled";

export type PublishTargetStatus =
  | "pending"
  | "validating"
  | "ready"
  | "running"
  | "success"
  | "failed"
  | "requires_login"
  | "cancelled";

export interface PublishTarget {
  id: string;
  accountId: string;
  platform: PublisherPlatform;
  title: string;
  description: string;
  tags: string[];
  thumbnailPath?: string;
  status: PublishTargetStatus;
  error?: string;
  updatedAt: string;
}

export interface PublishMasterContent {
  title: string;
  description: string;
  tags: string[];
}

export interface PublishJob {
  id: string;
  projectSlug?: string;
  videoPath: string;
  thumbnailPath?: string;
  masterContent: PublishMasterContent;
  status: PublishJobStatus;
  targets: PublishTarget[];
  createdAt: string;
  updatedAt: string;
}

export const PUBLISH_JOB_STATUS_LABELS: Record<PublishJobStatus, string> = {
  draft: "草稿",
  validating: "检查中",
  ready: "就绪",
  running: "发布中",
  partial: "部分完成",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export const PUBLISH_TARGET_STATUS_LABELS: Record<PublishTargetStatus, string> = {
  pending: "待检查",
  validating: "检查中",
  ready: "准备完成",
  running: "发布中",
  success: "成功",
  failed: "失败",
  requires_login: "未登录",
  cancelled: "已取消",
};

export const PUBLISHER_ACCOUNT_STATUS_LABELS: Record<PublisherAccountStatus, string> = {
  not_logged_in: "未登录",
  checking: "检查中",
  logged_in: "已登录",
  expired: "已过期",
  error: "错误",
};

// ── 发布准备（无账号门禁，按平台创建） ─────────────────────
/** 发布准备目标：按平台，不绑定 PublisherAccount。自动发布时再额外关联 accountId。 */
export interface PublishDraftTarget {
  id: string;
  platform: PublisherPlatform;
  title: string;
  description: string;
  tags: string[];
  thumbnailPath?: string;
  enabled: boolean;
  validationErrors: string[];
  /** 用户手动标记已在该平台发布（不伪装系统检测） */
  manuallyPublished?: boolean;
  manuallyPublishedAt?: string;
  /** 人工确认的发布结果，不代表平台回传。 */
  publishResult?: "published" | "failed";
  publishUrl?: string;
  publishNote?: string;
}

export type PublishPreparationStatus =
  | "draft"
  | "checking"
  | "ready"
  | "exported"
  | "manually_published"
  | "archived";

export interface PublishPreparationMaster {
  title: string;
  description: string;
  tags: string[];
  thumbnailPath?: string;
}

export interface PublishPreparation {
  id: string;
  projectSlug?: string;
  videoPath: string;
  masterContent: PublishPreparationMaster;
  targets: PublishDraftTarget[];
  status: PublishPreparationStatus;
  /** 最近一次导出发布包的目录 */
  exportDir?: string;
  createdAt: string;
  updatedAt: string;
}

export const PUBLISH_PREPARATION_STATUS_LABELS: Record<PublishPreparationStatus, string> = {
  draft: "草稿",
  checking: "检查中",
  ready: "可准备",
  exported: "已导出",
  manually_published: "已手动发布",
  archived: "已归档",
};

/** 发布前检查结果等级 */
export type PreparationCheckLevel = "ready" | "warning" | "blocked";

export interface PreparationTargetCheck {
  targetId: string;
  platform: PublisherPlatform;
  level: PreparationCheckLevel;
  errors: string[];
  warnings: string[];
  coverPresent: boolean;
  accountConfigured: boolean;
}

export interface PreparationCheckResult {
  level: PreparationCheckLevel;
  videoExists: boolean;
  videoFormatValid: boolean;
  videoSizeLabel?: string;
  videoExt?: string;
  targets: PreparationTargetCheck[];
  /** 不同平台仍使用完全相同的空白内容时给出警告 */
  blankDuplicationWarning?: string;
}
