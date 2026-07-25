#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import { runGenerate } from "./commands/generate.js";
import { runRefine } from "./commands/refine.js";
import { runScan } from "./commands/scan.js";
import { ModelClientError } from "./services/modelClient.js";

const program = new Command();

program
  .name("piance")
  .description("片策｜短视频前期自动化工作台")
  .version("0.1.0");

program.command("generate").description("创建短视频内容项目并生成前期策划包").action(runGenerate);
program.command("refine").description("修改已有项目内容").action(runRefine);
program.command("scan").description("扫描并整理素材文件").action(runScan);

program.showHelpAfterError();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof ModelClientError) {
    console.error(`\n模型调用失败：${error.message}`);
  } else if (error instanceof Error) {
    console.error(`\n执行失败：${error.message}`);
  } else {
    console.error("\n执行失败：发生未知错误。");
  }
  process.exitCode = 1;
}
