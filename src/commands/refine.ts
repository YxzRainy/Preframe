import { access, readFile } from "node:fs/promises";
import path from "node:path";
import inquirer from "inquirer";
import {
  buildRefinePrompt,
  parseRefinedContent,
  type RefineDocument,
} from "../prompts/refinePrompt.js";
import { writeMarkdown } from "../services/fileWriter.js";
import { callModel } from "../services/modelClient.js";
import { listProjects } from "../services/projectManager.js";

const REFINABLE = {
  script: { label: "口播脚本", filenames: ["03_口播脚本.md", "02_口播脚本.md"] },
  storyboard: { label: "分镜与剪辑节奏", filenames: ["04_分镜与剪辑节奏.md", "03_分镜草案.md"] },
  titles: { label: "封面标题与发布文案", filenames: ["06_封面标题与发布文案.md", "05_封面标题.md"] },
} as const;

type RefineChoice = keyof typeof REFINABLE | "all";

function revisedFilename(filename: string): string {
  return filename.replace(/\.md$/i, "_修改版.md");
}

async function firstExistingFilename(projectPath: string, filenames: readonly string[]): Promise<string> {
  for (const filename of filenames) {
    try {
      await access(path.join(projectPath, filename));
      return filename;
    } catch {
      // Try the next compatible filename.
    }
  }
  return filenames[0];
}

export async function runRefine(): Promise<void> {
  const projects = await listProjects();
  if (!projects.length) {
    throw new Error("output 目录下没有可修改的项目，请先运行 npm run generate。");
  }

  const { projectPath, target, instruction } = await inquirer.prompt<{
    projectPath: string;
    target: RefineChoice;
    instruction: string;
  }>([
    {
      type: "list",
      name: "projectPath",
      message: "选择项目：",
      choices: projects.map((project) => ({ name: project.name, value: project.path })),
    },
    {
      type: "list",
      name: "target",
      message: "需要修改哪个文件？",
      choices: [
        { name: "口播脚本", value: "script" },
        { name: "分镜与剪辑节奏", value: "storyboard" },
        { name: "封面标题与发布文案", value: "titles" },
        { name: "全部（以上三个文件）", value: "all" },
      ],
    },
    {
      type: "input",
      name: "instruction",
      message: "修改意见：",
      validate: (value: string) => value.trim() ? true : "请输入修改意见。",
      filter: (value: string) => value.trim(),
    },
  ]);

  const selected = target === "all"
    ? Object.values(REFINABLE)
    : [REFINABLE[target]];
  const documents: RefineDocument[] = [];

  for (const item of selected) {
    const filename = await firstExistingFilename(projectPath, item.filenames);
    const filePath = path.join(projectPath, filename);
    try {
      documents.push({ label: item.label, filename, content: await readFile(filePath, "utf8") });
    } catch (error) {
      throw new Error(`无法读取原文件 ${filename}，请确认项目内容完整。`, { cause: error });
    }
  }

  console.log("\n正在生成修改版，请稍候……");
  const raw = await callModel(buildRefinePrompt(documents, instruction));
  const refined = parseRefinedContent(raw, documents.map((doc) => doc.filename));

  for (const doc of documents) {
    await writeMarkdown(path.join(projectPath, revisedFilename(doc.filename)), refined[doc.filename]);
  }

  console.log(`\n修改版已保存（原文件未覆盖）：${projectPath}`);
}
