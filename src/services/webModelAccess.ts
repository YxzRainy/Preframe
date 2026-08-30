import {
  modelConfigFromInput,
  modelFailureKind,
  type ModelConfig,
  type PublicModelConfig,
  withModelConfig,
} from "./modelClient.js";

export const WEB_MODEL_NAME = "deepseek-v4-flash";
const DEEPSEEK_PUBLIC_BASE_URL = "https://api.deepseek.com/v1";

export interface WebModelAccess {
  config: ModelConfig;
  source: "env";
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
    maxTokens: 8192,
    thinkingMode: "low",
  });
}

export function publicWebModelConfig(): PublicModelConfig {
  const configured = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
  return {
    provider: "deepseek",
    providerLabel: "DeepSeek",
    baseURL: defaultBaseUrl(),
    model: WEB_MODEL_NAME,
    temperature: 0.7,
    maxTokens: 8192,
    thinkingMode: "low",
    maskedApiKey: "",
    configured,
    source: configured ? "env" : "default",
  };
}

export function getWebModelAccess(_body: Record<string, unknown> = {}): WebModelAccess {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim() || "";
  if (!apiKey) {
    throw new WebModelAccessError(
      "本机尚未配置 DeepSeek API Key，请在模型设置中保存到项目 .env 文件。",
      503,
      "DEFAULT_MODEL_UNAVAILABLE",
    );
  }
  return {
    config: createDeepSeekFlashConfig(apiKey, defaultBaseUrl()),
    source: "env",
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
  body: Record<string, unknown>,
  task: (access: WebModelAccess) => Promise<T>,
): Promise<T> {
  const access = getWebModelAccess(body);
  try {
    return await withModelConfig(access.config, () => task(access));
  } catch (error) {
    const unavailable = containsModelFailure(error, new Set(["auth", "config", "rate_limit", "server", "timeout"]));
    if (!unavailable) throw error;
    throw new WebModelAccessError(
      "本机 .env 中的 DeepSeek API Key 当前不可用，请检查密钥或稍后重试。",
      400,
      "CUSTOM_MODEL_UNAVAILABLE",
      { cause: error },
    );
  }
}
