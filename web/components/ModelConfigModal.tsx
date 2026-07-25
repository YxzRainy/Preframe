"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Modal } from "./Modal";

type ModelProvider =
  | "deepseek"
  | "openai"
  | "anthropic"
  | "gemini"
  | "moonshot"
  | "qwen"
  | "openrouter"
  | "custom";

interface PublicModelConfig {
  provider: ModelProvider;
  providerLabel: string;
  baseURL: string;
  model: string;
  temperature: number;
  maxTokens: number;
  maskedApiKey: string;
  configured: boolean;
  source: "file" | "env" | "default";
}

interface ProviderOption {
  value: ModelProvider;
  label: string;
  defaults: Omit<PublicModelConfig, "providerLabel" | "maskedApiKey" | "configured" | "source">;
}

interface ModelConfigModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (label: string) => void;
}

interface FormState {
  provider: ModelProvider;
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: string;
  maxTokens: string;
}

const emptyConfig: FormState = {
  provider: "deepseek",
  baseURL: "https://api.deepseek.com/v1",
  apiKey: "",
  model: "deepseek-chat",
  temperature: "0.7",
  maxTokens: "4096",
};

function labelFromConfig(config: PublicModelConfig): string {
  return `${config.providerLabel} · ${config.model}`;
}

async function readApiJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (!contentType.toLowerCase().includes("application/json")) {
    console.error("模型配置接口返回了非 JSON 内容，原始返回前 300 字符：", raw.slice(0, 300));
    throw new Error("接口返回了非 JSON 内容，请检查服务端日志。");
  }
  return JSON.parse(raw) as T;
}

export function ModelConfigModal({ open, onClose, onSaved }: ModelConfigModalProps) {
  const [form, setForm] = useState<FormState>(emptyConfig);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [current, setCurrent] = useState<PublicModelConfig | null>(null);
  const [status, setStatus] = useState("未配置");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const providerMap = useMemo(() => new Map(providers.map((provider) => [provider.value, provider])), [providers]);

  async function loadConfig() {
    const response = await fetch("/api/model-config");
    const data = await readApiJson<{ success: boolean; config: PublicModelConfig; providers: ProviderOption[]; error?: string }>(response);
    if (!response.ok || !data.success) throw new Error(data.error || "模型配置读取失败。");
    setProviders(data.providers || []);
    setCurrent(data.config);
    setForm({
      provider: data.config.provider,
      baseURL: data.config.baseURL,
      apiKey: "",
      model: data.config.model,
      temperature: String(data.config.temperature),
      maxTokens: String(data.config.maxTokens),
    });
    setStatus(data.config.configured ? "已配置" : "未配置");
    setMessage(data.config.configured ? `当前使用：${labelFromConfig(data.config)}` : "未保存本地配置时，将继续使用 .env 或默认配置。");
  }

  useEffect(() => {
    if (!open) return;
    setMessage("");
    loadConfig().catch((error) => {
      setStatus("连接失败");
      setMessage(error instanceof Error ? error.message : "模型配置读取失败。");
    });
  }, [open]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((currentForm) => ({ ...currentForm, [key]: value }));
  }

  function selectProvider(provider: ModelProvider) {
    const preset = providerMap.get(provider);
    setForm((currentForm) => ({
      ...currentForm,
      provider,
      baseURL: preset?.defaults.baseURL || currentForm.baseURL,
      model: preset?.defaults.model || currentForm.model,
      temperature: String(preset?.defaults.temperature ?? currentForm.temperature),
      maxTokens: String(preset?.defaults.maxTokens ?? currentForm.maxTokens),
    }));
  }

  function payload() {
    return {
      provider: form.provider,
      baseURL: form.baseURL,
      apiKey: form.apiKey.trim() || undefined,
      model: form.model,
      temperature: Number(form.temperature),
      maxTokens: Number(form.maxTokens),
    };
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/model-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const data = await readApiJson<{ success: boolean; config: PublicModelConfig; error?: string }>(response);
      if (!response.ok || !data.success) throw new Error(data.error || "模型配置保存失败。");
      setCurrent(data.config);
      setForm((currentForm) => ({ ...currentForm, apiKey: "" }));
      setStatus("已配置");
      setMessage("配置已保存到本地。");
      onSaved?.(labelFromConfig(data.config));
    } catch (error) {
      setStatus("连接失败");
      setMessage(error instanceof Error ? error.message : "模型配置保存失败。");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setMessage("");
    try {
      const response = await fetch("/api/model-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const data = await readApiJson<{ success: boolean; message?: string; config?: PublicModelConfig; error?: string }>(response);
      if (!response.ok || !data.success) throw new Error(data.error || "模型连接失败，请检查 API Key、Base URL 或模型名称。");
      setStatus("连接成功");
      setMessage(data.message || "连接成功");
    } catch (error) {
      setStatus("连接失败");
      setMessage(error instanceof Error ? error.message : "模型连接失败，请检查 API Key、Base URL 或模型名称。");
    } finally {
      setTesting(false);
    }
  }

  async function restoreDefault() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/model-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const data = await readApiJson<{ success: boolean; config: PublicModelConfig; error?: string }>(response);
      if (!response.ok || !data.success) throw new Error(data.error || "恢复默认失败。");
      setCurrent(data.config);
      setForm({
        provider: data.config.provider,
        baseURL: data.config.baseURL,
        apiKey: "",
        model: data.config.model,
        temperature: String(data.config.temperature),
        maxTokens: String(data.config.maxTokens),
      });
      setStatus(data.config.configured ? "已配置" : "未配置");
      setMessage("已恢复为 .env / DeepSeek 默认读取方式。");
      onSaved?.(labelFromConfig(data.config));
    } catch (error) {
      setStatus("连接失败");
      setMessage(error instanceof Error ? error.message : "恢复默认失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="模型配置"
      description="配置用于生成策划文档的大模型服务"
      onClose={onClose}
      size="lg"
      closeDisabled={busy || testing}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={restoreDefault} disabled={busy || testing}>恢复默认</button>
          <button type="button" className="secondary-button" onClick={testConnection} disabled={busy || testing}>{testing ? "测试中" : "测试连接"}</button>
          <button type="submit" form="model-config-form" className="primary-button" disabled={busy || testing}>{busy ? "保存中" : "保存配置"}</button>
        </>
      )}
    >
      <form id="model-config-form" className="modal-form model-config-form" onSubmit={save}>
        <section className="model-config-status">
          <div>
            <span className={`model-config-state state-${status === "连接成功" ? "success" : status === "连接失败" ? "error" : current?.configured ? "ready" : "muted"}`}>{status}</span>
            <strong>{current ? labelFromConfig(current) : "读取中"}</strong>
            <p>{message || "API Key 仅保存在本机 .piance/model-config.json，不会写入项目文档。"}</p>
          </div>
          <dl>
            <div><dt>配置来源</dt><dd>{current?.source === "file" ? "本地文件" : current?.source === "env" ? ".env" : "默认"}</dd></div>
            <div><dt>API Key</dt><dd>{current?.maskedApiKey || "未配置"}</dd></div>
          </dl>
        </section>

        <label>
          <span>服务商</span>
          <select value={form.provider} onChange={(event) => selectProvider(event.target.value as ModelProvider)}>
            {providers.map((provider) => <option key={provider.value} value={provider.value}>{provider.label}</option>)}
          </select>
        </label>
        <label>
          <span>Base URL</span>
          <input required value={form.baseURL} onChange={(event) => update("baseURL", event.target.value)} placeholder="https://api.deepseek.com/v1" />
        </label>
        <label>
          <span>API Key</span>
          <input value={form.apiKey} onChange={(event) => update("apiKey", event.target.value)} placeholder={current?.maskedApiKey ? `保持当前：${current.maskedApiKey}` : "sk-..."} type="password" autoComplete="off" />
          <small>留空会保留已保存的本地密钥；接口不会把完整 API Key 返回到页面。</small>
        </label>
        <label>
          <span>模型名称</span>
          <input required value={form.model} onChange={(event) => update("model", event.target.value)} placeholder="deepseek-chat" />
        </label>
        <div className="model-config-grid">
          <label>
            <span>Temperature</span>
            <input required min="0" max="2" step="0.1" type="number" value={form.temperature} onChange={(event) => update("temperature", event.target.value)} />
          </label>
          <label>
            <span>Max Tokens</span>
            <input required min="256" step="256" type="number" value={form.maxTokens} onChange={(event) => update("maxTokens", event.target.value)} />
          </label>
        </div>
      </form>
    </Modal>
  );
}
