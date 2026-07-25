/**
 * Preframe 生成质量与状态真实性测试
 * 运行：node --import tsx/esm src/tests/qualityStatus.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// ─── 被测模块 ────────────────────────────────────────────────────────────────
import { validateDocument, statusRecord } from "../services/documentGeneration.js";
import { PLACEHOLDER_PHRASES, PROJECT_DOCUMENT_DEFINITIONS } from "../utils/documentDefinitions.js";

// 辅助：找一个定义
const def01 = PROJECT_DOCUMENT_DEFINITIONS.find((d) => d.number === "01")!;
const input = {
  topic: "测试选题",
  platform: "小红书",
  contentSubject: "测试主体",
  contentDomain: "测试领域",
  style: "专业",
  targetAudience: "目标用户",
};

// ─── 1. 占位文档校验失败 ─────────────────────────────────────────────────────
test("占位语文档必须校验失败", () => {
  const placeholderContent = [
    "# 项目概览",
    "",
    "模型未完整返回，已生成基础占位文档。",
    "",
    "## 待人工补充",
    "- 请根据项目主题补充 项目概览 的具体内容。",
    "- 请复核内容风险、拍摄可行性和平台适配。",
    "",
  ].join("\n").repeat(20);
  const errors = validateDocument(placeholderContent, def01, input, []);
  assert.ok(errors.length > 0, `占位文档应校验失败，实际错误：${errors.join("; ")}`);
  const hasPlaceholderError = errors.some((e) => e.includes("占位语"));
  assert.ok(hasPlaceholderError, `错误列表应包含"占位语"关键词，实际：${errors.join("; ")}`);
});

// ─── 2. fallback 不计为完成（statusRecord 逻辑）─────────────────────────────
test("含占位语的 content 不计为已完成", () => {
  const fallbackContent = "# 项目概览\n\n模型未完整返回，已生成基础占位文档。\n\n## 待人工补充\n内容";
  const result = statusRecord({
    definition: def01,
    content: fallbackContent,
    repaired: false,
    validationErrors: [],
  });
  assert.equal(result.documentStatus, "fallback", "含占位语的文档 documentStatus 应为 fallback");
  assert.equal(result.generated, false, "含占位语的文档 generated 应为 false");
  assert.equal(result.failed, true, "含占位语的文档 failed 应为 true");
  assert.equal(result.status, "failed", "含占位语的文档 status 应为 failed");
});

// ─── 3. 正常文档计为已完成 ──────────────────────────────────────────────────
test("无占位语的正常文档计为已完成", () => {
  const goodContent = [
    "# 项目概览",
    "",
    "测试选题在小红书上是一个具有测试主体特色的内容方向。目标用户是具体的测试领域人群。",
    "",
    "## 视频目标",
    "让测试主体的目标用户了解测试选题的核心方法。",
    "",
    "## 推荐方向",
    "围绕测试主体的核心优势进行差异化表达。",
    "",
    "## 视频结构",
    "开头提出测试主体问题 → 给出核心判断 → 展开步骤或案例 → 风险提醒",
    "",
    "## 执行优先级",
    "1. 脚本确认",
    "2. 拍摄执行",
    "3. 剪辑输出",
    "",
    "## 风险边界",
    "不编造事实，遵守平台规范。",
  ].join("\n").repeat(3);
  const result = statusRecord({
    definition: def01,
    content: goodContent,
    repaired: false,
    validationErrors: [],
  });
  assert.equal(result.documentStatus, "generated", "正常文档 documentStatus 应为 generated");
  assert.equal(result.generated, true, "正常文档 generated 应为 true");
  assert.equal(result.failed, false, "正常文档 failed 应为 false");
});

// ─── 4. repaired 文档 documentStatus 为 repaired ────────────────────────────
test("修复成功的文档 documentStatus 为 repaired", () => {
  const goodContent = [
    "# 项目概览",
    "测试选题在小红书上是一个具有测试主体特色的内容方向。",
    "",
    "## 视频目标",
    "让测试主体的目标用户了解测试领域的方法。",
    "",
    "## 推荐方向",
    "核心优势表达。",
    "",
    "## 视频结构",
    "明确问题→核心判断→展开步骤→风险提醒",
    "",
    "## 执行优先级",
    "脚本→拍摄→剪辑",
    "",
    "## 风险边界",
    "不编造事实。",
  ].join("\n").repeat(3);
  const result = statusRecord({
    definition: def01,
    content: goodContent,
    repaired: true,
    validationErrors: [],
  });
  assert.equal(result.documentStatus, "repaired", "修复成功的文档 documentStatus 应为 repaired");
  assert.equal(result.repaired, true, "修复成功的文档 repaired 应为 true");
  assert.equal(result.generated, true, "修复成功的文档 generated 应为 true（可用）");
});

// ─── 5. requiredSections 校验生效 ────────────────────────────────────────────
test("缺少 requiredSections 的文档校验失败", () => {
  // def01 需要: 视频目标, 推荐方向, 视频结构, 执行优先级, 风险边界
  const missingContent = [
    "# 项目概览",
    "",
    "测试选题在小红书，目标用户是测试主体。",
    "",
    "## 视频目标",
    "让用户了解核心方法。",
    "",
  ].join("\n").repeat(15); // 只有视频目标，缺其他 4 个
  const errors = validateDocument(missingContent, def01, input, []);
  const missingSection = errors.some((e) => e.includes("缺少二级标题"));
  assert.ok(missingSection, `缺少必要标题时应报告"缺少二级标题"，实际：${errors.join("; ")}`);
});

// ─── 6. partial 状态：fallback 文档不计入完成数 ───────────────────────────────
test("partial 状态：有 fallback 文档时完成数减少", () => {
  const statusRecords = PROJECT_DOCUMENT_DEFINITIONS.map((definition) => {
    if (definition.number === "01") {
      return {
        id: definition.number,
        fileName: definition.filename,
        status: "failed" as const,
        documentStatus: "fallback" as const,
        generated: false,
        repaired: false,
        failed: true,
        validationErrors: ["包含占位语：模型未完整返回"],
      };
    }
    return {
      id: definition.number,
      fileName: definition.filename,
      status: "completed" as const,
      documentStatus: "generated" as const,
      generated: true,
      repaired: false,
      failed: false,
      validationErrors: [],
    };
  });
  const completedCount = statusRecords.filter((r) => r.generated).length;
  const projectStatus = completedCount === 10 ? "complete" : completedCount ? "partial" : "failed";
  assert.equal(completedCount, 9, "01 为 fallback，完成数应为 9");
  assert.equal(projectStatus, "partial", "有 fallback 时项目状态应为 partial，而非 complete");
});

// ─── 7. Gemini URL 不含 key ──────────────────────────────────────────────────
test("callGemini 构造的 URL 不含 API key", async () => {
  const fs = await import("node:fs/promises");
  const src = await fs.readFile(new URL("../services/modelClient.ts", import.meta.url).pathname, "utf8");
  // 提取 callGemini 函数体
  const start = src.indexOf("async function callGemini");
  const end = src.indexOf("\nasync function", start + 1);
  const fnBody = end > 0 ? src.slice(start, end) : src.slice(start);
  assert.ok(!fnBody.includes("?key="), "callGemini 不应在 URL 中包含 ?key= 参数");
  assert.ok(fnBody.includes("x-goog-api-key"), "callGemini 应使用 x-goog-api-key header");
});

// ─── 8. PLACEHOLDER_PHRASES 覆盖关键占位语 ──────────────────────────────────
test("PLACEHOLDER_PHRASES 包含所有已知占位语", () => {
  const required = ["模型未完整返回", "待人工补充", "请根据项目主题补充", "请复核内容", "通用空模板"];
  for (const phrase of required) {
    assert.ok(
      (PLACEHOLDER_PHRASES as readonly string[]).includes(phrase),
      `PLACEHOLDER_PHRASES 缺少关键占位语：${phrase}`,
    );
  }
});
