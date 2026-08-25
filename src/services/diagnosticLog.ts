import { appendFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface DiagnosticEntry {
  id: string;
  timestamp: string;
  stage: string;
  message: string;
  stack?: string;
}

const MAX_ENTRIES = 200;

function dataDir(): string {
  return process.env.PIANCE_DATA_DIR?.trim() ? path.resolve(process.env.PIANCE_DATA_DIR) : path.resolve(process.cwd(), ".piance");
}

function logPath(): string {
  return path.join(dataDir(), "diagnostics.jsonl");
}

export function redactDiagnosticText(value: string): string {
  return value
    .replace(/(api[-_ ]?key\s*[:=]\s*)[^\s,;]+/giu, "$1[REDACTED]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/giu, "$1[REDACTED]")
    .replace(/\b(?:sk|key)-[a-z0-9_-]{8,}\b/giu, "[REDACTED]");
}

export async function recordDiagnostic(error: unknown, stage: string): Promise<string> {
  const id = `diag_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
  const source = error instanceof Error ? error : new Error(String(error));
  const entry: DiagnosticEntry = {
    id,
    timestamp: new Date().toISOString(),
    stage,
    message: redactDiagnosticText(source.message || "未知错误"),
    stack: source.stack ? redactDiagnosticText(source.stack).split("\n").slice(0, 12).join("\n") : undefined,
  };
  await mkdir(dataDir(), { recursive: true });
  await appendFile(logPath(), `${JSON.stringify(entry)}\n`, "utf8");
  try {
    if ((await stat(logPath())).size > 2 * 1024 * 1024) {
      const recent = await listDiagnostics(MAX_ENTRIES);
      await writeFile(logPath(), recent.reverse().map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
    }
  } catch { /* logging must never replace the original application error */ }
  return id;
}

export async function listDiagnostics(limit = 50): Promise<DiagnosticEntry[]> {
  try {
    const raw = await readFile(logPath(), "utf8");
    const entries = raw.split("\n").filter(Boolean).flatMap((line) => {
      try {
        const value = JSON.parse(line) as DiagnosticEntry;
        return value && typeof value.id === "string" ? [value] : [];
      } catch {
        return [];
      }
    });
    return entries.slice(-Math.min(Math.max(limit, 1), MAX_ENTRIES)).reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function clearDiagnostics(): Promise<void> {
  await rm(logPath(), { force: true });
}
