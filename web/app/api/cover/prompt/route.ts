import { NextResponse } from "next/server";
import { buildCoverPromptRegenerationPrompt, normalizeGeneratedCoverPrompt } from "../../../../../src/prompts/coverPrompt";
import { readProject } from "../../../../../src/services/projectReader";
import { callModel } from "../../../../../src/services/modelClient";
import { runWithWebModelAccess } from "../../../../lib/model-access";
import { apiError, assertSameOrigin, readRequestJson } from "../../_utils";

export const runtime = "nodejs";

const COVER_DOCUMENTS = /^(?:02_拍摄执行稿|03_发布与复盘|03_口播脚本|05_封面标题|06_封面标题与发布文案|09_成片执行稿)\.md$/u;
const COVER_RATIOS = new Set(["1:1", "3:4", "4:3", "9:16", "16:9"]);

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readRequestJson(request);
    const projectSlug = typeof body.projectSlug === "string" ? body.projectSlug : "";
    const ratio = typeof body.ratio === "string" ? body.ratio : "";
    if (!projectSlug || !ratio) throw new Error("项目和封面比例均为必填项。");
    if (!COVER_RATIOS.has(ratio)) throw new Error("不支持的封面比例。");

    const project = await readProject(projectSlug);
    const topic = typeof project.metadata.topic === "string" && project.metadata.topic.trim()
      ? project.metadata.topic
      : project.name;
    const sourceFiles = project.files.filter((file) => COVER_DOCUMENTS.test(file.name));
    const content = (sourceFiles.length ? sourceFiles : project.files)
      .map((file) => `<!-- ${file.name} -->\n${file.content.trim()}`)
      .join("\n\n---\n\n");
    const prompt = await runWithWebModelAccess(request, async () => (
      normalizeGeneratedCoverPrompt(await callModel(buildCoverPromptRegenerationPrompt(topic, content, ratio)))
    ));
    return NextResponse.json({ ok: true, success: true, prompt });
  } catch (error) {
    return apiError(error, "cover", "封面提示词生成失败。", 400);
  }
}
