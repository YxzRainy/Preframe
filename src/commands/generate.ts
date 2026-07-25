import inquirer from "inquirer";
import {
  type GenerateInput,
} from "../prompts/generatePrompt.js";
import { generateProject } from "../services/contentWorkflow.js";

export async function runGenerate(): Promise<void> {
  const input = await inquirer.prompt<GenerateInput>([
    {
      type: "input",
      name: "projectName",
      message: "项目名称：",
      validate: (value: string) => value.trim() ? true : "请输入项目名称。",
      filter: (value: string) => value.trim(),
    },
    {
      type: "input",
      name: "topic",
      message: "选题主题：",
      validate: (value: string) => value.trim() ? true : "请输入选题主题。",
      filter: (value: string) => value.trim(),
    },
    {
      type: "input",
      name: "platform",
      message: "平台（如：小红书 / 抖音 / 视频号）：",
      validate: (value: string) => value.trim() ? true : "请输入平台。",
      filter: (value: string) => value.trim(),
    },
    {
      type: "input",
      name: "contentSubject",
      message: "内容主体（如：健身教练IP / 本地餐饮品牌 / AI工具博主）：",
      validate: (value: string) => value.trim() ? true : "请输入内容主体。",
      filter: (value: string) => value.trim(),
    },
    {
      type: "input",
      name: "contentDomain",
      message: "内容领域（如：AI工具 / 健身减脂 / 本地生活）：",
      validate: (value: string) => value.trim() ? true : "请输入内容领域。",
      filter: (value: string) => value.trim(),
    },
    {
      type: "input",
      name: "style",
      message: "内容风格（如：专业但通俗 / 情绪化种草 / 干货科普）：",
      validate: (value: string) => value.trim() ? true : "请输入内容风格。",
      filter: (value: string) => value.trim(),
    },
    {
      type: "input",
      name: "targetAudience",
      message: "目标用户：",
      validate: (value: string) => value.trim() ? true : "请输入目标用户。",
      filter: (value: string) => value.trim(),
    },
    {
      type: "input",
      name: "extraRequirements",
      message: "补充要求（可选）：",
      filter: (value: string) => value.trim(),
    },
  ]);

  console.log("\n正在创建内容项目并生成前期策划包，请稍候……");
  const result = await generateProject(input);
  console.log(`\n前期策划包已生成：${result.projectSlug}`);
}
