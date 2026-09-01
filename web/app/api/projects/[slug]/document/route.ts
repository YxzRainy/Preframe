import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { archiveDocumentVersion } from "../../../../../../src/services/documentVersionStore";
import { writeMarkdown } from "../../../../../../src/services/fileWriter";
import { resolveProjectDirectory } from "../../../../../../src/services/projectManager";
import { syncProjectDerivedState } from "../../../../../../src/services/projectLifecycle";
import { PROJECT_DOCUMENT_DEFINITIONS } from "../../../../../../src/utils/documentDefinitions";
import { validateDocument } from "../../../../../../src/services/documentGeneration";
import { apiError, readRequestJson } from "../../../_utils";
import { hydrateProjectDirectory, persistProjectBySlug, usesNetlifyPersistentGeneration } from "../../../../../../src/services/netlifyGenerationStore";

export const runtime = "nodejs";

function assertDocumentName(fileName: string): void {
  if (!/^\d{2}_.+\.md$/u.test(fileName) || fileName !== path.basename(fileName)) {
    throw new Error("只能编辑项目中的标准 Markdown 文档。");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    if (usesNetlifyPersistentGeneration()) await hydrateProjectDirectory(slug);
    const body = await readRequestJson(request);
    const fileName = typeof body.fileName === "string" ? body.fileName : "";
    const content = typeof body.content === "string" ? body.content : undefined;
    assertDocumentName(fileName);
    if (content === undefined) throw new Error("缺少文档内容。");
    if (content.length > 300_000) throw new Error("文档超过 300,000 字符，暂不能保存。");

    const projectDir = resolveProjectDirectory(slug);
    const target = path.join(projectDir, fileName);
    const current = await readFile(target, "utf8");
    const definition = PROJECT_DOCUMENT_DEFINITIONS.find((item) => item.filename === fileName);
    if (definition) {
      let metadata: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
      } catch { /* 旧项目没有统一质量门。 */ }
      if (metadata.workflowVersion === 2) {
        const input = {
          topic: typeof metadata.topic === "string" ? metadata.topic : slug,
          platform: typeof metadata.platform === "string" ? metadata.platform : "未指定平台",
          contentSubject: typeof metadata.contentSubject === "string" ? metadata.contentSubject : "未指定内容主体",
          contentDomain: typeof metadata.contentDomain === "string" ? metadata.contentDomain : "未指定内容领域",
          style: typeof metadata.style === "string" ? metadata.style : "未指定风格",
          targetAudience: typeof metadata.targetAudience === "string" ? metadata.targetAudience : "目标用户",
          extraRequirements: typeof metadata.extraRequirements === "string" ? metadata.extraRequirements : "",
        };
        const brief = metadata.projectBrief && typeof metadata.projectBrief === "object" && !Array.isArray(metadata.projectBrief)
          ? metadata.projectBrief as Parameters<typeof validateDocument>[4]
          : undefined;
        const otherDocuments: Array<{ name: string; content: string }> = (await Promise.all(PROJECT_DOCUMENT_DEFINITIONS
          .filter((item) => item.filename !== fileName)
          .map(async (item): Promise<{ name: string; content: string } | null> => {
            try { return { name: item.filename, content: await readFile(path.join(projectDir, item.filename), "utf8") }; } catch { return null; }
          })))
          .filter((item): item is { name: string; content: string } => item !== null);
        const errors = validateDocument(content, definition, input, otherDocuments, brief, { allowRecordedResults: fileName === "03_发布与复盘.md" });
        if (errors.length) throw new Error(`保存前质量门未通过：${errors.join("；")}`);
      }
    }
    if (current === content) return NextResponse.json({ ok: true, success: true, unchanged: true, content: current });

    await archiveDocumentVersion(slug, fileName, current, "manual-save");
    await writeMarkdown(target, content);
    await syncProjectDerivedState(slug);
    if (usesNetlifyPersistentGeneration()) await persistProjectBySlug(slug);
    const saved = await readFile(target, "utf8");
    return NextResponse.json({ ok: true, success: true, content: saved });
  } catch (error) {
    return apiError(error, "project", "文档保存失败。", 400);
  }
}
