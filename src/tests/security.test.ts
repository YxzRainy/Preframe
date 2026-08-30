import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { callModel, modelConfigFromInput, withModelConfig, type ModelConfig } from "../services/modelClient.js";
import { getWebModelAccess, WEB_MODEL_NAME, WebModelAccessError } from "../services/webModelAccess.js";
import { clearDeepSeekApiKey, saveDeepSeekApiKey } from "../services/envFile.js";

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



test("Web 模型访问固定使用本机 .env Key，不接受浏览器随请求覆盖", () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  const previousBaseUrl = process.env.DEEPSEEK_BASE_URL;
  process.env.DEEPSEEK_API_KEY = "local-env-key";
  process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
  try {
    const access = getWebModelAccess({ modelConfig: { apiKey: "browser-key-must-be-ignored" } });
    assert.equal(access.source, "env");
    assert.equal(access.config.provider, "deepseek");
    assert.equal(access.config.model, WEB_MODEL_NAME);
    assert.equal(access.config.baseURL, "https://api.deepseek.com/v1");
    assert.equal(access.config.apiKey, "local-env-key");
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
    if (previousBaseUrl === undefined) delete process.env.DEEPSEEK_BASE_URL;
    else process.env.DEEPSEEK_BASE_URL = previousBaseUrl;
  }
});

test("本机 .env Key 缺失时返回配置引导错误码", () => {
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

test("DeepSeek Key 只写入指定的本机 .env 文件并使用私有权限", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "preframe-env-"));
  const envPath = path.join(directory, ".env");
  const previousEnvFile = process.env.PIANCE_ENV_FILE;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.PIANCE_ENV_FILE = envPath;
  await writeFile(envPath, "DEEPSEEK_BASE_URL=https://api.deepseek.com/v1\n", "utf8");
  try {
    await saveDeepSeekApiKey("local-secret-key");
    const saved = await readFile(envPath, "utf8");
    assert.match(saved, /DEEPSEEK_API_KEY="local-secret-key"/u);
    assert.match(saved, /DEEPSEEK_BASE_URL=https:\/\/api\.deepseek\.com\/v1/u);
    assert.equal((await stat(envPath)).mode & 0o777, 0o600);
    assert.equal(process.env.DEEPSEEK_API_KEY, "local-secret-key");

    await clearDeepSeekApiKey();
    assert.doesNotMatch(await readFile(envPath, "utf8"), /DEEPSEEK_API_KEY/u);
    assert.equal(process.env.DEEPSEEK_API_KEY, undefined);
  } finally {
    if (previousEnvFile === undefined) delete process.env.PIANCE_ENV_FILE;
    else process.env.PIANCE_ENV_FILE = previousEnvFile;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
    await rm(directory, { recursive: true, force: true });
  }
});
