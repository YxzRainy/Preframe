import "dotenv/config";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomicPath } from "./atomicJson.js";

export type ModelProvider =
  | "deepseek"
  | "openai"
  | "anthropic"
  | "gemini"
  | "moonshot"
  | "qwen"
  | "openrouter"
  | "custom";

export type ModelThinkingMode = "disabled" | "low" | "high" | "max";

export interface ModelConfig {
  provider: ModelProvider;
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  thinkingMode: ModelThinkingMode;
}

export interface PublicModelConfig {
  provider: ModelProvider;
  providerLabel: string;
  baseURL: string;
  model: string;
  temperature: number;
  maxTokens: number;
  thinkingMode: ModelThinkingMode;
  maskedApiKey: string;
  configured: boolean;
  source: "file" | "env" | "default";
}

export type ModelFailureKind = "timeout" | "rate_limit" | "server" | "length" | "auth" | "config" | "cancelled" | "unknown";

export interface ModelResponseMetrics {
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface CallModelOptions {
  signal?: AbortSignal;
  onMetrics?: (metrics: ModelResponseMetrics) => void;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null | Array<{ type?: string; text?: string }> }; finish_reason?: string | null }>;
  error?: { message?: string; type?: string; code?: string };
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

type ChatCompletionContent = string | null | Array<{ type?: string; text?: string }>;

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string; type?: string };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  error?: { message?: string; status?: string };
}

export class ModelClientError extends Error {
  kind: ModelFailureKind;
  status?: number;

  constructor(message: string, options?: ErrorOptions & { kind?: ModelFailureKind; status?: number }) {
    super(message, options);
    this.name = "ModelClientError";
    this.kind = options?.kind || "unknown";
    this.status = options?.status;
  }
}

export function modelFailureKind(error: unknown): ModelFailureKind {
  if (error instanceof ModelClientError) return error.kind;
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|超时/iu.test(message)) return "timeout";
  if (/429|rate.?limit|请求过于频繁/iu.test(message)) return "rate_limit";
  if (/\b5\d\d\b|server error|服务暂时不可用/iu.test(message)) return "server";
  if (/finish_reason.?=.?length|输出预算不足|max.?tokens/iu.test(message)) return "length";
  if (/401|403|unauthorized|forbidden|api.?key/iu.test(message)) return "auth";
  return "unknown";
}

const CONFIG_DIR = ".piance";
const CONFIG_FILE = "model-config.json";

const PROVIDER_LABELS: Record<ModelProvider, string> = {
  deepseek: "DeepSeek",
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
  gemini: "Google Gemini",
  moonshot: "Moonshot / Kimi",
  qwen: "Qwen / 通义千问",
  openrouter: "OpenRouter",
  custom: "自定义 OpenAI Compatible",
};

const PROVIDER_DEFAULTS: Record<ModelProvider, Omit<ModelConfig, "apiKey">> = {
  deepseek: { provider: "deepseek", baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat", temperature: 0.7, maxTokens: 4096, thinkingMode: "low" },
  openai: { provider: "openai", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini", temperature: 0.7, maxTokens: 4096, thinkingMode: "disabled" },
  anthropic: { provider: "anthropic", baseURL: "https://api.anthropic.com/v1", model: "claude-3-5-sonnet-latest", temperature: 0.7, maxTokens: 4096, thinkingMode: "disabled" },
  gemini: { provider: "gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-1.5-flash", temperature: 0.7, maxTokens: 4096, thinkingMode: "disabled" },
  moonshot: { provider: "moonshot", baseURL: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", temperature: 0.7, maxTokens: 4096, thinkingMode: "disabled" },
  qwen: { provider: "qwen", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", temperature: 0.7, maxTokens: 4096, thinkingMode: "disabled" },
  openrouter: { provider: "openrouter", baseURL: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", temperature: 0.7, maxTokens: 4096, thinkingMode: "disabled" },
  custom: { provider: "custom", baseURL: "https://api.example.com/v1", model: "your-model-name", temperature: 0.7, maxTokens: 4096, thinkingMode: "disabled" },
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function preview(raw: string): string {
  return raw.slice(0, 300).replace(/\s+/gu, " ").trim();
}

function failureKindForStatus(status: number): ModelFailureKind {
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  if (status === 401 || status === 403) return "auth";
  return "unknown";
}

function repoRoot(): string {
  return process.cwd();
}

export function modelConfigPath(): string {
  return path.join(repoRoot(), CONFIG_DIR, CONFIG_FILE);
}

function isProvider(value: unknown): value is ModelProvider {
  return typeof value === "string" && value in PROVIDER_DEFAULTS;
}

function numericSetting(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function stringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function thinkingModeSetting(value: unknown, fallback: ModelThinkingMode): ModelThinkingMode {
  return value === "disabled" || value === "low" || value === "high" || value === "max" ? value : fallback;
}

export function providerDefaults(provider: ModelProvider): Omit<ModelConfig, "apiKey"> {
  return { ...PROVIDER_DEFAULTS[provider] };
}

export function providerOptions() {
  return (Object.keys(PROVIDER_DEFAULTS) as ModelProvider[]).map((provider) => ({
    value: provider,
    label: PROVIDER_LABELS[provider],
    defaults: providerDefaults(provider),
  }));
}

function normalizeConfig(value: Record<string, unknown>, existingApiKey = ""): ModelConfig {
  const provider = isProvider(value.provider) ? value.provider : "deepseek";
  const defaults = PROVIDER_DEFAULTS[provider];
  const apiKey = stringSetting(value.apiKey, existingApiKey);
  return {
    provider,
    baseURL: trimTrailingSlash(stringSetting(value.baseURL, defaults.baseURL)),
    apiKey,
    model: stringSetting(value.model, defaults.model),
    temperature: numericSetting(value.temperature, defaults.temperature, 0, 2),
    maxTokens: Math.round(numericSetting(value.maxTokens, defaults.maxTokens, 256, 200000)),
    thinkingMode: thinkingModeSetting(value.thinkingMode, defaults.thinkingMode),
  };
}

function validateConfig(config: ModelConfig): void {
  if (!config.baseURL) throw new ModelClientError("Base URL 不能为空。", { kind: "config" });
  if (!/^https?:\/\//u.test(config.baseURL)) throw new ModelClientError("Base URL 必须以 http:// 或 https:// 开头。", { kind: "config" });
  let parsedUrl: URL;
  try { parsedUrl = new URL(config.baseURL); } catch { throw new ModelClientError("Base URL 不是合法网址。", { kind: "config" }); }
  if (parsedUrl.username || parsedUrl.password) throw new ModelClientError("Base URL 不能包含账号或密码。", { kind: "config" });
  if (!parsedUrl.hostname) throw new ModelClientError("Base URL 缺少主机名。", { kind: "config" });
  if (!config.apiKey) throw new ModelClientError("API Key 不能为空。", { kind: "config" });
  if (/^(?:your[-_ ]?api[-_ ]?key|sk-\.\.\.|__PREFRAME_REDACTED__)$/iu.test(config.apiKey)) throw new ModelClientError("API Key 仍是占位值，请填写真实密钥。", { kind: "config" });
  if (!config.model) throw new ModelClientError("模型名称不能为空。", { kind: "config" });
}

export function validateModelConfigInput(input: Record<string, unknown>, existingApiKey = ""): void {
  if (!isProvider(input.provider)) throw new ModelClientError("模型服务商无效。");
  if (typeof input.baseURL !== "string" || !input.baseURL.trim()) throw new ModelClientError("Base URL 不能为空。");
  if (typeof input.model !== "string" || !input.model.trim()) throw new ModelClientError("模型名称不能为空。");
  const temperature = typeof input.temperature === "number" ? input.temperature : Number(input.temperature);
  const maxTokens = typeof input.maxTokens === "number" ? input.maxTokens : Number(input.maxTokens);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new ModelClientError("Temperature 必须在 0 到 2 之间。");
  if (!Number.isFinite(maxTokens) || maxTokens < 256 || maxTokens > 200000) throw new ModelClientError("Max Tokens 必须在 256 到 200000 之间。");
  if (input.thinkingMode !== undefined && !["disabled", "low", "high", "max"].includes(String(input.thinkingMode))) throw new ModelClientError("思考强度必须是 disabled、low、high 或 max。");
  validateConfig(normalizeConfig(input, existingApiKey));
}

export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 10) return `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 6)}••••••${trimmed.slice(-4)}`;
}

async function readFileConfig(): Promise<ModelConfig | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(modelConfigPath(), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const config = normalizeConfig(parsed as Record<string, unknown>);
    validateConfig(config);
    return config;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
}

function envConfig(): ModelConfig | null {
  const provider = isProvider(process.env.MODEL_PROVIDER) ? process.env.MODEL_PROVIDER : "deepseek";
  const genericKey = process.env.MODEL_API_KEY?.trim();
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  const apiKey = genericKey || (provider === "deepseek" ? deepseekKey : "");
  if (!apiKey) return null;
  const defaults = PROVIDER_DEFAULTS[provider];
  return normalizeConfig({
    provider,
    baseURL: process.env.MODEL_BASE_URL || process.env.DEEPSEEK_BASE_URL || defaults.baseURL,
    apiKey,
    model: process.env.MODEL_NAME || process.env.MODEL_MODEL || process.env.DEEPSEEK_MODEL || defaults.model,
    temperature: process.env.MODEL_TEMPERATURE || defaults.temperature,
    maxTokens: process.env.MODEL_MAX_TOKENS || defaults.maxTokens,
    thinkingMode: process.env.MODEL_THINKING_MODE || defaults.thinkingMode,
  });
}

function defaultConfig(): ModelConfig {
  return { ...PROVIDER_DEFAULTS.deepseek, apiKey: process.env.DEEPSEEK_API_KEY?.trim() || "" };
}

export async function loadModelConfig(): Promise<ModelConfig & { source: "file" | "env" | "default" }> {
  const fileConfig = await readFileConfig();
  if (fileConfig) return { ...fileConfig, source: "file" };
  const fromEnv = envConfig();
  if (fromEnv) return { ...fromEnv, source: "env" };
  return { ...defaultConfig(), source: "default" };
}

export async function saveModelConfig(input: Record<string, unknown>): Promise<PublicModelConfig> {
  const existing = await readFileConfig().catch(() => null);
  validateModelConfigInput(input, existing?.apiKey || "");
  const config = normalizeConfig(input, existing?.apiKey || "");
  validateConfig(config);
  await writeJsonAtomicPath(modelConfigPath(), config);
  return publicModelConfig({ ...config, source: "file" }, true);
}

export async function resetModelConfig(): Promise<PublicModelConfig> {
  await rm(modelConfigPath(), { force: true });
  return publicModelConfig(await loadModelConfig());
}

export function publicModelConfig(config: ModelConfig & { source: "file" | "env" | "default" }, forceConfigured?: boolean): PublicModelConfig {
  return {
    provider: config.provider,
    providerLabel: PROVIDER_LABELS[config.provider],
    baseURL: config.baseURL,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    thinkingMode: config.thinkingMode,
    maskedApiKey: maskApiKey(config.apiKey),
    configured: forceConfigured ?? Boolean(config.apiKey && config.source !== "default"),
    source: config.source,
  };
}

function sanitizeModelError(message: string): string {
  if (/api\s*key|unauthorized|forbidden|invalid.*key|401|403|base\s*url|model/i.test(message)) {
    return "模型连接失败，请检查 API Key、Base URL 或模型名称。";
  }
  return message || "模型连接失败，请检查 API Key、Base URL 或模型名称。";
}

function requestMaxTokens(config: ModelConfig): number {
  // Reasoning-heavy DeepSeek models spend part of max_tokens on hidden
  // reasoning. A 4096-token budget can therefore end with no visible answer.
  return /deepseek-v4-pro|deepseek-reasoner/iu.test(config.model)
    ? Math.max(config.maxTokens, 8192)
    : config.maxTokens;
}

function isDeepSeekThinkingModel(config: ModelConfig): boolean {
  return config.provider === "deepseek" && /deepseek-v4-(?:flash|pro)|deepseek-reasoner/iu.test(config.model);
}

function requestTimeoutMs(config: ModelConfig): number {
  return isDeepSeekThinkingModel(config) ? 180_000 : 60_000;
}

export function combineModelRequestSignal(externalSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!externalSignal) return timeoutSignal;
  const abortSignalWithAny = AbortSignal as typeof AbortSignal & { any?: (signals: AbortSignal[]) => AbortSignal };
  if (abortSignalWithAny.any) return abortSignalWithAny.any([externalSignal, timeoutSignal]);

  const controller = new AbortController();
  const forwardAbort = (source: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  const onExternalAbort = () => forwardAbort(externalSignal);
  const onTimeout = () => forwardAbort(timeoutSignal);
  externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  timeoutSignal.addEventListener("abort", onTimeout, { once: true });
  controller.signal.addEventListener("abort", () => {
    externalSignal.removeEventListener("abort", onExternalAbort);
    timeoutSignal.removeEventListener("abort", onTimeout);
  }, { once: true });
  if (externalSignal.aborted) forwardAbort(externalSignal);
  return controller.signal;
}

function contentText(value: ChatCompletionContent | undefined): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.map((part) => typeof part?.text === "string" ? part.text : "").join("").trim();
}

async function readJsonPayload<T>(response: Response, endpoint: string, model: string): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ModelClientError(
      `模型接口返回了非 JSON 内容（HTTP ${response.status}，content-type: ${contentType || "未返回"}，endpoint: ${endpoint}，model: ${model}）。原始返回前 300 字符：${preview(raw)}`,
      { kind: failureKindForStatus(response.status), status: response.status },
    );
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new ModelClientError(
      `模型接口返回了无效 JSON（HTTP ${response.status}，content-type: ${contentType || "未返回"}，endpoint: ${endpoint}，model: ${model}）。原始返回前 300 字符：${preview(raw)}`,
      { cause: error, kind: failureKindForStatus(response.status), status: response.status },
    );
  }
}

function endpointForOpenAICompatible(config: ModelConfig): string {
  return `${trimTrailingSlash(config.baseURL)}/chat/completions`;
}

async function callOpenAICompatible(config: ModelConfig, prompt: string, options: CallModelOptions): Promise<string> {
  const endpoint = endpointForOpenAICompatible(config);
  const thinkingModel = isDeepSeekThinkingModel(config);
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      {
        role: "system",
        content: "你是一个短视频内容策划助手，输出结构清晰、可直接用于拍摄准备。",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: requestMaxTokens(config),
  };
  if (thinkingModel) {
    body.thinking = { type: config.thinkingMode === "disabled" ? "disabled" : "enabled" };
    if (config.thinkingMode !== "disabled") body.reasoning_effort = config.thinkingMode;
  }
  if (!thinkingModel || config.thinkingMode === "disabled") body.temperature = config.temperature;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const payload = await readJsonPayload<ChatCompletionResponse>(response, endpoint, config.model);
  if (!response.ok) {
    const kind = failureKindForStatus(response.status);
    throw new ModelClientError(payload.error?.message || `模型接口请求失败，状态码 ${response.status}`, { kind, status: response.status });
  }
  const choice = payload.choices?.[0];
  options.onMetrics?.({
    finishReason: choice?.finish_reason || undefined,
    promptTokens: payload.usage?.prompt_tokens,
    completionTokens: payload.usage?.completion_tokens,
    totalTokens: payload.usage?.total_tokens,
  });
  const content = contentText(choice?.message?.content);
  if (choice?.finish_reason === "length") {
    throw new ModelClientError("模型输出预算不足，请稍后重试或提高 Max Tokens。", { kind: "length" });
  }
  if (!content) {
    const reason = choice?.finish_reason === "length" ? "模型输出预算不足" : "模型返回为空";
    throw new ModelClientError(`${reason}，请稍后重试或提高 Max Tokens。`, { kind: choice?.finish_reason === "length" ? "length" : "unknown" });
  }
  return content;
}

async function callAnthropic(config: ModelConfig, prompt: string, options: CallModelOptions): Promise<string> {
  const endpoint = `${trimTrailingSlash(config.baseURL)}/messages`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: "你是一个短视频内容策划助手，输出结构清晰、可直接用于拍摄准备。",
      messages: [{ role: "user", content: prompt }],
    }),
    signal: options.signal,
  });
  const payload = await readJsonPayload<AnthropicResponse>(response, endpoint, config.model);
  if (!response.ok) throw new ModelClientError(payload.error?.message || `模型接口请求失败，状态码 ${response.status}`, { kind: failureKindForStatus(response.status), status: response.status });
  options.onMetrics?.({
    finishReason: payload.stop_reason || undefined,
    promptTokens: payload.usage?.input_tokens,
    completionTokens: payload.usage?.output_tokens,
    totalTokens: typeof payload.usage?.input_tokens === "number" && typeof payload.usage?.output_tokens === "number"
      ? payload.usage.input_tokens + payload.usage.output_tokens
      : undefined,
  });
  if (payload.stop_reason === "max_tokens") {
    throw new ModelClientError("模型输出预算不足，请稍后重试或提高 Max Tokens。", { kind: "length" });
  }
  const content = payload.content?.map((part) => part.text || "").join("").trim();
  if (!content) throw new ModelClientError("模型返回为空，请稍后重试或检查模型配置。");
  return content;
}

async function callGemini(config: ModelConfig, prompt: string, options: CallModelOptions): Promise<string> {
  const endpoint = `${trimTrailingSlash(config.baseURL)}/models/${encodeURIComponent(config.model)}:generateContent`;
  // API Key 通过请求头传递，不写入 URL，避免进入服务端日志
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-goog-api-key": config.apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `你是一个短视频内容策划助手，输出结构清晰、可直接用于拍摄准备。\n\n${prompt}` }] }],
      generationConfig: {
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
      },
    }),
    signal: options.signal,
  });
  const payload = await readJsonPayload<GeminiResponse>(response, endpoint, config.model);
  if (!response.ok) throw new ModelClientError(payload.error?.message || `模型接口请求失败，状态码 ${response.status}`, { kind: failureKindForStatus(response.status), status: response.status });
  options.onMetrics?.({
    finishReason: payload.candidates?.[0]?.finishReason,
    promptTokens: payload.usageMetadata?.promptTokenCount,
    completionTokens: payload.usageMetadata?.candidatesTokenCount,
    totalTokens: payload.usageMetadata?.totalTokenCount,
  });
  if (payload.candidates?.[0]?.finishReason === "MAX_TOKENS") {
    throw new ModelClientError("模型输出预算不足，请稍后重试或提高 Max Tokens。", { kind: "length" });
  }
  const content = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!content) throw new ModelClientError("模型返回为空，请稍后重试或检查模型配置。");
  return content;
}

export function createModelClient(config: ModelConfig) {
  validateConfig(config);
  return {
    callChatModel(prompt: string, options: CallModelOptions = {}) {
      const effectiveOptions = { ...options, signal: combineModelRequestSignal(options.signal, requestTimeoutMs(config)) };
      if (config.provider === "anthropic") return callAnthropic(config, prompt, effectiveOptions);
      if (config.provider === "gemini") return callGemini(config, prompt, effectiveOptions);
      return callOpenAICompatible(config, prompt, effectiveOptions);
    },
  };
}

export async function callChatModel(prompt: string, options: CallModelOptions = {}): Promise<string> {
  try {
    const config = await loadModelConfig();
    return await createModelClient(config).callChatModel(prompt, options);
  } catch (error) {
    if (error instanceof ModelClientError) {
      throw new ModelClientError(sanitizeModelError(error.message), { cause: error, kind: error.kind, status: error.status });
    }
    const kind = modelFailureKind(error);
    const message = kind === "timeout" ? "模型请求超时。" : kind === "cancelled" ? "模型请求已取消。" : "模型连接失败，请检查 API Key、Base URL 或模型名称。";
    throw new ModelClientError(message, { cause: error, kind });
  }
}

export async function callModel(prompt: string, options: CallModelOptions = {}): Promise<string> {
  return callChatModel(prompt, options);
}

export async function testModelConnection(configInput?: Record<string, unknown>): Promise<{ ok: true; message: string; config: PublicModelConfig }> {
  const existing = (await readFileConfig().catch(() => null))?.apiKey || "";
  if (configInput) validateModelConfigInput(configInput, existing);
  const config = configInput
    ? { ...normalizeConfig(configInput, existing), source: "file" as const }
    : await loadModelConfig();
  validateConfig(config);
  try {
    await createModelClient(config).callChatModel("请只回复 OK。", {});
    return { ok: true, message: "连接成功", config: publicModelConfig(config, Boolean(config.apiKey)) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ModelClientError(sanitizeModelError(detail), { cause: error });
  }
}

export async function currentPublicModelConfig(): Promise<PublicModelConfig> {
  return publicModelConfig(await loadModelConfig());
}
