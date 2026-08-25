import { NextResponse } from "next/server";
import { readProject } from "../../../../../../../src/services/projectReader";
import { saveFeedbackRevision, listShootingFeedback } from "../../../../../../../src/services/shootingFeedback";
import { FEEDBACK_REVISION_FILES, buildFeedbackRevisionPrompt, buildFeedbackRevisionRepairPrompt } from "../../../../../../../src/prompts/feedbackRevisionPrompt";
import { parseModelJsonObject } from "../../../../../../../src/utils/modelJson";
import { validateDocument } from "../../../../../../../src/services/documentGeneration";
import { PROJECT_DOCUMENT_DEFINITIONS } from "../../../../../../../src/utils/documentDefinitions";
import { callModel } from "../../../../../../../src/services/modelClient";
import { apiError, readRequestJson } from "../../../../_utils";

export const runtime = "nodejs";

function projectInput(metadata: Record<string, unknown>, slug: string) {
  return {
    projectName: typeof metadata.projectName === "string" ? metadata.projectName : slug,
    topic: typeof metadata.topic === "string" ? metadata.topic : slug,
    platform: typeof metadata.platform === "string" ? metadata.platform : "未指定平台",
    contentSubject: typeof metadata.contentSubject === "string" ? metadata.contentSubject : "未指定内容主体",
    contentDomain: typeof metadata.contentDomain === "string" ? metadata.contentDomain : "未指定内容领域",
    style: typeof metadata.style === "string" ? metadata.style : "未指定风格",
    targetAudience: typeof metadata.targetAudience === "string" ? metadata.targetAudience : "目标用户",
    extraRequirements: typeof metadata.extraRequirements === "string" ? metadata.extraRequirements : "",
  };
}

function readOutput(raw: string): Array<{ filename: string; content: string }> {
  const parsed = parseModelJsonObject(raw, "拍摄复盘修订包");
  return FEEDBACK_REVISION_FILES.map((filename) => {
    const content = parsed[filename];
    if (typeof content !== "string" || !content.trim()) throw new Error(`模型返回缺少 ${filename}`);
    return { filename, content: content.trim() };
  });
}

function validateOutput(files: Array<{ filename: string; content: string }>, metadata: Record<string, unknown>, slug: string): string[] {
  const input = projectInput(metadata, slug);
  const errors: string[] = [];
  for (const file of files) {
    const definition = PROJECT_DOCUMENT_DEFINITIONS.find((item) => item.filename === file.filename);
    if (!definition) continue;
    errors.push(...validateDocument(file.content, definition, input, files.filter((item) => item.filename !== file.filename).map((item) => ({ name: item.filename, content: item.content }))));
  }
  return [...new Set(errors)];
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = await readRequestJson(request);
    const project = await readProject(slug);
    const feedbackId = typeof body.feedbackId === "string" ? body.feedbackId : "";
    const feedback = (await listShootingFeedback(slug)).find((item) => item.id === feedbackId) || (await listShootingFeedback(slug))[0];
    if (!feedback) throw new Error("请先保存一条拍摄复盘。");
    const sourceFiles = FEEDBACK_REVISION_FILES.map((filename) => project.files.find((file) => file.name === filename)).filter(Boolean) as Array<{ name: string; content: string }>;
    if (sourceFiles.length !== FEEDBACK_REVISION_FILES.length) throw new Error(`项目缺少修订所需文件：${FEEDBACK_REVISION_FILES.filter((name) => !sourceFiles.some((file) => file.name === name)).join("、")}`);
    const metadata = project.metadata;
    const input = projectInput(metadata, slug);
    const feedbackText = [feedback.title, feedback.overallNote, feedback.scriptAdjustments, feedback.storyboardAdjustments, feedback.checklistAdjustments].filter(Boolean).join("\n") + "\n" + JSON.stringify(feedback);
    const strategy = typeof metadata.shootingStrategy === "object" && metadata.shootingStrategy ? JSON.stringify(metadata.shootingStrategy) : "";
    let raw = await callModel(buildFeedbackRevisionPrompt(input, sourceFiles, feedbackText, strategy));
    let files: Array<{ filename: string; content: string }>;
    let errors: string[] = [];
    try {
      files = readOutput(raw);
      errors = validateOutput(files, metadata, slug);
      if (errors.length) throw new Error(errors.join("；"));
    } catch (firstError) {
      errors = [firstError instanceof Error ? firstError.message : "修订包解析失败"];
      raw = await callModel(buildFeedbackRevisionRepairPrompt(raw, errors));
      files = readOutput(raw);
      errors = validateOutput(files, metadata, slug);
      if (errors.length) throw new Error(`修订包未通过质量校验：${errors.join("；")}`);
    }
    const revision = await saveFeedbackRevision(slug, feedback.id, files, sourceFiles.map((file) => ({ name: file.name, content: file.content })));
    return NextResponse.json({ ok: true, success: true, revision });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "feedback", "下一版内容生成失败。", status);
  }
}
