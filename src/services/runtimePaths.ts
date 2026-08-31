import os from "node:os";
import path from "node:path";

function isServerlessRuntime(): boolean {
  return Boolean(process.env.NETLIFY || process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/** Writable storage root. Serverless hosts only expose a writable temporary directory. */
export function getDataDir(): string {
  if (process.env.PIANCE_DATA_DIR?.trim()) return path.resolve(process.env.PIANCE_DATA_DIR);
  return isServerlessRuntime() ? path.join(os.tmpdir(), "piance") : path.resolve(process.cwd(), ".piance");
}

/** Default project-output root, overridable with PIANCE_OUTPUT_DIR. */
export function getDefaultOutputDir(): string {
  return isServerlessRuntime() ? path.join(getDataDir(), "output") : path.resolve(process.cwd(), "output");
}

/** The .env path belongs beside local app data when the deploy bundle is read-only. */
export function getDefaultEnvPath(): string {
  return isServerlessRuntime() ? path.join(getDataDir(), ".env") : path.resolve(process.cwd(), ".env");
}

export function usesEphemeralStorage(): boolean {
  return isServerlessRuntime();
}

export function usesEphemeralEnvFile(): boolean {
  return isServerlessRuntime();
}
