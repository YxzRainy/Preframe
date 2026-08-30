import { readFile } from "node:fs/promises";
import path from "node:path";
import { listProjects } from "./projectManager.js";

export interface WorkspaceSearchResult {
  projectSlug: string;
  projectName: string;
  fileName: string;
  snippet: string;
  matchCount: number;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("zh-CN").replace(/\s+/gu, " ").trim();
}

function excerpt(content: string, query: string): { snippet: string; matchCount: number } | null {
  const source = normalize(content);
  const needle = normalize(query);
  const index = source.indexOf(needle);
  if (index < 0) return null;
  let count = 0;
  let from = 0;
  while (true) {
    const next = source.indexOf(needle, from);
    if (next < 0) break;
    count += 1;
    from = next + needle.length;
  }
  const start = Math.max(0, index - 68);
  const end = Math.min(source.length, index + needle.length + 100);
  return { snippet: `${start > 0 ? "…" : ""}${source.slice(start, end)}${end < source.length ? "…" : ""}`, matchCount: count };
}

/** Search only creator-authored Markdown. Version archives, media metadata and hidden folders stay out of results. */
export async function searchWorkspaceDocuments(query: string, limit = 30): Promise<WorkspaceSearchResult[]> {
  const safeQuery = normalize(query);
  if (!safeQuery) return [];
  const projects = await listProjects();
  const batches = await Promise.all(projects.map(async (project) => {
    const [metadataRaw, entries] = await Promise.all([
      readFile(path.join(project.path, "project.json"), "utf8").catch(() => "{}"),
      import("node:fs/promises").then(({ readdir }) => readdir(project.path, { withFileTypes: true })),
    ]);
    let metadata: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(metadataRaw);
      metadata = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch { /* a malformed metadata file should not break search */ }
    const projectName = typeof metadata.projectName === "string" && metadata.projectName.trim()
      ? metadata.projectName : typeof metadata.topic === "string" ? metadata.topic : project.name;
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
    return Promise.all(files.map(async (entry) => {
      const content = await readFile(path.join(project.path, entry.name), "utf8").catch(() => "");
      const nameMatch = normalize(entry.name).includes(safeQuery);
      const projectMatch = normalize(projectName).includes(safeQuery);
      const match = excerpt(content, safeQuery);
      if (!match && !nameMatch && !projectMatch) return null;
      return {
        projectSlug: project.name,
        projectName,
        fileName: entry.name,
        snippet: match?.snippet || (nameMatch ? `文档名匹配：${entry.name}` : `项目名匹配：${projectName}`),
        matchCount: match?.matchCount || 1,
      } satisfies WorkspaceSearchResult;
    }));
  }));
  return batches.flat(2).filter((item): item is WorkspaceSearchResult => item !== null)
    .sort((a, b) => b.matchCount - a.matchCount || a.projectName.localeCompare(b.projectName, "zh-CN"))
    .slice(0, Math.max(1, Math.min(limit, 50)));
}
