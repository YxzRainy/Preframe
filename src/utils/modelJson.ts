import { jsonrepair } from "jsonrepair";

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function tryParse(source: string): Record<string, unknown> | null {
  try {
    return asObject(JSON.parse(source));
  } catch {
    return null;
  }
}

function normalizeCommonCharacters(raw: string): string {
  return raw
    .replace(/^\uFEFF/u, "")
    .replace(/[\u201C\u201D]/gu, "\"")
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/\u00A0/gu, " ");
}

export function cleanModelOutput(raw: string): string {
  return raw
    .replace(/^\uFEFF/u, "")
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/giu, "")
    .replace(/```\s*(?:json)?\s*/giu, "")
    .replace(/```/gu, "")
    .replace(/\u00A0/gu, " ")
    .trim();
}

function findBalancedObject(source: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

function objectCandidates(source: string): string[] {
  const candidates: string[] = [];
  for (let start = source.indexOf("{"); start >= 0; start = source.indexOf("{", start + 1)) {
    const candidate = findBalancedObject(source, start);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

/** Parse model JSON through direct, cleaned, balanced-object, then jsonrepair stages. */
export function parseModelJsonObject(raw: string, label: string): Record<string, unknown> {
  const direct = tryParse(raw);
  if (direct) return direct;

  const cleaned = cleanModelOutput(raw);
  const cleanedResult = tryParse(cleaned);
  if (cleanedResult) return cleanedResult;

  // Only normalize smart quotes after trying the wrapper-stripped JSON unchanged.
  // Curly quotes are common prose inside Markdown and must not become unescaped JSON delimiters.
  const normalized = normalizeCommonCharacters(cleaned);
  const normalizedResult = normalized === cleaned ? null : tryParse(normalized);
  if (normalizedResult) return normalizedResult;

  const sources = normalized === cleaned ? [cleaned] : [cleaned, normalized];
  const candidates = sources.flatMap(objectCandidates);
  for (const candidate of candidates) {
    const parsed = tryParse(candidate);
    if (parsed) return parsed;
  }

  for (const candidate of [...candidates, ...sources]) {
    try {
      const repaired = tryParse(jsonrepair(candidate));
      if (repaired) return repaired;
    } catch {
      // Try the next candidate before handing control to the one-time model repair.
    }
  }

  throw new Error(`${label}格式异常，自动解析未成功。`);
}
