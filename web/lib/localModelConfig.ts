export const LOCAL_MODEL_CONFIG_STORAGE_KEY = "piance:deepseek-api-key:v1";

export interface LocalModelConfig {
  apiKey: string;
}

function normalizeApiKey(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readLocalModelConfig(): LocalModelConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const apiKey = normalizeApiKey(window.localStorage.getItem(LOCAL_MODEL_CONFIG_STORAGE_KEY));
    return apiKey ? { apiKey } : null;
  } catch {
    return null;
  }
}

export function saveLocalModelConfig(apiKey: string): LocalModelConfig {
  const normalized = normalizeApiKey(apiKey);
  if (!normalized || /^(?:your[-_ ]?api[-_ ]?key|sk-\.\.\.)$/iu.test(normalized)) {
    throw new Error("请填写真实的 DeepSeek API Key。");
  }
  window.localStorage.setItem(LOCAL_MODEL_CONFIG_STORAGE_KEY, normalized);
  return { apiKey: normalized };
}

export function clearLocalModelConfig(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LOCAL_MODEL_CONFIG_STORAGE_KEY);
}

export function maskLocalApiKey(apiKey: string): string {
  const value = apiKey.trim();
  if (!value) return "";
  if (value.length <= 10) return `${value.slice(0, 2)}••••${value.slice(-2)}`;
  return `${value.slice(0, 6)}••••••${value.slice(-4)}`;
}

export function withLocalModelConfig<T extends Record<string, unknown>>(payload: T): T & { modelConfig?: LocalModelConfig } {
  const modelConfig = readLocalModelConfig();
  return modelConfig ? { ...payload, modelConfig } : payload;
}

const MODEL_CONFIGURATION_ERROR_CODES = new Set(["DEFAULT_MODEL_UNAVAILABLE", "CUSTOM_MODEL_UNAVAILABLE"]);

export function promptForModelConfig(errorCode: unknown): boolean {
  if (typeof errorCode !== "string" || !MODEL_CONFIGURATION_ERROR_CODES.has(errorCode)) return false;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("piance-open-model-config"));
  return true;
}
