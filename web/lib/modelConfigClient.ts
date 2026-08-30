const LEGACY_BROWSER_KEY = "piance:deepseek-api-key:v1";

export function clearLegacyBrowserApiKey(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(LEGACY_BROWSER_KEY); } catch { /* localStorage may be unavailable */ }
}

const MODEL_CONFIGURATION_ERROR_CODES = new Set(["DEFAULT_MODEL_UNAVAILABLE", "CUSTOM_MODEL_UNAVAILABLE"]);

export function promptForModelConfig(errorCode: unknown): boolean {
  if (typeof errorCode !== "string" || !MODEL_CONFIGURATION_ERROR_CODES.has(errorCode)) return false;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("piance-open-model-config"));
  return true;
}
