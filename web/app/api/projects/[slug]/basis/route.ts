import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { writeJsonAtomicPath } from "../../../../../../src/services/atomicJson";
import { resolveProjectDirectory } from "../../../../../../src/services/projectManager";
import { apiError, readRequestJson } from "../../../_utils";

export const runtime = "nodejs";

export interface ProjectBasisPack {
  viewpoints: string;
  facts: string;
  drafts: string;
  boundaries: string;
  sources: string;
  updatedAt?: string;
}

const EMPTY_BASIS: ProjectBasisPack = { viewpoints: "", facts: "", drafts: "", boundaries: "", sources: "" };

function normalizedBasis(value: unknown): ProjectBasisPack {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_BASIS;
  const source = value as Record<string, unknown>;
  return {
    viewpoints: typeof source.viewpoints === "string" ? source.viewpoints : "",
    facts: typeof source.facts === "string" ? source.facts : "",
    drafts: typeof source.drafts === "string" ? source.drafts : "",
    boundaries: typeof source.boundaries === "string" ? source.boundaries : "",
    sources: typeof source.sources === "string" ? source.sources : "",
    ...(typeof source.updatedAt === "string" ? { updatedAt: source.updatedAt } : {}),
  };
}

async function readMetadata(slug: string): Promise<{ projectDir: string; metadata: Record<string, unknown> }> {
  const projectDir = resolveProjectDirectory(slug);
  try {
    const raw = await readFile(path.join(projectDir, "project.json"), "utf8");
    const data: unknown = JSON.parse(raw);
    return { projectDir, metadata: data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {} };
  } catch {
    return { projectDir, metadata: {} };
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { metadata } = await readMetadata(slug);
    return NextResponse.json({ ok: true, success: true, basis: normalizedBasis(metadata.basisPack) });
  } catch (error) {
    return apiError(error, "project", "项目依据包读取失败。", 400);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = await readRequestJson(request);
    const basis = normalizedBasis(body.basis);
    for (const value of [basis.viewpoints, basis.facts, basis.drafts, basis.boundaries, basis.sources]) {
      if (value.length > 40_000) throw new Error("单项依据不能超过 40,000 字符。");
    }
    const { projectDir, metadata } = await readMetadata(slug);
    const saved = { ...basis, updatedAt: new Date().toISOString() };
    const legacyBasis = metadata.basisPack && typeof metadata.basisPack === "object" && !Array.isArray(metadata.basisPack)
      ? metadata.basisPack as Record<string, unknown>
      : {};
    await writeJsonAtomicPath(path.join(projectDir, "project.json"), { ...metadata, basisPack: { ...legacyBasis, ...saved } });
    return NextResponse.json({ ok: true, success: true, basis: saved });
  } catch (error) {
    return apiError(error, "project", "项目依据包保存失败。", 400);
  }
}
