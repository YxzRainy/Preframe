/** 工作台共享类型 — 与后端 dashboard API 对齐 */

export type ProjectStage =
  | "idea"
  | "planning"
  | "ready_to_shoot"
  | "shooting"
  | "editing"
  | "ready_to_publish"
  | "published"
  | "archived";

export const PROJECT_STAGE_LABELS: Record<ProjectStage, string> = {
  idea: "灵感",
  planning: "策划中",
  ready_to_shoot: "待拍摄",
  shooting: "拍摄中",
  editing: "剪辑中",
  ready_to_publish: "待发布",
  published: "已发布",
  archived: "已归档",
};

export const PROJECT_STAGE_ORDER: ProjectStage[] = [
  "idea",
  "planning",
  "ready_to_shoot",
  "shooting",
  "editing",
  "ready_to_publish",
  "published",
  "archived",
];

export const PROJECT_STAGE_COLORS: Record<ProjectStage, string> = {
  idea: "var(--text-tertiary)",
  planning: "var(--accent)",
  ready_to_shoot: "var(--warning)",
  shooting: "var(--warning)",
  editing: "#c084fc",
  ready_to_publish: "#38bdf8",
  published: "var(--success)",
  archived: "var(--text-muted)",
};

export interface DashboardProject {
  slug: string;
  name: string;
  platform: string;
  stage: ProjectStage;
  stageLabel: string;
  stageUpdatedAt: string;
  nextAction?: string;
  documentCompleted: number;
  documentTotal: number;
  shotCompleted: number;
  shotTotal: number;
  updatedAt: string;
}

export interface DashboardData {
  pipeline: Record<ProjectStage, number>;
  projects: DashboardProject[];
  total: number;
  outputDir: string;
}

export interface Idea {
  id: string;
  title: string;
  note?: string;
  source?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  convertedProjectSlug?: string;
}

export interface WeatherInfo {
  temperature?: number;
  code: number;
  label: string;
  icon: string;
  windSpeed?: number;
  humidity?: number;
  location?: string;
}

export function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(t).toLocaleDateString("zh-CN");
}
