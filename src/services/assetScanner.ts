import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

export interface AssetInfo {
  name: string;
  type: string;
  size: number;
  modifiedAt: Date;
  subfolder: string;
  possibleUse: string;
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".svg"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".aac", ".m4a", ".flac", ".ogg"]);
const DOCUMENT_EXTENSIONS = new Set([".md", ".txt", ".doc", ".docx", ".pdf", ".ppt", ".pptx"]);

function inferUse(filename: string, extension: string): string {
  const lower = filename.toLowerCase();
  if (/封面|cover|thumbnail/.test(lower)) return "封面候选";
  if (/口播|talk|speech|采访|interview/.test(lower)) return "口播或采访素材";
  if (/配乐|音乐|music|bgm/.test(lower)) return "背景音乐";
  if (/音效|sfx|sound/.test(lower)) return "音效素材";
  if (/logo|标志/.test(lower)) return "品牌标识";
  if (/字幕|caption|subtitle/.test(lower)) return "字幕文件";
  if (/脚本|文案|script/.test(lower)) return "脚本或文案参考";
  if (/产品|product/.test(lower)) return "产品展示素材";
  if (/人物|人像|portrait/.test(lower)) return "人物素材";
  if (/场景|环境|scene/.test(lower)) return "场景素材";
  if (VIDEO_EXTENSIONS.has(extension)) return "视频主素材或 B-roll";
  if (IMAGE_EXTENSIONS.has(extension)) return "图片、封面或视觉参考";
  if (AUDIO_EXTENSIONS.has(extension)) return "配乐、录音或音效";
  if (DOCUMENT_EXTENSIONS.has(extension)) return "策划、脚本或参考资料";
  return "待人工确认";
}

/** 递归扫描普通文件；跳过符号链接，避免目录循环。 */
export async function scanAssets(rootDir: string): Promise<AssetInfo[]> {
  const root = path.resolve(rootDir);
  let rootStat;
  try {
    rootStat = await lstat(root);
  } catch (error) {
    throw new Error(`素材文件夹不存在或无法访问：${root}`, { cause: error });
  }
  if (!rootStat.isDirectory()) throw new Error(`素材路径不是文件夹：${root}`);

  const assets: AssetInfo[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const stat = await lstat(fullPath);
        const extension = path.extname(entry.name).toLowerCase();
        const relativeFolder = path.relative(root, current);
        assets.push({
          name: entry.name,
          type: extension ? extension.slice(1).toUpperCase() : "未知",
          size: stat.size,
          modifiedAt: stat.mtime,
          subfolder: relativeFolder || "根目录",
          possibleUse: inferUse(entry.name, extension),
        });
      }
    }
  }

  await walk(root);
  return assets.sort((a, b) => a.subfolder.localeCompare(b.subfolder, "zh-CN") || a.name.localeCompare(b.name, "zh-CN"));
}

function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index++) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function assetsToMarkdown(sourceDir: string, assets: AssetInfo[]): string {
  const rows = assets.map((asset) =>
    `| ${escapeCell(asset.name)} | ${asset.type} | ${humanFileSize(asset.size)} | ${asset.modifiedAt.toLocaleString("zh-CN")} | ${escapeCell(asset.subfolder)} | ${asset.possibleUse} |`,
  );
  return [
    "# 素材索引",
    "",
    `- 素材目录：${path.resolve(sourceDir)}`,
    `- 扫描时间：${new Date().toLocaleString("zh-CN")}`,
    `- 文件总数：${assets.length}`,
    "",
    "| 文件名 | 文件类型 | 文件大小 | 修改时间 | 所属子文件夹 | 可能用途 |",
    "| --- | --- | ---: | --- | --- | --- |",
    ...(rows.length ? rows : ["| （未发现文件） | - | - | - | - | - |"]),
  ].join("\n");
}
