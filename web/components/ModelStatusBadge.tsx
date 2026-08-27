"use client";

import { useEffect, useState } from "react";
import { readLocalModelConfig } from "../lib/localModelConfig";
import { readJsonResponse } from "../lib/readJsonResponse";

interface StatusView {
  tone: "success" | "warning" | "error" | "muted";
  label: string;
}

export function ModelStatusBadge() {
  const [view, setView] = useState<StatusView>({ tone: "muted", label: "模型状态读取中" });

  async function refresh() {
    if (readLocalModelConfig()) {
      setView({ tone: "success", label: "个人 DeepSeek Flash 已配置" });
      return;
    }
    const response = await fetch("/api/model-config", { cache: "no-store" });
    const data = await readJsonResponse<{ config?: { configured?: boolean } }>(response);
    setView(response.ok && data.config?.configured
      ? { tone: "success", label: "服务器 DeepSeek Flash 可用" }
      : { tone: "warning", label: "请配置 DeepSeek API Key" });
  }

  useEffect(() => {
    refresh().catch(() => setView({ tone: "error", label: "模型状态读取失败" }));
    const onUpdate = () => refresh().catch(() => undefined);
    window.addEventListener("piance-model-config-updated", onUpdate);
    window.addEventListener("storage", onUpdate);
    return () => {
      window.removeEventListener("piance-model-config-updated", onUpdate);
      window.removeEventListener("storage", onUpdate);
    };
  }, []);

  return <span className={`model-status-badge model-status-${view.tone}`}><i />{view.label}</span>;
}
