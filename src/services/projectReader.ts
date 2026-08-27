import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { listProjects, resolveProjectDirectory } from "./projectManager.js";
import type { ContentFile } from "./contentWorkflow.js";
import { resolveContentProfile } from "../utils/contentProfile.js";
import { PROJECT_DOCUMENT_DEFINITIONS } from "../utils/documentDefinitions.js";
import { validateDocument } from "./documentGeneration.js";

export interface ProjectMetadata {
  projectName?: string;
  topic?: string;
  platform?: string;
  accountType?: string;
  contentSubject?: string;
  contentDomain?: string;
  style?: string;
  targetAudience?: string;
  extraRequirements?: string;
  model?: string;
  generatedAt?: string;
  generationStartedAt?: string;
  generationFinishedAt?: string;
  generationDurationMs?: number;
  generationDurationLabel?: string;
  [key: string]: unknown;
}

export interface ProjectSummary {
  slug: string;
  name: string;
  generatedAt: string;
  platform: string;
  contentSubject: string;
  contentDomain: string;
  fileCount: number;
  status: "complete" | "partial" | "failed";
  completedCount: number;
}

export interface ProjectDetail {
  slug: string;
  name: string;
  metadata: ProjectMetadata;
  files: ContentFile[];
  covers: CoverSummary[];
}

export interface CoverSummary {
  name: string;
  createdAt: string;
}

async function readCovers(projectDir: string): Promise<CoverSummary[]> {
  const coversDir = path.join(projectDir, "covers");
  try {
    const entries = await readdir(coversDir, { withFileTypes: true });
    const images = entries.filter((entry) => entry.isFile() && /\.(?:png|jpe?g|webp)$/i.test(entry.name));
    return Promise.all(images.map(async (entry) => ({
      name: entry.name,
      createdAt: (await stat(path.join(coversDir, entry.name))).mtime.toISOString(),
    }))).then((covers) => covers.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("封面图片目录读取失败。", { cause: error });
  }
}

async function readMetadata(projectDir: string): Promise<ProjectMetadata> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8"));
    return parsed && typeof parsed === "object" ? parsed as ProjectMetadata : {};
  } catch {
    return {};
  }
}

export async function readProjects(): Promise<ProjectSummary[]> {
  const projects = await listProjects();
  const summaries = await Promise.all(projects.map(async (project) => {
    const [metadata, entries, projectStat] = await Promise.all([
      readMetadata(project.path),
      readdir(project.path, { withFileTypes: true }),
      stat(project.path),
    ]);
    const profile = resolveContentProfile(metadata);
    const metadataStatus: ProjectSummary["status"] | undefined = metadata.status === "complete" || metadata.status === "partial" || metadata.status === "failed" ? metadata.status : undefined;
    const generated = Array.isArray(metadata.generated) ? metadata.generated.filter((value) => typeof value === "string").length : 0;
    const fileCount = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).length;
    const completedCount = generated || (metadataStatus === "complete" ? Math.min(fileCount, PROJECT_DOCUMENT_DEFINITIONS.length) : 0);
    const status: ProjectSummary["status"] = metadataStatus === "complete" && completedCount === PROJECT_DOCUMENT_DEFINITIONS.length
      ? "complete"
      : completedCount > 0
        ? "partial"
        : "failed";
    return {
      slug: project.name,
      name: typeof metadata.projectName === "string" && metadata.projectName.trim()
        ? metadata.projectName
        : typeof metadata.topic === "string" ? metadata.topic : project.name,
      generatedAt: typeof metadata.generatedAt === "string" ? metadata.generatedAt : projectStat.mtime.toISOString(),
      platform: typeof metadata.platform === "string" ? metadata.platform : "未记录",
      contentSubject: profile.contentSubject || "未记录",
      contentDomain: profile.contentDomain || "未记录",
      fileCount,
      completedCount,
      status,
    };
  }));
  return summaries.sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
}

export async function readProject(slug: string): Promise<ProjectDetail> {
  const projectDir = resolveProjectDirectory(slug);
  let entries;
  try {
    entries = await readdir(projectDir, { withFileTypes: true });
  } catch (error) {
    const notFound = new Error(`项目不存在：${slug}`, { cause: error });
    notFound.name = "ProjectNotFoundError";
    throw notFound;
  }
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  const rawFiles = await Promise.all(names.map(async (name) => {
    try {
      return { name, content: await readFile(path.join(projectDir, name), "utf8") };
    } catch (error) {
      throw new Error(`Markdown 文件读取失败：${name}`, { cause: error });
    }
  }));
  const [metadata, covers] = await Promise.all([readMetadata(projectDir), readCovers(projectDir)]);
  const input = {
    projectName: typeof metadata.projectName === "string" ? metadata.projectName : slug,
    topic: typeof metadata.topic === "string" ? metadata.topic : slug,
    platform: typeof metadata.platform === "string" ? metadata.platform : "未指定平台",
    contentSubject: typeof metadata.contentSubject === "string" ? metadata.contentSubject : "未指定内容主体",
    contentDomain: typeof metadata.contentDomain === "string" ? metadata.contentDomain : "未指定内容领域",
    style: typeof metadata.style === "string" ? metadata.style : "未指定风格",
    targetAudience: typeof metadata.targetAudience === "string" ? metadata.targetAudience : "目标用户",
    extraRequirements: typeof metadata.extraRequirements === "string" ? metadata.extraRequirements : "",
  };
  const canonicalFiles = rawFiles.filter((file) => PROJECT_DOCUMENT_DEFINITIONS.some((definition) => definition.filename === file.name));
  const files: Array<ContentFile & { status: "completed" | "failed"; validationErrors: string[] }> = rawFiles.map((file) => {
    const definition = PROJECT_DOCUMENT_DEFINITIONS.find((item) => item.filename === file.name);
    if (!definition) return { ...file, status: "completed" as const, validationErrors: [] };
    const errors = validateDocument(file.content, definition, input, canonicalFiles.filter((other) => other.name !== file.name));
    return { ...file, status: errors.length ? "failed" as const : "completed" as const, validationErrors: errors };
  });
  const previousDocumentsStatus = metadata.documentsStatus && typeof metadata.documentsStatus === "object"
    ? metadata.documentsStatus as Record<string, { documentStatus?: string; validationErrors?: string[] }>
    : {};
  const documentsStatus = Object.fromEntries(PROJECT_DOCUMENT_DEFINITIONS.map((definition) => {
    const file = files.find((item) => item.name === definition.filename);
    const valid = file?.status === "completed";
    const previous = previousDocumentsStatus[definition.number];
    const repaired = valid && previous?.documentStatus === "repaired";
    return [definition.number, {
      id: definition.number,
      fileName: definition.filename,
      status: valid ? "completed" : "failed",
      documentStatus: valid ? repaired ? "repaired" : "generated" : previous?.documentStatus === "fallback" ? "fallback" : "failed",
      generated: valid,
      repaired,
      failed: !valid,
      validationErrors: valid ? file?.validationErrors || [] : previous?.validationErrors?.length ? previous.validationErrors : ["文档缺失"],
    }];
  }));
  const completedCount = Object.values(documentsStatus).filter((item) => item.generated).length;
  metadata.documentsStatus = documentsStatus;
  metadata.generated = Object.values(documentsStatus).filter((item) => item.generated).map((item) => item.id);
  metadata.failed = Object.values(documentsStatus).filter((item) => item.failed).map((item) => item.id);
  metadata.status = completedCount === 10 ? "complete" : completedCount ? "partial" : "failed";
  return {
    slug,
    name: typeof metadata.projectName === "string" && metadata.projectName.trim()
      ? metadata.projectName
      : typeof metadata.topic === "string" ? metadata.topic : slug,
    metadata,
    files,
    covers,
  };
}
