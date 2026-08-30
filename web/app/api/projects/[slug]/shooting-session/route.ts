import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { writeJsonAtomicPath } from "../../../../../../src/services/atomicJson";
import { resolveProjectDirectory } from "../../../../../../src/services/projectManager";
import { apiError, readRequestJson } from "../../../_utils";

export const runtime = "nodejs";

interface ShootingSession { shotTaskId: string; updatedAt: string; }

async function readProjectMetadata(slug: string): Promise<{ projectDir: string; metadata: Record<string, unknown> }> {
  const projectDir = resolveProjectDirectory(slug);
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8"));
    return { projectDir, metadata: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {} };
  } catch { return { projectDir, metadata: {} }; }
}

function sessionFrom(value: unknown): ShootingSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  return typeof source.shotTaskId === "string" && source.shotTaskId
    ? { shotTaskId: source.shotTaskId, updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "" } : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { metadata } = await readProjectMetadata(slug);
    return NextResponse.json({ ok: true, success: true, session: sessionFrom(metadata.shootingSession) });
  } catch (error) { return apiError(error, "project", "拍摄现场读取失败。", 400); }
}

export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = await readRequestJson(request);
    const shotTaskId = typeof body.shotTaskId === "string" ? body.shotTaskId : "";
    if (!/^shot-\d+$/u.test(shotTaskId)) throw new Error("镜头标识无效。");
    const { projectDir, metadata } = await readProjectMetadata(slug);
    const session = { shotTaskId, updatedAt: new Date().toISOString() };
    await writeJsonAtomicPath(path.join(projectDir, "project.json"), { ...metadata, shootingSession: session });
    return NextResponse.json({ ok: true, success: true, session });
  } catch (error) { return apiError(error, "project", "拍摄现场保存失败。", 400); }
}
