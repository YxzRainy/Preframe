import {
  modelConfigFromInput,
  modelFailureKind,
  type ModelConfig,
  type PublicModelConfig,
  withModelConfig,
} from "./modelClient.js";

export const WEB_MODEL_NAME = "deepseek-v4-flash";
export const WEB_MODEL_MAX_TOKENS = 32768;
const DEEPSEEK_PUBLIC_BASE_URL = "https://api.deepseek.com/v1";
export const WEB_MODEL_COOKIE = "piance-model-key";

export interface WebModelAccess {
  config: ModelConfig;
  source: "env" | "cookie";
}

export class WebModelAccessError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WebModelAccessError";
    this.status = status;
    this.code = code;
  }
}

function defaultBaseUrl(): string {
  return process.env.DEEPSEEK_BASE_URL?.trim() || DEEPSEEK_PUBLIC_BASE_URL;
}

function createDeepSeekFlashConfig(apiKey: string, baseURL: string): ModelConfig {
  return modelConfigFromInput({
    provider: "deepseek",
    baseURL,
    apiKey,
    model: WEB_MODEL_NAME,
    temperature: 0.7,
    maxTokens: WEB_MODEL_MAX_TOKENS,
    thinkingMode: "low",
  });
}

function cookieValue(request: Request | undefined, name: string): string {
  const header = request?.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== name) continue;
    try { return decodeURIComponent(rawValue.join("=")).trim(); } catch { return ""; }
  }
  return "";
}

export function webModelApiKey(request?: Request): { apiKey: string; source: "cookie" | "env" | "default" } {
  const cookieKey = cookieValue(request, WEB_MODEL_COOKIE);
  if (cookieKey) return { apiKey: cookieKey, source: "cookie" };
  const envKey = process.env.DEEPSEEK_API_KEY?.trim() || "";
  if (envKey) return { apiKey: envKey, source: "env" };
  return { apiKey: "", source: "default" };
}

export function publicWebModelConfig(request?: Request, overrideApiKey?: string): PublicModelConfig {
  const selected = overrideApiKey?.trim()
    ? { apiKey: overrideApiKey.trim(), source: "cookie" as const }
    : webModelApiKey(request);
  return {
    provider: "deepseek",
    providerLabel: "DeepSeek",
    baseURL: defaultBaseUrl(),
    model: WEB_MODEL_NAME,
    temperature: 0.7,
    maxTokens: WEB_MODEL_MAX_TOKENS,
    thinkingMode: "low",
    maskedApiKey: "",
    configured: Boolean(selected.apiKey),
    source: selected.source === "default" ? "default" : "request",
  };
}

export function getWebModelAccess(request?: Request): WebModelAccess {
  const selected = webModelApiKey(request);
  if (!selected.apiKey) {
    throw new WebModelAccessError(
      "当前浏览器尚未配置 DeepSeek API Key，请在模型设置中保存你自己的 Key。",
      503,
      "DEFAULT_MODEL_UNAVAILABLE",
    );
  }
  return {
    config: createDeepSeekFlashConfig(selected.apiKey, defaultBaseUrl()),
    source: selected.source === "cookie" ? "cookie" : "env",
  };
}

function containsModelFailure(error: unknown, kinds: Set<string>): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (kinds.has(modelFailureKind(current))) return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

export async function runWithWebModelAccess<T>(
  request: Request,
  task: (access: WebModelAccess) => Promise<T>,
): Promise<T> {
  const access = getWebModelAccess(request);
  try {
    return await withModelConfig(access.config, () => task(access));
  } catch (error) {
    const unavailable = containsModelFailure(error, new Set(["auth", "config", "rate_limit", "server", "timeout"]));
    if (!unavailable) throw error;
    throw new WebModelAccessError(
      "当前浏览器保存的 DeepSeek API Key 不可用，请检查密钥或稍后重试。",
      400,
      "CUSTOM_MODEL_UNAVAILABLE",
      { cause: error },
    );
  }
}
