import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../_utils";
import { readPreferences, writePreferences } from "../../../../../src/services/publisherPreferences.js";
import { PUBLISHER_PLATFORMS, type PublisherPlatform } from "../../../../../src/types/publisher.js";
import type { WatchedDirectory } from "../../../../../src/types/publishSession.js";

export const runtime = "nodejs";

function isPlatformArray(value: unknown): value is PublisherPlatform[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && (PUBLISHER_PLATFORMS as readonly string[]).includes(v));
}

function isWatchedDirInput(value: unknown): value is string | WatchedDirectory {
  if (typeof value === "string") return true;
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return typeof rec.path === "string" && (rec.enabled === undefined || typeof rec.enabled === "boolean");
  }
  return false;
}

function isWatchedDirectoryArray(value: unknown): value is Array<string | WatchedDirectory> {
  if (!Array.isArray(value)) return false;
  return value.every(isWatchedDirInput);
}

function normalizeWatchedDirs(value: Array<string | WatchedDirectory>): WatchedDirectory[] {
  const seen = new Set<string>();
  const result: WatchedDirectory[] = [];
  for (const item of value) {
    const p = typeof item === "string" ? item.trim() : item.path.trim();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    result.push({ path: p, enabled: typeof item === "string" ? true : item.enabled !== false });
  }
  return result;
}

export async function GET() {
  try {
    const preferences = await readPreferences();
    return NextResponse.json({ ok: true, success: true, data: { preferences } });
  } catch (error) {
    return apiError(error, "publisher", "预设读取失败。", 500);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await readRequestJson(request);
    const input: {
      enabledPlatforms?: PublisherPlatform[];
      platformOrder?: PublisherPlatform[];
      watchedVideoDirectories?: WatchedDirectory[];
    } = {};
    if (isPlatformArray(body.enabledPlatforms)) input.enabledPlatforms = body.enabledPlatforms;
    if (isPlatformArray(body.platformOrder)) input.platformOrder = body.platformOrder;
    if (isWatchedDirectoryArray(body.watchedVideoDirectories)) {
      input.watchedVideoDirectories = normalizeWatchedDirs(body.watchedVideoDirectories);
    }
    const preferences = await writePreferences(input);
    return NextResponse.json({ ok: true, success: true, data: { preferences } });
  } catch (error) {
    return apiError(error, "publisher", "预设保存失败。", 400);
  }
}
