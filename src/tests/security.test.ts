import assert from "node:assert/strict";
import { test } from "node:test";
import { callModel, modelConfigFromInput, withModelConfig, type ModelConfig } from "../services/modelClient.js";
import { getWebModelAccess, WEB_MODEL_NAME, WebModelAccessError } from "../services/webModelAccess.js";

function config(apiKey: string): ModelConfig {
  return {
    provider: "openai",
    baseURL: "https://example.test/v1",
    apiKey,
    model: "test-model",
    temperature: 0.2,
    maxTokens: 256,
    thinkingMode: "disabled",
  };
}

test("请求级模型配置不会在并发用户之间串用 API Key", async () => {
  const originalFetch = globalThis.fetch;
  const authorizationHeaders: string[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
    authorizationHeaders.push(new Headers(init?.headers).get("Authorization") || "");
    return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await Promise.all([
      withModelConfig(config("user-key-a"), () => callModel("A")),
      withModelConfig(config("user-key-b"), () => callModel("B")),
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(authorizationHeaders.sort(), ["Bearer user-key-a", "Bearer user-key-b"]);
});

test("模型配置输入会保留已有 Key，但不会接受占位 Key", () => {
  const existing = modelConfigFromInput({
    provider: "openai",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    temperature: 0.7,
    maxTokens: 4096,
  }, "existing-key");
  assert.equal(existing.apiKey, "existing-key");
  assert.throws(() => modelConfigFromInput({
    provider: "openai",
    baseURL: "https://api.openai.com/v1",
    apiKey: "sk-...",
    model: "gpt-4o-mini",
    temperature: 0.7,
    maxTokens: 4096,
  }), /占位值/u);
});



test("Web 模型访问固定为 DeepSeek Flash，并优先使用浏览器随请求提供的 Key", () => {
  const access = getWebModelAccess({ modelConfig: { apiKey: "browser-deepseek-key" } });
  assert.equal(access.source, "browser");
  assert.equal(access.config.provider, "deepseek");
  assert.equal(access.config.model, WEB_MODEL_NAME);
  assert.equal(access.config.baseURL, "https://api.deepseek.com/v1");
  assert.equal(access.config.apiKey, "browser-deepseek-key");
});

test("服务器默认 Key 缺失时返回可引导个人配置的错误码", () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    assert.throws(
      () => getWebModelAccess({}),
      (error: unknown) => error instanceof WebModelAccessError && error.code === "DEFAULT_MODEL_UNAVAILABLE" && error.status === 503,
    );
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
  }
});
