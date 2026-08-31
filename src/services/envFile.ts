import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDefaultEnvPath } from "./runtimePaths.js";
const KEY_NAME = "DEEPSEEK_API_KEY";

export function validateDeepSeekApiKey(value: unknown): string {
  const apiKey = typeof value === "string" ? value.trim() : "";
  if (!apiKey || /^(?:your[-_ ]?api[-_ ]?key|sk-\.\.\.)$/iu.test(apiKey)) {
    throw new Error("请填写真实的 DeepSeek API Key。");
  }
  if (apiKey.length > 512 || /[\r\n\0]/u.test(apiKey)) {
    throw new Error("DeepSeek API Key 格式无效。");
  }
  return apiKey;
}

function envPath(): string {
  return process.env.PIANCE_ENV_FILE?.trim() ? path.resolve(process.env.PIANCE_ENV_FILE) : getDefaultEnvPath();
}

async function readEnv(): Promise<string> {
  try {
    return await readFile(envPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function updateEnvValue(source: string, value: string | null): string {
  const lines = source.replace(/\r\n/gu, "\n").split("\n");
  const next: string[] = [];
  let replaced = false;

  for (const line of lines) {
    if (!new RegExp(`^\\s*${KEY_NAME}\\s*=`, "u").test(line)) {
      next.push(line);
      continue;
    }
    if (value !== null && !replaced) {
      next.push(`${KEY_NAME}=${JSON.stringify(value)}`);
      replaced = true;
    }
  }

  if (value !== null && !replaced) {
    while (next.length && !next.at(-1)?.trim()) next.pop();
    if (next.length) next.push("");
    next.push(`${KEY_NAME}=${JSON.stringify(value)}`);
  }

  while (next.length && !next.at(-1)?.trim()) next.pop();
  return next.length ? `${next.join("\n")}\n` : "";
}

async function writeEnv(content: string): Promise<void> {
  const targetPath = envPath();
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, targetPath);
  await chmod(targetPath, 0o600);
}

export function localEnvPath(): string {
  return envPath();
}

export async function saveDeepSeekApiKey(value: unknown): Promise<string> {
  const apiKey = validateDeepSeekApiKey(value);
  await writeEnv(updateEnvValue(await readEnv(), apiKey));
  process.env.DEEPSEEK_API_KEY = apiKey;
  return apiKey;
}

export async function clearDeepSeekApiKey(): Promise<void> {
  await writeEnv(updateEnvValue(await readEnv(), null));
  delete process.env.DEEPSEEK_API_KEY;
}
