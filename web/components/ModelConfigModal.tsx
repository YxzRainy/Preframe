"use client";

import { FormEvent, useEffect, useState } from "react";
import { readJsonResponse } from "../lib/readJsonResponse";
import { Modal } from "./Modal";

interface PublicModelConfig {
  providerLabel: string;
  baseURL: string;
  model: string;
  temperature: number;
  maxTokens: number;
  thinkingMode: "disabled" | "low" | "high" | "max";
  maskedApiKey: string;
  configured: boolean;
  source: "env" | "default";
}

interface ModelConfigResponse {
  success?: boolean;
  config?: PublicModelConfig;
  envPath?: string;
  error?: string;
}

interface ModelConfigModalProps {
  open?: boolean;
  onClose?: () => void;
  onSaved?: (label: string) => void;
  embedded?: boolean;
}

export function ModelConfigModal({ open = false, onClose = () => undefined, onSaved, embedded = false }: ModelConfigModalProps) {
  const [serverConfig, setServerConfig] = useState<PublicModelConfig | null>(null);
  const [envPath, setEnvPath] = useState("项目根目录/.env");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState("读取中");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  async function loadConfig() {
    const response = await fetch("/api/model-config", { cache: "no-store" });
    const data = await readJsonResponse<ModelConfigResponse>(response);
    if (!response.ok || !data.success || !data.config) throw new Error(data.error || "模型配置读取失败。");
    setServerConfig(data.config);
    setEnvPath(data.envPath || "项目根目录/.env");
    setApiKey("");
    if (data.config.configured) {
      setStatus("本机配置已启用");
      setMessage("");
    } else {
      setStatus("需要 API Key");
      setMessage("");
    }
  }

  useEffect(() => {
    if (!open && !embedded) return;
    setStatus("读取中");
    setMessage("");
    loadConfig().catch((error) => {
      setStatus("读取失败");
      setMessage(error instanceof Error ? error.message : "模型配置读取失败。");
    });
  }, [embedded, open]);

  function notifyUpdated(label: string) {
    window.dispatchEvent(new CustomEvent("piance-model-config-updated", { detail: { modelLabel: label } }));
    onSaved?.(label);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/model-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await readJsonResponse<ModelConfigResponse>(response);
      if (!response.ok || !data.success || !data.config) throw new Error(data.error || "API Key 保存失败。");
      setServerConfig(data.config);
      setEnvPath(data.envPath || envPath);
      setApiKey("");
      setStatus("本机配置已启用");
      setMessage("DeepSeek API Key 已保存到本机 .env；后续请求不再从浏览器传递密钥。");
      notifyUpdated("DeepSeek · deepseek-v4-flash");
    } catch (error) {
      setStatus("保存失败");
      setMessage(error instanceof Error ? error.message : "API Key 保存失败。");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setMessage("");
    try {
      const response = await fetch("/api/model-config/test", { method: "POST" });
      const data = await readJsonResponse<{ success?: boolean; message?: string; error?: string }>(response);
      if (!response.ok || !data.success) throw new Error(data.error || "DeepSeek Flash 连接失败。");
      setStatus("连接成功");
      setMessage(data.message || "DeepSeek Flash 连接成功。");
    } catch (error) {
      setStatus("连接失败");
      setMessage(error instanceof Error ? error.message : "DeepSeek Flash 连接失败。");
    } finally {
      setTesting(false);
    }
  }

  async function clearKey() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/model-config", { method: "DELETE" });
      const data = await readJsonResponse<ModelConfigResponse>(response);
      if (!response.ok || !data.success || !data.config) throw new Error(data.error || "API Key 清除失败。");
      setServerConfig(data.config);
      setApiKey("");
      setStatus("需要 API Key");
      setMessage("已从本机 .env 清除 DeepSeek API Key。");
      notifyUpdated("DeepSeek · deepseek-v4-flash");
    } catch (error) {
      setStatus("清除失败");
      setMessage(error instanceof Error ? error.message : "API Key 清除失败。");
    } finally {
      setBusy(false);
    }
  }

  const configured = Boolean(serverConfig?.configured);

  if (embedded) return (
    <div className="settings-embedded-form">
      <form id="model-config-form" className="settings-model-form" onSubmit={save}>
        <div className="settings-model-status">
          <span className={`settings-status-dot ${configured ? "is-ready" : ""}`} />
          <div><strong>DeepSeek v4 Flash</strong><small>{configured ? `已连接 · ${serverConfig?.maskedApiKey}` : "尚未配置 API Key"}</small></div>
          <button type="button" className="text-button" onClick={testConnection} disabled={busy || testing || !configured}>{testing ? "测试中…" : "测试"}</button>
        </div>
        <label className="settings-key-field">
          <span>API Key</span>
          <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={configured ? "输入新 Key 以替换当前配置" : "sk-..."} type="password" autoComplete="off" />
          <small>密钥仅保存到本机 .env；生成内容会发送至 DeepSeek。</small>
        </label>
        {(message || status.includes("失败")) && <p className={status.includes("失败") ? "settings-modal-error" : "settings-inline-message"}>{message}</p>}
        <div className="settings-inline-actions">
          <button type="submit" className="primary-button" disabled={busy || testing || !apiKey.trim()}>{busy ? "保存中…" : configured ? "更新 Key" : "保存 Key"}</button>
          {configured && <button type="button" className="text-button is-danger" onClick={clearKey} disabled={busy || testing}>清除</button>}
        </div>
      </form>
    </div>
  );

  const form = (
    <form id="model-config-form" className="modal-form model-config-form" onSubmit={save}>
      <section className="model-config-status">
        <div>
          <span className={`model-config-state state-${status === "连接成功" || configured ? "success" : status.includes("失败") ? "error" : "muted"}`}>{status}</span>
          <strong>DeepSeek · deepseek-v4-flash</strong>
          <p>{message || "API Key 仅保存在本机项目 .env 文件。"}</p>
        </div>
        <dl>
          <div><dt>配置来源</dt><dd>{configured ? "本机 .env" : "未配置"}</dd></div>
          <div><dt>API Key</dt><dd>{serverConfig?.maskedApiKey || "未配置"}</dd></div>
        </dl>
      </section>

      <label>
        <span>模型</span>
        <input value="deepseek-v4-flash" readOnly />
      </label>
      <label>
        <span>API 地址</span>
        <input value="https://api.deepseek.com/v1" readOnly />
      </label>
      <label>
        <span>你的 DeepSeek API Key</span>
        <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={configured ? `当前：${serverConfig?.maskedApiKey}` : "sk-..."} type="password" autoComplete="off" />
        <small>保存位置：{envPath}。项目文件保留在本机；提交给模型生成的文字会发送至 DeepSeek API。</small>
      </label>
    </form>
  );

  return (
    <Modal
      open={open}
      title="DeepSeek Flash 配置"
      description="密钥保存在本机 .env，项目数据保存在本地工作区"
      onClose={onClose}
      size="lg"
      closeDisabled={busy || testing}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={clearKey} disabled={busy || testing || !configured}>清除 Key</button>
          <button type="button" className="secondary-button" onClick={testConnection} disabled={busy || testing || !configured}>{testing ? "测试中" : "测试连接"}</button>
          <button type="submit" form="model-config-form" className="primary-button" disabled={busy || testing || !apiKey.trim()}>{busy ? "保存中" : "保存到 .env"}</button>
        </>
      )}
    >
      {form}
    </Modal>
  );
}
