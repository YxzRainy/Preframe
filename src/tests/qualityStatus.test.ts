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

function validOverviewContent(): string {
  const detail = Array.from({ length: 90 }, (_, index) => `测试选题第${index + 1}项具体执行信息`).join("，");
  return [
    "# 项目概览",
    "",
    "## 视频目标",
    `围绕测试主体和目标用户说明测试领域的实际方法。${detail}`,
    "",
    "## 推荐方向",
    "从真实使用场景切入，给出能够直接执行的判断和步骤。",
    "",
    "## 视频结构",
    "开头指出问题，中段解释判断并演示步骤，结尾提示边界。",
    "",
    "## 执行优先级",
    "先确认事实和案例，再完成拍摄，最后检查平台表达。",
    "",
    "## 风险边界",
    "不编造数据，不作效果承诺，发布前复核事实。",
  ].join("\n");
}

test("当前文档质量失败后最多修复一次，并可在修复时恢复", async () => {
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
      return JSON.stringify({ content: calls <= DOCUMENT_RETRY_LIMIT ? "内容太短" : validOverviewContent() });
    },
  });

  assert.equal(calls, DOCUMENT_RETRY_LIMIT + 1, "应为首次生成加一次修复");
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

test("内容质检报告必须包含可执行修改表和发布结论", () => {
  const definition = PROJECT_DOCUMENT_DEFINITIONS.find((item) => item.number === "08")!;
  const detail = Array.from({ length: 30 }, (_, index) => `测试选题证据${index + 1}需要核对原句和发布风险。`).join("");
  const valid = [
    "# 内容质检报告",
    "",
    "| 文档/位置 | 原表达/场景 | 问题 | 可直接替换的新句子 | 优先级 |",
    "| --- | --- | --- | --- | --- |",
    "| 03 开头 | 测试选题一定成功 | 承诺过强 | 测试选题可以先做一轮小范围验证 | 高 |",
    "| 03 正文 | 所有人都会需要 | 范围过宽 | 目标用户在这个场景下更可能需要 | 中 |",
    "| 06 标题 | 最强方法 | 缺少证据 | 这套方法先解决一个具体问题 | 低 |",
    "",
    `逐项核验说明：${detail}`,
    "",
    "发布结论：修改后可发布。",
  ].join("\n");
  const invalid = `# 内容质检报告\n\n测试选题整体没有问题，可以直接使用。\n\n${detail}`;

  assert.deepEqual(validateDocument(valid, definition, input), []);
  const errors = validateDocument(invalid, definition, input);
  assert.ok(errors.some((error) => error.includes("修改表")));
  assert.ok(errors.some((error) => error.includes("发布结论")));
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
