import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "./runtimePaths.js";

export interface AccountMemory {
  accountName: string;
  platform: string;
  niche: string;
  targetAudience: string;
  tone: string;
  bannedWords: string;
  preferredHooks: string;
  shootingDevice: string;
  shootingScenes: string;
  creatorPersona: string;
  contentBoundaries: string;
  successfulTopics: string;
  failedTopics: string;
  notes: string;
}

export interface AccountMemorySnapshot {
  accountName: string;
  platform: string;
  niche: string;
  tone: string;
  creatorPersona: string;
}

const CONFIG_FILE = "account-memory.json";
const FIELD_LIMIT = 4000;
const SNAPSHOT_LIMIT = 240;

const FIELD_LABELS: Array<[keyof AccountMemory, string]> = [
  ["accountName", "账号名"],
  ["platform", "主要平台"],
  ["niche", "内容领域"],
  ["targetAudience", "目标用户"],
  ["tone", "常用语气"],
  ["bannedWords", "禁用词"],
  ["preferredHooks", "常用开头风格"],
  ["shootingDevice", "拍摄设备"],
  ["shootingScenes", "常用拍摄场景"],
  ["creatorPersona", "人设定位"],
  ["contentBoundaries", "内容边界"],
  ["successfulTopics", "有效选题"],
  ["failedTopics", "无效选题"],
  ["notes", "补充说明"],
];

export const EMPTY_ACCOUNT_MEMORY: AccountMemory = {
  accountName: "",
  platform: "",
  niche: "",
  targetAudience: "",
  tone: "",
  bannedWords: "",
  preferredHooks: "",
  shootingDevice: "",
  shootingScenes: "",
  creatorPersona: "",
  contentBoundaries: "",
  successfulTopics: "",
  failedTopics: "",
  notes: "",
};

export function accountMemoryPath(): string {
  return path.join(getDataDir(), CONFIG_FILE);
}

function sanitizeText(value: unknown, limit = FIELD_LIMIT): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .replace(/\b(?:sk|sess|xox[baprs])-[A-Za-z0-9_-]{12,}\b/gu, "[已移除密钥]")
    .replace(/\b(api[_ -]?key|token|secret|access[_ -]?token|refresh[_ -]?token)\b\s*[:=：]\s*\S+/giu, "$1: [已移除]")
    .trim()
    .slice(0, limit);
}

function normalizeAccountMemory(value: unknown): AccountMemory {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return FIELD_LABELS.reduce<AccountMemory>((memory, [key]) => {
    memory[key] = sanitizeText(source[key]);
    return memory;
  }, { ...EMPTY_ACCOUNT_MEMORY });
}

export function accountMemoryHasContent(memory: AccountMemory): boolean {
  return FIELD_LABELS.some(([key]) => Boolean(memory[key].trim()));
}

export async function getAccountMemory(): Promise<AccountMemory> {
  try {
    const parsed: unknown = JSON.parse(await readFile(accountMemoryPath(), "utf8"));
    return normalizeAccountMemory(parsed);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
      return { ...EMPTY_ACCOUNT_MEMORY };
    }
    throw error;
  }
}

export async function saveAccountMemory(input: unknown): Promise<AccountMemory> {
  const memory = normalizeAccountMemory(input);
  await mkdir(path.dirname(accountMemoryPath()), { recursive: true });
  await writeFile(accountMemoryPath(), `${JSON.stringify(memory, null, 2)}\n`, "utf8");
  return memory;
}

export async function hasAccountMemory(): Promise<boolean> {
  return accountMemoryHasContent(await getAccountMemory());
}

export function sanitizeAccountMemoryForPrompt(memory: AccountMemory): string {
  const lines = FIELD_LABELS
    .map(([key, label]) => {
      const value = sanitizeText(memory[key]);
      return value ? `- ${label}：${value}` : "";
    })
    .filter(Boolean);

  if (!lines.length) return "";
  return `账号记忆：
${lines.join("\n")}`;
}

export function accountMemorySnapshot(memory: AccountMemory): AccountMemorySnapshot {
  return {
    accountName: sanitizeText(memory.accountName, SNAPSHOT_LIMIT),
    platform: sanitizeText(memory.platform, SNAPSHOT_LIMIT),
    niche: sanitizeText(memory.niche, SNAPSHOT_LIMIT),
    tone: sanitizeText(memory.tone, SNAPSHOT_LIMIT),
    creatorPersona: sanitizeText(memory.creatorPersona, SNAPSHOT_LIMIT),
  };
}
