import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PortableArchiveFile {
  path: string;
  size: number;
  sha256: string;
  contentBase64: string;
}

const MAX_FILE_COUNT = 5000;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

export function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function validateArchivePath(relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new Error(`归档包含无效路径：${relativePath || "<empty>"}`);
  }
  const normalized = relativePath.replace(/\\/gu, "/");
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`归档包含不安全路径：${relativePath}`);
  }
  return normalized;
}

export async function collectArchiveFiles(
  root: string,
  include: (relativePath: string) => boolean = () => true,
): Promise<PortableArchiveFile[]> {
  const files: PortableArchiveFile[] = [];
  let totalBytes = 0;

  async function walk(directory: string, prefix = ""): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile() || !include(relativePath)) continue;
      const content = await readFile(absolutePath);
      totalBytes += content.byteLength;
      if (files.length >= MAX_FILE_COUNT || totalBytes > MAX_ARCHIVE_BYTES) {
        throw new Error("归档超过限制（最多 5000 个文件或 512 MB）。");
      }
      files.push({
        path: validateArchivePath(relativePath),
        size: content.byteLength,
        sha256: sha256(content),
        contentBase64: content.toString("base64"),
      });
    }
  }

  await walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path, "zh-CN", { numeric: true }));
}

export function validateArchiveFiles(value: unknown): PortableArchiveFile[] {
  if (!Array.isArray(value) || value.length > MAX_FILE_COUNT) throw new Error("归档文件列表无效或数量超限。");
  let totalBytes = 0;
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("归档文件条目无效。");
    const record = item as Record<string, unknown>;
    const relativePath = validateArchivePath(typeof record.path === "string" ? record.path : "");
    if (seen.has(relativePath)) throw new Error(`归档包含重复路径：${relativePath}`);
    seen.add(relativePath);
    if (typeof record.contentBase64 !== "string" || typeof record.sha256 !== "string") {
      throw new Error(`归档文件内容无效：${relativePath}`);
    }
    const content = Buffer.from(record.contentBase64, "base64");
    const declaredSize = typeof record.size === "number" ? record.size : -1;
    totalBytes += content.byteLength;
    if (declaredSize !== content.byteLength || totalBytes > MAX_ARCHIVE_BYTES) {
      throw new Error(`归档文件大小校验失败：${relativePath}`);
    }
    if (sha256(content) !== record.sha256) throw new Error(`归档文件校验和不匹配：${relativePath}`);
    return { path: relativePath, size: content.byteLength, sha256: record.sha256, contentBase64: record.contentBase64 };
  });
}

export async function writeArchiveFiles(root: string, files: PortableArchiveFile[]): Promise<void> {
  const resolvedRoot = path.resolve(root);
  for (const file of validateArchiveFiles(files)) {
    const target = path.resolve(resolvedRoot, file.path);
    if (!target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`归档路径越界：${file.path}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(file.contentBase64, "base64"));
    const written = await stat(target);
    if (!written.isFile() || written.size !== file.size) throw new Error(`归档文件写入失败：${file.path}`);
  }
}
