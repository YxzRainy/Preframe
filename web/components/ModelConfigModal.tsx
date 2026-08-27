"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  clearLocalModelConfig,
  maskLocalApiKey,
  readLocalModelConfig,
  saveLocalModelConfig,
} from "../lib/localModelConfig";
import { readJsonResponse } from "../lib/readJsonResponse";
import { Modal } from "./Modal";

interface PublicModelConfig {
  providerLabel: string;
  baseURL: string;
  model: string;
  temperature: number;
  maxTokens: number;
  thinkingMode: "disabled" | "low" | "high" | "max";
  configured: boolean;
  source: "env" | "default";
}

interface ModelConfigModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (label: string) => void;
}

export function ModelConfigModal({ open, onClose, onSaved }: ModelConfigModalProps) {
  const [serverConfig, setServerConfig] = useState<PublicModelConfig | null>(null);
  const [savedApiKey, setSavedApiKey] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState("读取中");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  async function loadConfig() {
    const [response, localConfig] = await Promise.all([
      fetch("/api/model-config", { cache: "no-store" }),
      Promise.resolve(readLocalModelConfig()),
    ]);
    const data = await readJsonResponse<{ success?: boolean; config?: PublicModelConfig; error?: string }>(response);
    if (!response.ok || !data.success || !data.config) throw new Error(data.error || "模型配置读取失败。");
    setServerConfig(data.config);
    setSavedApiKey(localConfig?.apiKey || "");
    setApiKey("");
    if (localConfig?.apiKey) {
      setStatus("个人配置已启用");
      setMessage("当前优先使用保存在这个浏览器中的 DeepSeek API Key。");
    } else if (data.config.configured) {
      setStatus("服务器模型可用");
      setMessage("当前使用部署环境变量中的默认 DeepSeek Flash。");
    } else {
      setStatus("需要个人 API Key");
      setMessage("服务器默认模型未配置或不可用时，请在这里保存自己的 DeepSeek API Key。");
    }
  }

  useEffect(() => {
    if (!open) return;
    setStatus("读取中");
    setMessage("");
    loadConfig().catch((error) => {
      setStatus("读取失败");
      setMessage(error instanceof Error ? error.message : "模型配置读取失败。");
    });
  }, [open]);

  function notifyUpdated(label: string) {
    window.dispatchEvent(new CustomEvent("piance-model-config-updated", { detail: { modelLabel: label } }));
    onSaved?.(label);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const config = saveLocalModelConfig(apiKey);
      setSavedApiKey(config.apiKey);
      setApiKey("");
      setStatus("个人配置已启用");
      setMessage("DeepSeek API Key 已保存在这个浏览器中，生成请求会优先使用它。");
      notifyUpdated("DeepSeek · deepseek-v4-flash");
    } catch (error) {
      setStatus("保存失败");
      setMessage(error instanceof Error ? error.message : "API Key 保存失败。");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    const testApiKey = apiKey.trim() || savedApiKey;
    setTesting(true);
    setMessage("");
    try {
      const response = await fetch("/api/model-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testApiKey ? { apiKey: testApiKey } : {}),
      });
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

  function restoreDefault() {
    clearLocalModelConfig();
    setSavedApiKey("");
    setApiKey("");
    if (serverConfig?.configured) {
      setStatus("服务器模型可用");
      setMessage("已清除浏览器中的个人 Key，恢复使用服务器默认 DeepSeek Flash。");
    } else {
      setStatus("需要个人 API Key");
      setMessage("已清除浏览器中的个人 Key；当前服务器默认模型不可用。");
    }
    notifyUpdated("DeepSeek · deepseek-v4-flash");
  }

  const effectiveConfigured = Boolean(savedApiKey || serverConfig?.configured);
  const sourceLabel = savedApiKey ? "当前浏览器" : serverConfig?.configured ? "服务器环境变量" : "未配置";

  return (
    <Modal
      open={open}
      title="DeepSeek Flash 配置"
      description="服务器默认模型不可用时，可使用你自己的 DeepSeek API Key"
      onClose={onClose}
      size="lg"
      closeDisabled={busy || testing}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={restoreDefault} disabled={busy || testing || !savedApiKey}>清除个人 Key</button>
          <button type="button" className="secondary-button" onClick={testConnection} disabled={busy || testing || (!apiKey.trim() && !savedApiKey && !serverConfig?.configured)}>{testing ? "测试中" : "测试连接"}</button>
          <button type="submit" form="model-config-form" className="primary-button" disabled={busy || testing || !apiKey.trim()}>{busy ? "保存中" : "保存到浏览器"}</button>
        </>
      )}
    >
      <form id="model-config-form" className="modal-form model-config-form" onSubmit={save}>
        <section className="model-config-status">
          <div>
            <span className={`model-config-state state-${status === "连接成功" || effectiveConfigured ? "success" : status.includes("失败") ? "error" : "muted"}`}>{status}</span>
            <strong>DeepSeek · deepseek-v4-flash</strong>
            <p>{message || "API Key 只保存在当前浏览器的 localStorage 中，不会保存到服务器数据库。"}</p>
          </div>
          <dl>
            <div><dt>配置来源</dt><dd>{sourceLabel}</dd></div>
            <div><dt>个人 API Key</dt><dd>{savedApiKey ? maskLocalApiKey(savedApiKey) : "未配置"}</dd></div>
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
          <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={savedApiKey ? `当前：${maskLocalApiKey(savedApiKey)}` : "sk-..."} type="password" autoComplete="off" />
          <small>保存后仅当前浏览器可读取；调用模型时会通过 HTTPS 发送给本站服务端代理。</small>
        </label>
      </form>
    </Modal>
  );
}
