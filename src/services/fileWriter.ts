import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatMarkdown } from "../utils/formatMarkdown.js";

export async function writeMarkdown(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, formatMarkdown(content), "utf8");
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
