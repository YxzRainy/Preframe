/**
 * Preframe 生成质量与状态真实性测试
 * 运行：node --import tsx/esm src/tests/qualityStatus.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// ─── 被测模块 ────────────────────────────────────────────────────────────────
import {
  DOCUMENT_RETRY_LIMIT,
  generateValidatedDocument,
  validateDocument,
  statusRecord,
} from "../services/documentGeneration.js";
import { PLACEHOLDER_PHRASES, PROJECT_DOCUMENT_DEFINITIONS } from "../utils/documentDefinitions.js";
import { combineModelRequestSignal, createModelClient, ModelClientError } from "../services/modelClient.js";
import { parseModelJsonObject } from "../utils/modelJson.js";
import { automaticRepairFeedback, normalizeAutomaticRepairCandidate } from "../services/contentWorkflow.js";
import { parseRefinedContent } from "../prompts/refinePrompt.js";

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

test("代码围栏 JSON 中的中文弯引号不会截断 Markdown 内容", () => {
  const raw = '```json\n{"content":"# 创作简报\n\n## 核心观点\n他说“我们要共同计划”，而不是“以后再说”。\n\n## 事实与风险边界\n不编造事实。\n\n## 人工确认\n核对真实经历。"}\n```';
  const parsed = parseModelJsonObject(raw, "测试输出");
  assert.equal(typeof parsed.content, "string");
  assert.match(String(parsed.content), /## 事实与风险边界/u);
  assert.match(String(parsed.content), /## 人工确认/u);
  assert.match(String(parsed.content), /“我们要共同计划”/u);
});

test("禁用表达清单列出 AI 套话时不会把清单本身判为正文 AI 味", () => {
  const content = validOverviewContent().replace(
    "先确认事实和案例，再完成拍摄，最后检查平台表达。",
    "先确认事实和案例，再完成拍摄。禁用表达：赋能、抓手、闭环、沉淀。",
  );
  const errors = validateDocument(content, def01, input, []);
  assert.equal(errors.some((error) => error.includes("AI 味")), false);
});

test("自动修复提示只处理质量门错误并保护原文信息", () => {
  const prompt = automaticRepairFeedback("01_创作简报.md", [
    "正文超过 1200 字符，应删除重复解释和非必要扩写",
    "人工确认混入普通执行提醒，只应保留真正需要用户选择或核实的事项",
  ]);
  assert.match(prompt, /程序发起的自动质量修复/u);
  assert.match(prompt, /正文超过 1200 字符/u);
  assert.match(prompt, /人工确认/u);
  assert.match(prompt, /不凭空新增事实/u);
  assert.match(prompt, /完整可替换的 Markdown 文档/u);
});

test("修改结果会移除误抄进正文的文件边界", () => {
  const raw = JSON.stringify({
    "01_创作简报.md": "===== 01_创作简报（01_创作简报.md）=====\n# 创作简报\n\n## 目标与用户\n正文\n\n===== 项目依据包（优先遵守，不要把空白项补写成事实）=====\n## 确认观点\n不应写入正文",
  });
  const parsed = parseRefinedContent(raw, ["01_创作简报.md"]);
  assert.equal(parsed["01_创作简报.md"], "# 创作简报\n\n## 目标与用户\n正文");
  assert.doesNotMatch(parsed["01_创作简报.md"], /=====|01_创作简报\.md|项目依据包|不应写入正文/u);
});

test("自动修复本地兜底会删除人工确认中的执行提醒和固定语速", () => {
  const original = [
    "# 创作简报",
    "",
    "## 目标与用户",
    "测试选题面向目标用户，帮助他们理解测试主体在测试领域中的实际判断方法和行动边界。",
    "",
    "## 核心观点",
    "测试选题不能只看表面结果，还要检查责任、成本和真实使用场景，最终由用户根据事实作出判断。",
    "",
    "## 内容结构",
    "开头提出测试选题的常见误区，中段用测试主体的具体场景解释判断，结尾给出一个能够立即执行的检查动作。",
    "",
    "## 执行约束",
    "- 按240字/分钟语速完成口播。",
    "- 保留测试选题、测试主体和目标用户之间的明确关联。",
    "",
    "## 事实与风险边界",
    "不编造数据和案例，不承诺未经验证的结果，涉及事实时由用户核对来源。",
    "",
    "## 人工确认",
    "1. 请确认真实案例是否可以公开。",
    "2. 建议手机预览封面后再定稿。",
    "3. 第一版完成后需要手机录一遍回放。",
    "4. 口播稿完成后试听语气。",
  ].join("\n");
  const repaired = normalizeAutomaticRepairCandidate(original, "01_创作简报.md");
  assert.doesNotMatch(repaired, /240字\/分钟/u);
  assert.doesNotMatch(repaired, /手机预览|录一遍回放|试听语气/u);
  assert.match(repaired, /口播时长由最终逐字稿与镜头时间码共同校验/u);
  assert.match(repaired, /请确认真实案例是否可以公开/u);
  const errors = validateDocument(repaired, def01, input, []);
  assert.equal(errors.some((error) => error.includes("固定口播语速") || error.includes("人工确认混入")), false);
});

test("自动修复会把不合格的数据复盘收敛为可回填表格", () => {
  const original = [
    "# 发布与复盘",
    "",
    "## 数据复盘",
    "24小时节点先看播放量和完播率，之后再看评论。",
    "72小时节点继续观察收藏增长。",
    "7天节点再决定是否复用。",
  ].join("\n");
  const repaired = normalizeAutomaticRepairCandidate(original, "03_发布与复盘.md");
  for (const checkpoint of ["24 小时", "72 小时", "7 天"]) {
    const row = repaired.split("\n").find((line) => line.startsWith("|") && line.replace(/\s+/g, "").includes(checkpoint.replace(/\s+/g, "")));
    assert.match(row || "", /发布后填写/u);
  }
});

// ─── 1. 占位文档校验失败 ─────────────────────────────────────────────────────
test("占位语文档必须校验失败", () => {
  const placeholderContent = [
    "# 创作简报",
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
  const fallbackContent = "# 创作简报\n\n模型未完整返回，已生成基础占位文档。\n\n## 待人工补充\n内容";
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
    "# 创作简报",
    "",
    "测试选题在小红书上是一个具有测试主体特色的内容方向。目标用户是具体的测试领域人群。",
    "",
    "## 目标与用户",
    "让测试主体的目标用户了解测试选题的核心方法。",
    "",
    "## 核心观点",
    "围绕测试主体的核心优势进行差异化表达。",
    "",
    "## 内容结构",
    "开头提出测试主体问题 → 给出核心判断 → 展开步骤或案例 → 风险提醒",
    "",
    "## 执行约束",
    "1. 脚本确认",
    "2. 拍摄执行",
    "3. 剪辑输出",
    "",
    "## 事实与风险边界",
    "不编造事实，遵守平台规范。",
    "",
    "## 人工确认",
    "发布前核对事实来源与画面授权。",
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
    "# 创作简报",
    "测试选题在小红书上是一个具有测试主体特色的内容方向。",
    "",
    "## 目标与用户",
    "让测试主体的目标用户了解测试领域的方法。",
    "",
    "## 核心观点",
    "核心优势表达。",
    "",
    "## 内容结构",
    "明确问题→核心判断→展开步骤→风险提醒",
    "",
    "## 执行约束",
    "脚本→拍摄→剪辑",
    "",
    "## 事实与风险边界",
    "不编造事实。",
    "",
    "## 人工确认",
    "发布前核对事实来源。",
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

test("因上游失败而未执行的文档标记为 blocked，不冒充生成失败", () => {
  const result = statusRecord({
    definition: PROJECT_DOCUMENT_DEFINITIONS.find((item) => item.number === "03")!,
    repaired: false,
    validationErrors: ["因 02_拍摄执行稿.md 未通过校验，03_发布与复盘.md 本次未生成"],
  });
  assert.equal(result.documentStatus, "blocked");
  assert.equal(result.status, "blocked");
  assert.equal(result.generated, false);
});

// ─── 5. requiredSections 校验生效 ────────────────────────────────────────────
test("缺少 requiredSections 的文档校验失败", () => {
  // def01 需要: 视频目标, 推荐方向, 视频结构, 执行优先级, 风险边界
  const missingContent = [
    "# 创作简报",
    "",
    "测试选题在小红书，目标用户是测试主体。",
    "",
    "## 目标与用户",
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
  const projectStatus = completedCount === PROJECT_DOCUMENT_DEFINITIONS.length ? "complete" : completedCount ? "partial" : "failed";
  assert.equal(completedCount, PROJECT_DOCUMENT_DEFINITIONS.length - 1, "01 为 fallback，完成数应减少 1");
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

function validOverviewContent(): string {
  const detail = Array.from({ length: 50 }, (_, index) => `测试选题第${index + 1}项具体执行信息`).join("，");
  return [
    "# 创作简报",
    "",
    "## 目标与用户",
    `围绕测试主体和目标用户说明测试领域的实际方法。${detail}`,
    "",
    "## 核心观点",
    "从真实使用场景切入，给出能够直接执行的判断和步骤。",
    "",
    "## 内容结构",
    "开头指出问题，中段解释判断并演示步骤，结尾提示边界。",
    "",
    "## 执行约束",
    "先确认事实和案例，再完成拍摄，最后检查平台表达。",
    "",
    "## 事实与风险边界",
    "不编造数据，不作效果承诺，发布前复核事实。",
    "",
    "## 人工确认",
    "确认案例、数据来源和素材授权。",
  ].join("\n");
}

test("当前文档质量失败后最多修复一次，并可在修复时恢复", async () => {
  let calls = 0;
  const states: Array<{ state: string; errors: string[] }> = [];
  const result = await generateValidatedDocument({
    definition: def01,
    input,
    brief: {
      ...input,
      extraRequirements: "无",
      coreViewpoint: "测试选题需要具体执行",
      contentStructure: "问题、判断、步骤、边界",
      riskBoundaries: "不编造事实",
    },
    modelCall: async () => {
      calls += 1;
      return JSON.stringify({ content: calls <= DOCUMENT_RETRY_LIMIT ? "内容太短" : validOverviewContent() });
    },
    onState: (state, errors = []) => states.push({ state, errors }),
  });

  assert.equal(calls, DOCUMENT_RETRY_LIMIT + 1, "应为首次生成加一次修复");
  assert.ok(states.some((item) => item.state === "repairing" && item.errors.some((error) => error.includes("正文长度不足"))), "进入自动纠错前必须把首次失败原因发给界面");
  assert.ok(result.content, "修复成功后应返回当前文档");
  assert.equal(result.repaired, true, "重试成功的文档应标记为 repaired");
});

test("模型返回裸 Markdown 时仍可校验并保存", async () => {
  let calls = 0;
  const markdown = validOverviewContent();
  const result = await generateValidatedDocument({
    definition: def01,
    input,
    brief: {
      ...input,
      extraRequirements: "无",
      coreViewpoint: "测试选题需要具体执行",
      contentStructure: "问题、判断、步骤、边界",
      riskBoundaries: "不编造事实",
    },
    modelCall: async () => {
      calls += 1;
      return `以下是完整文档：\n\n\`\`\`markdown\n${markdown}\n\`\`\``;
    },
  });

  assert.equal(calls, 1, "有效裸 Markdown 不应触发额外模型重试");
  assert.equal(result.content, markdown, "应从代码围栏和说明文字中提取完整 Markdown");
  assert.equal(result.repaired, false);
});

test("无法解析的模型响应会完整保留在失败记录中", async () => {
  const raw = "这是一段没有文档标题、也不是 JSON 的异常输出";
  const records: Array<{ rawOutput?: string; failureKind?: string }> = [];
  const result = await generateValidatedDocument({
    definition: def01,
    input,
    brief: {
      ...input,
      extraRequirements: "无",
      coreViewpoint: "测试选题需要具体执行",
      contentStructure: "问题、判断、步骤、边界",
      riskBoundaries: "不编造事实",
    },
    modelCall: async () => raw,
    onModelCall: (record) => records.push(record),
  });

  assert.equal(result.content, undefined);
  assert.equal(records.length, DOCUMENT_RETRY_LIMIT + 1);
  assert.ok(records.every((record) => record.failureKind === "parse"));
  assert.ok(records.every((record) => record.rawOutput === raw), "每次解析失败都应保留完整原始响应");
});

test("服务端暂时失败只重试一次，不会无限调用模型", async () => {
  let calls = 0;
  const result = await generateValidatedDocument({
    definition: def01,
    input,
    brief: {
      ...input,
      extraRequirements: "无",
      coreViewpoint: "测试选题需要具体执行",
      contentStructure: "问题、判断、步骤、边界",
      riskBoundaries: "不编造事实",
    },
    modelCall: async () => {
      calls += 1;
      throw new ModelClientError("模型暂时不可用", { kind: "server", status: 503 });
    },
  });

  assert.equal(calls, DOCUMENT_RETRY_LIMIT + 1, "服务端错误只能额外重试一次");
  assert.equal(result.content, undefined);
  assert.deepEqual(result.validationErrors, ["模型暂时不可用"]);
});

test("模型超时不重试，避免把单文档放大为多次长请求", async () => {
  let calls = 0;
  const records: Array<{ failureKind?: string }> = [];
  const result = await generateValidatedDocument({
    definition: def01,
    input,
    brief: { ...input, extraRequirements: "无", coreViewpoint: "测试选题需要具体执行", contentStructure: "问题、判断、步骤、边界", riskBoundaries: "不编造事实" },
    modelCall: async () => {
      calls += 1;
      throw new ModelClientError("模型请求超时", { kind: "timeout" });
    },
    onModelCall: (record) => records.push(record),
  });

  assert.equal(calls, 1);
  assert.equal(result.content, undefined);
  assert.equal(records[0]?.failureKind, "timeout");
});

test("调用监控记录耗时、输入规模、finish reason 和 token usage", async () => {
  const records: Array<{ durationMs: number; promptChars: number; finishReason?: string; totalTokens?: number }> = [];
  await generateValidatedDocument({
    definition: def01,
    input,
    brief: { ...input, extraRequirements: "无", coreViewpoint: "测试选题需要具体执行", contentStructure: "问题、判断、步骤、边界", riskBoundaries: "不编造事实" },
    modelCall: async (_prompt, options) => {
      options?.onMetrics?.({ finishReason: "stop", promptTokens: 120, completionTokens: 80, totalTokens: 200 });
      return JSON.stringify({ content: validOverviewContent() });
    },
    onModelCall: (record) => records.push(record),
  });

  assert.equal(records.length, 1);
  assert.ok(records[0].durationMs >= 0);
  assert.ok(records[0].promptChars > 0);
  assert.equal(records[0].finishReason, "stop");
  assert.equal(records[0].totalTokens, 200);
});

test("修复提示词保留选题、projectBrief 和依赖上下文", async () => {
  const prompts: string[] = [];
  const result = await generateValidatedDocument({
    definition: def01,
    input,
    brief: { ...input, extraRequirements: "无", coreViewpoint: "测试选题核心观点", contentStructure: "问题、判断、步骤、边界", riskBoundaries: "不编造事实" },
    context: "===== 依赖.md =====\n测试选题的关键依赖结论",
    modelCall: async (prompt) => {
      prompts.push(prompt);
      return JSON.stringify({ content: prompts.length === 1 ? "内容太短" : validOverviewContent() });
    },
  });

  assert.ok(result.content);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /测试选题核心观点/u);
  assert.match(prompts[1], /关键依赖结论/u);
  assert.match(prompts[1], /平台“小红书”/u);
});

test("任务截止后停止当前调用且不再重试", async () => {
  let calls = 0;
  const signal = AbortSignal.timeout(5);
  const result = await generateValidatedDocument({
    definition: def01,
    input,
    brief: { ...input, extraRequirements: "无", coreViewpoint: "测试选题需要具体执行", contentStructure: "问题、判断、步骤、边界", riskBoundaries: "不编造事实" },
    signal,
    modelCall: async (_prompt, options) => {
      calls += 1;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 100);
        options?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(options.signal?.reason);
        }, { once: true });
      });
      return "";
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.content, undefined);
  assert.match(result.validationErrors[0], /06:00/u);
});

test("模型请求同时响应任务取消和内部超时", async () => {
  const external = new AbortController();
  const cancelled = combineModelRequestSignal(external.signal, 1_000);
  external.abort(new DOMException("cancelled", "AbortError"));
  assert.equal(cancelled.aborted, true, "任务取消信号必须传递到模型请求");

  const timedOut = combineModelRequestSignal(undefined, 5);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(timedOut.aborted, true, "内部超时不能被任务取消信号覆盖");
  assert.equal(timedOut.reason?.name, "TimeoutError");
});

test("拍摄执行稿必须是可直接拍的唯一真源", async () => {
  const definition = PROJECT_DOCUMENT_DEFINITIONS.find((item) => item.number === "02")!;
  const segments = [
    "异地协作先看责任是否明确，不要只看双方有没有感情。距离本身不是结论，长期没有共同安排才会消耗关系。",
    "真正需要检查的是三件事：冲突后谁主动修复，重要决定有没有共同时间表，见面和迁移成本是否由两个人共同承担。如果这些问题始终只有一个人在推进，失望会逐渐替代期待。",
    "可以先约定一次具体讨论，把下一次见面、未来城市和各自能承担的行动写清楚。答案不必完美，但必须真实。关系能不能继续，要看两个人是否愿意共同解决问题。",
  ];
  const script = segments.join("");
  const valid = [
    "# 拍摄执行稿",
    "",
    "## 执行摘要",
    "平台是小红书，目标用户是测试主体面对的测试领域用户。采用竖屏真人口播，目标时长45-60秒，核心任务是把判断和行动建议说清楚。",
    "",
    "## 最终逐字口播稿",
    script,
    "",
    "## 镜头执行表",
    "| 时间 | 最终口播 | 画面/动作 | 字幕重点 | B-roll/素材 | 拍摄状态 |",
    "| --- | --- | --- | --- | --- | --- |",
    `| 0-10秒 | ${segments[0]} | 人物近景直视镜头 | 距离不是唯一原因 | 无，保持人物口播 | 未拍 |`,
    `| 10-35秒 | ${segments[1]} | 半身口播，逐项手势计数 | 修复、时间表、共同承担 | 日历与聊天计划特写 | 未拍 |`,
    `| 35-55秒 | ${segments[2]} | 中景收尾，语速放慢 | 把行动写清楚 | 纸面计划或备忘录特写 | 未拍 |`,
    "",
    "## 场景与设备",
    "安静室内、手机竖屏、领夹麦和柔和正面光。机位与眼睛平齐，背景只保留少量生活物件，避免画面干扰。",
    "",
    "## 素材与替代方案",
    "优先拍摄日历、备忘录和双方共同计划的匿名示意画面。无法补拍时，使用手写关键词特写替代，不展示真实聊天隐私。",
    "",
    "## 拍摄风险",
    "不把个体经历概括为所有关系的必然结局，不展示可识别的聊天记录，不编造调查数据或心理学结论。",
    "",
    "## 锁稿检查",
    "镜头表从0秒连续到55秒，逐行口播与最终逐字稿一致；已检查禁用表达、事实边界、隐私和竖屏要求，可直接拍。",
  ].join("\n");
  const brief = { ...input, extraRequirements: "无", coreViewpoint: "测试选题", contentStructure: "判断到步骤", targetDuration: "45-60秒", requiredElements: "核心判断", forbiddenExpressions: "绝对化表达", riskBoundaries: "不编造" };
  const errors = validateDocument(valid, definition, input, [], brief);
  assert.deepEqual(errors, []);

  const qualifiedScript = valid
    .replaceAll("答案不必完美，但必须真实。", "答案不一定完美，并非所有人都要照搬，结果也并非必然，但必须真实。");
  const qualifiedBrief = {
    ...brief,
    forbiddenExpressions: "禁用“一定”“必然”“所有人都”；不用“首先其次最后”结构。",
  };
  assert.deepEqual(
    validateDocument(qualifiedScript, definition, input, [], qualifiedBrief),
    [],
    "否定绝对化的风险限定不应被禁用词子串误伤",
  );
  const absoluteClaim = qualifiedScript.replaceAll("不一定完美", "一定完美");
  assert.ok(validateDocument(absoluteClaim, definition, input, [], qualifiedBrief).some((error) => error.includes("禁用表达：一定")));
  const enumeratedClaim = qualifiedScript.replaceAll(
    "可以先约定一次具体讨论，把下一次见面、未来城市和各自能承担的行动写清楚。",
    "首先约定具体讨论，其次写清未来城市，最后确认各自承担的行动。",
  );
  assert.ok(validateDocument(enumeratedClaim, definition, input, [], qualifiedBrief).some((error) => error.includes("禁用表达：首先其次最后")));

  const invalid = valid.replace("可直接拍", "后续再压缩").replaceAll("未拍", "已完成");
  const invalidErrors = validateDocument(invalid, definition, input, [], brief);
  assert.ok(invalidErrors.some((error) => error.includes("未拍")));
  assert.ok(invalidErrors.some((error) => error.includes("可直接拍") || error.includes("留给用户")));

  const timingOnly = valid.replace("| 0-10秒 |", "| 0-5秒 |").replace("| 10-35秒 |", "| 5-35秒 |");
  let calls = 0;
  const retimed = await generateValidatedDocument({
    definition,
    input,
    brief,
    modelCall: async () => {
      calls += 1;
      return JSON.stringify({ content: timingOnly });
    },
  });
  assert.equal(calls, 1, "只有时间分配问题时应在本地修复，不额外消耗模型调用");
  assert.equal(retimed.repaired, true);
  assert.ok(retimed.content);
  assert.deepEqual(validateDocument(retimed.content!, definition, input, [], brief), []);
});

test("发布与复盘不得虚构评论和数据", () => {
  const definition = PROJECT_DOCUMENT_DEFINITIONS.find((item) => item.number === "03")!;
  const body = [
    "# 发布与复盘",
    "",
    "## 最终发布卡",
    "主标题：测试选题真正要检查的三个行动。封面文字：别只看感情，看谁在共同推进。封面使用人物近景和日历元素，不使用虚构聊天截图。内容形式为小红书竖屏视频。",
    "",
    "## 平台发布文案",
    "很多人把测试选题的问题归结为距离，但更值得检查的是：冲突后是否共同修复，重要决定有没有时间表，现实成本是否由双方共同承担。视频给出一份可以直接讨论的行动清单，不替任何一段关系下结论。你可以结合自己的实际情况，核对哪些问题已经有明确答案。",
    "",
    "## 置顶评论",
    "如果只能先谈一件事，你会先确认见面安排、未来城市，还是冲突后的修复方式？",
    "",
    "## 发布记录",
    "视频发布时间：发布后填写；视频链接：发布后填写；实际标题与封面版本：发布后填写。",
    "",
    "## 数据复盘",
    "| 回收节点 | 播放与停留 | 互动与评论 | 结论 |",
    "| --- | --- | --- | --- |",
    "| 24 小时 | 发布后填写 | 发布后填写 | 发布后填写 |",
    "| 72 小时 | 发布后填写 | 发布后填写 | 发布后填写 |",
    "| 7 天 | 发布后填写 | 发布后填写 | 发布后填写 |",
    "",
    "## 复用与下一步",
    "只根据真实播放、停留、收藏和评论内容决定下一步。如果观众集中追问沟通方法，可延展成具体讨论模板；如果开头停留低，优先重剪前五秒；如果事实边界引发误解，先补充限定条件，不根据尚未出现的数据预判表现。",
  ].join("\n");
  assert.deepEqual(validateDocument(body, definition, input), []);
  const columnOrientedReview = body.replace(
    [
      "| 回收节点 | 播放与停留 | 互动与评论 | 结论 |",
      "| --- | --- | --- | --- |",
      "| 24 小时 | 发布后填写 | 发布后填写 | 发布后填写 |",
      "| 72 小时 | 发布后填写 | 发布后填写 | 发布后填写 |",
      "| 7 天 | 发布后填写 | 发布后填写 | 发布后填写 |",
    ].join("\n"),
    [
      "| 指标 | 24小时 | 72小时 | 7天 |",
      "| --- | --- | --- | --- |",
      "| 播放量 | 发布后填写 | 发布后填写 | 发布后填写 |",
      "| 完播率 | 发布后填写 | 发布后填写 | 发布后填写 |",
      "| 评论数 | 发布后填写 | 发布后填写 | 发布后填写 |",
    ].join("\n"),
  );
  assert.deepEqual(validateDocument(columnOrientedReview, definition, input), [], "回收节点作为表头列时也应通过校验");
  assert.equal(
    normalizeAutomaticRepairCandidate(columnOrientedReview, "03_发布与复盘.md"),
    columnOrientedReview,
    "本地自动修复不应覆盖已经合格的列式复盘表",
  );
  const emptyColumnReview = columnOrientedReview.replaceAll("发布后填写", "");
  assert.ok(validateDocument(emptyColumnReview, definition, input).some((error) => error.includes("24 小时")), "只有节点表头、没有待回填值时仍应失败");

  const recorded = body
    .replace("视频发布时间：发布后填写；视频链接：发布后填写；实际标题与封面版本：发布后填写。", "视频发布时间：2026-08-29 12:00；视频链接：https://example.com/video；发布状态：已发布。")
    .replace("| 24 小时 | 发布后填写 | 发布后填写 | 发布后填写 |", "| 24 小时 | 1200 次播放，平均停留 18 秒 | 36 收藏，12 评论 | 开头停留正常 |")
    .replace("| 72 小时 | 发布后填写 | 发布后填写 | 发布后填写 |", "| 72 小时 | 2600 次播放，平均停留 19 秒 | 71 收藏，25 评论 | 收藏继续增长 |")
    .replace("| 7 天 | 发布后填写 | 发布后填写 | 发布后填写 |", "| 7 天 | 5100 次播放，平均停留 19 秒 | 133 收藏，48 评论 | 数据已记录 |");
  assert.ok(validateDocument(recorded, definition, input).some((error) => error.includes("发布后填写")), "生成态仍应拒绝模型预填真实数据");
  assert.deepEqual(validateDocument(recorded, definition, input, [], undefined, { allowRecordedResults: true }), []);
  const errors = validateDocument(body.replace("你会先确认见面安排、未来城市，还是冲突后的修复方式？", "你会先确认哪一步？\n\n## 评论区高频回复\n杠精私信统一回复"), definition, input);
  assert.ok(errors.some((error) => error.includes("账号级通用话术")));
  const inventedTiming = validateDocument(body.replace("只根据真实播放", "建议发布时间调整至21:00-22:00。只根据真实播放"), definition, input);
  assert.ok(inventedTiming.some((error) => error.includes("具体发布时间段")));
  const externalBenchmark = validateDocument(body.replace("只根据真实播放", "参考同类情感账号中位数。只根据真实播放"), definition, input);
  assert.ok(externalBenchmark.some((error) => error.includes("外部基准")));
  const vagueTitle = validateDocument(body.replace("主标题：测试选题真正要检查的三个行动。", "主标题：异地恋败给这两个字。"), definition, input);
  assert.ok(vagueTitle.some((error) => error.includes("悬念表达")));
  const inventedRatio = validateDocument(body.replace("只根据真实播放", "收藏点赞比高于2:1时重剪。只根据真实播放"), definition, input);
  assert.ok(inventedRatio.some((error) => error.includes("数值比例阈值")));
});

test("非 JSON 的 5xx 响应仍分类为 server，允许上层执行一次重试", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("temporarily unavailable", {
    status: 503,
    headers: { "content-type": "text/plain" },
  });
  try {
    const client = createModelClient({
      provider: "deepseek",
      baseURL: "https://example.com/v1",
      apiKey: "test-key",
      model: "test-model",
      temperature: 0.7,
      maxTokens: 4096,
      thinkingMode: "disabled",
    });
    await assert.rejects(
      () => client.callChatModel("test"),
      (error: unknown) => error instanceof ModelClientError && error.kind === "server" && error.status === 503,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Anthropic 截断响应记录指标并分类为 length", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    content: [{ type: "text", text: "partial" }],
    stop_reason: "max_tokens",
    usage: { input_tokens: 120, output_tokens: 80 },
  });
  let totalTokens: number | undefined;
  try {
    const client = createModelClient({
      provider: "anthropic",
      baseURL: "https://example.com/v1",
      apiKey: "test-key",
      model: "test-model",
      temperature: 0.7,
      maxTokens: 4096,
      thinkingMode: "disabled",
    });
    await assert.rejects(
      () => client.callChatModel("test", { onMetrics: (metrics) => { totalTokens = metrics.totalTokens; } }),
      (error: unknown) => error instanceof ModelClientError && error.kind === "length",
    );
    assert.equal(totalTokens, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DeepSeek V4 Flash 使用 low 思考强度和配置的输出预算", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    return Response.json({
      choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    });
  };
  try {
    const client = createModelClient({
      provider: "deepseek",
      baseURL: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      temperature: 0.7,
      maxTokens: 32768,
      thinkingMode: "low",
    });
    assert.equal(await client.callChatModel("test"), "OK");
    assert.deepEqual(requestBody.thinking, { type: "enabled" });
    assert.equal(requestBody.reasoning_effort, "low");
    assert.equal(requestBody.max_tokens, 32768);
    assert.equal("temperature" in requestBody, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
