import path from "node:path";
import inquirer from "inquirer";
import { assetsToMarkdown, scanAssets } from "../services/assetScanner.js";
import { writeMarkdown } from "../services/fileWriter.js";
import { listProjects } from "../services/projectManager.js";

export async function runScan(): Promise<void> {
  const projects = await listProjects();
  if (!projects.length) {
    throw new Error("输出目录下没有项目，请先运行 npm run generate，再保存素材索引。");
  }

  const { assetPath } = await inquirer.prompt<{ assetPath: string }>([
    {
      type: "input",
      name: "assetPath",
      message: "素材文件夹路径：",
      validate: (value: string) => value.trim() ? true : "请输入素材文件夹路径。",
      filter: (value: string) => value.trim().replace(/^~(?=$|[\\/])/, process.env.HOME || "~"),
    },
  ]);

  console.log("\n正在扫描素材……");
  const assets = await scanAssets(assetPath);
  const { projectPath } = await inquirer.prompt<{ projectPath: string }>([
    {
      type: "list",
      name: "projectPath",
      message: "将素材索引保存到哪个项目？",
      choices: projects.map((project) => ({ name: project.name, value: project.path })),
    },
  ]);

  const outputPath = path.join(projectPath, "00_素材索引.md");
  await writeMarkdown(outputPath, assetsToMarkdown(assetPath, assets));
  console.log(`\n扫描完成，共发现 ${assets.length} 个文件：${outputPath}`);
}
