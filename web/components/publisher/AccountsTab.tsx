"use client";

import { useCallback, useEffect, useState } from "react";
import { readJsonResponse } from "../../lib/readJsonResponse";
import {
  CAPABILITY_LABELS,
  PLATFORM_CAPABILITIES,
  PUBLISHER_PLATFORM_LABELS,
  PUBLISH_HOME_PLATFORMS,
  PUBLISHER_ACCOUNT_STATUS_LABELS,
  type PublisherAccount,
  type PublisherAccountStatus,
  type PublisherPlatform,
} from "../../../src/types/publisher";

interface AccountsTabProps {
  accounts: PublisherAccount[];
  onChange: () => void;
}

const STATUS_TONE: Record<PublisherAccountStatus, string> = {
  not_logged_in: "muted",
  checking: "working",
  logged_in: "ready",
  expired: "warning",
  error: "warning",
};

const LOGIN_TIMEOUT_MS = 3 * 60 * 1000; // 3 分钟
const POLL_INTERVAL_MS = 2000;

function formatTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

export function AccountsTab({ accounts, onChange }: AccountsTabProps) {
  // 当前正在扫码连接的账号 id（用于轮询登录状态）
  const [loginSession, setLoginSession] = useState<{ accountId: string; startedAt: number } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // 各平台"连接"行内的可选显示名称
  const [draftName, setDraftName] = useState<Partial<Record<PublisherPlatform, string>>>({});
  const [expandedPlatform, setExpandedPlatform] = useState<PublisherPlatform | null>(null);

  const accountsByPlatform = (platform: PublisherPlatform) =>
    accounts.filter((acc) => acc.platform === platform);

  /** 创建账号并启动扫码登录 */
  const connectPlatform = useCallback(async (platform: PublisherPlatform) => {
    setError("");
    setNotice("");
    const cap = PLATFORM_CAPABILITIES[platform];
    const displayName = draftName[platform]?.trim() || undefined;
    setBusyId(`connect-${platform}`);
    try {
      // 1. 创建临时账号记录（内部 accountName 自动生成）
      const createRes = await fetch("/api/publisher/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, displayName }),
      });
      const createData = await readJsonResponse<{ data?: { account?: PublisherAccount }; error?: string }>(createRes);
      if (!createRes.ok) throw new Error(createData.error || "账号创建失败。");
      const account = createData.data?.account;
      if (!account) throw new Error("账号创建失败：未返回账号。");

      // 2. 启动 bridge login（detached，浏览器在桌面打开扫码）
      const loginRes = await fetch(`/api/publisher/accounts/${encodeURIComponent(account.id)}/login`, { method: "POST" });
      const loginData = await readJsonResponse<{ error?: string }>(loginRes);
      if (!loginRes.ok) throw new Error(loginData.error || "登录启动失败。");

      // 3. 进入轮询
      setLoginSession({ accountId: account.id, startedAt: Date.now() });
      setNotice(
        cap.loginFlowReady
          ? `已在桌面打开${PUBLISHER_PLATFORM_LABELS[platform]}浏览器尝试连接（端到端登录尚未验证，若失败将显示真实错误）。`
          : `${PUBLISHER_PLATFORM_LABELS[platform]}登录流程未验证，浏览器若打开可尝试扫码；若失败将显示真实错误。`,
      );
      setDraftName((d) => ({ ...d, [platform]: "" }));
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "连接失败。");
    } finally {
      setBusyId(null);
    }
  }, [draftName, onChange]);

  /** 轮询登录状态：每 2s 检查 cookie 是否落盘，页面隐藏时暂停，3 分钟超时 */
  useEffect(() => {
    if (!loginSession) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (cancelled) return;
      // 页面隐藏时暂停轮询（不发起请求）
      if (typeof document !== "undefined" && document.hidden) {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }
      // 超时检查
      if (Date.now() - loginSession.startedAt > LOGIN_TIMEOUT_MS) {
        if (!cancelled) {
          setError("登录超时（超过 3 分钟未完成扫码），请重新连接。");
          setLoginSession(null);
        }
        return;
      }
      try {
        const res = await fetch(`/api/publisher/accounts/${encodeURIComponent(loginSession.accountId)}/poll`, { cache: "no-store" });
        const data = await readJsonResponse<{ data?: { justLoggedIn?: boolean; cookieExists?: boolean }; error?: string }>(res);
        if (!cancelled) {
          if (data.data?.justLoggedIn) {
            setLoginSession(null);
            setNotice("扫码登录成功，账号已连接。");
            onChange();
            return;
          }
          onChange();
        }
      } catch {
        // 网络抖动忽略，继续轮询
      }
      if (!cancelled) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [loginSession, onChange]);

  async function remove(id: string) {
    setError("");
    if (!confirm("确定删除该账号连接？相关登录状态会被清除，不影响其他账号。")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/publisher/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "删除失败。");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败。");
    } finally {
      setBusyId(null);
    }
  }

  async function login(id: string) {
    setError("");
    setBusyId(id);
    try {
      const res = await fetch(`/api/publisher/accounts/${encodeURIComponent(id)}/login`, { method: "POST" });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "登录启动失败。");
      setLoginSession({ accountId: id, startedAt: Date.now() });
      setNotice("已在桌面打开浏览器尝试连接（端到端登录尚未验证，若失败将显示真实错误）。");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录启动失败。");
    } finally {
      setBusyId(null);
    }
  }

  async function validate(id: string) {
    setError("");
    setBusyId(id);
    try {
      const res = await fetch(`/api/publisher/accounts/${encodeURIComponent(id)}/validate`, { method: "POST" });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "检查失败。");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "检查失败。");
    } finally {
      setBusyId(null);
    }
  }

  const loginWaiting = loginSession !== null;

  return (
    <section className="publisher-card publish-accounts" aria-label="平台账号">
      <header className="publish-accounts-head">
        <div>
          <h2>平台账号（自动发布 Beta）</h2>
          <p className="publish-accounts-sub">自动发布依赖浏览器自动化，目前尚未完成端到端账号验证。不影响使用「发布准备」、文案复制和发布包导出。</p>
        </div>
      </header>

      {error && <p className="publish-error">{error}</p>}
      {notice && <p className="publish-notice">{notice}</p>}

      <ul className="publish-platform-grid">
        {PUBLISH_HOME_PLATFORMS.map((platform) => {
          const cap = PLATFORM_CAPABILITIES[platform];
          const list = accountsByPlatform(platform);
          const label = PUBLISHER_PLATFORM_LABELS[platform];
          const connecting = busyId === `connect-${platform}`;
          const isUnverifiedFlow = !cap.loginFlowReady;
          const expanded = expandedPlatform === platform || list.length > 0;
          return (
            <li key={platform} className="publish-platform-card">
              <div className="publish-platform-head">
                <strong>{label}</strong>
                <span className="publish-account-count">{list.length > 0 ? `${list.length} 个账号` : "未连接"}</span>
              </div>

              <ul className="publish-cap-list" aria-label={`${label}能力`}>
                <li className={cap.login === "verified" ? "cap-ok" : "cap-muted"}>{CAPABILITY_LABELS.login[cap.login]}</li>
                <li className={cap.videoUpload === "verified" ? "cap-ok" : "cap-muted"}>{CAPABILITY_LABELS.videoUpload[cap.videoUpload]}</li>
                <li className="cap-muted">{CAPABILITY_LABELS.finalPublish.not_implemented}</li>
                <li className="cap-muted">{CAPABILITY_LABELS.multiAccount[cap.multiAccount]}</li>
              </ul>

              {/* 已连接账号列表 */}
              {list.length > 0 && (
                <ul className="publish-account-list">
                  {list.map((acc) => {
                    const busy = acc.status === "checking" || busyId === acc.id;
                    const waiting = loginSession?.accountId === acc.id;
                    return (
                      <li key={acc.id} className={`publish-account-row ${acc.enabled ? "" : "disabled"}`}>
                        <div className="publish-account-main">
                          <strong>{acc.displayName}</strong>
                          <span className="publish-account-platform">{label}</span>
                          <code className="publish-account-id">{acc.accountName}</code>
                          <span className={`publish-status status-${STATUS_TONE[acc.status]}`}>
                            {PUBLISHER_ACCOUNT_STATUS_LABELS[acc.status]}
                          </span>
                          <span className="publish-account-time">上次检查：{formatTime(acc.lastCheckedAt)}</span>
                          {acc.message && <span className="publish-account-msg" title={acc.message}>{acc.message}</span>}
                        </div>
                        {waiting && (
                          <p className="publish-login-waiting">请在打开的浏览器中完成扫码…</p>
                        )}
                        <div className="publish-account-actions">
                          {acc.status === "logged_in" ? (
                            <button type="button" className="secondary-button" disabled={busy || loginWaiting} onClick={() => validate(acc.id)}>
                              {busy ? "检查中…" : "检查状态"}
                            </button>
                          ) : (
                            <button type="button" className="secondary-button" disabled={busy || loginWaiting} onClick={() => login(acc.id)}>
                              {busy ? "处理中…" : "重新登录"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="publish-icon-btn"
                            disabled={busy}
                            aria-label="删除连接"
                            onClick={() => remove(acc.id)}
                          >×</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* 连接 / 验证 区块 */}
              <div className="publish-connect-row">
                {expanded && (
                  <label className="publish-displayname-field">
                    <span>显示名称（可选）</span>
                    <input
                      value={draftName[platform] || ""}
                      onChange={(e) => setDraftName((d) => ({ ...d, [platform]: e.target.value }))}
                      placeholder={`如 ${label}主号`}
                      disabled={connecting || loginWaiting}
                    />
                  </label>
                )}
                <button
                  type="button"
                  className={isUnverifiedFlow ? "secondary-button" : "primary-button"}
                  disabled={connecting || loginWaiting}
                  onClick={() => connectPlatform(platform)}
                >
                  {connecting ? "启动中…" : isUnverifiedFlow ? "未验证" : "尝试连接"}
                </button>
                {list.length === 0 && !expanded && (
                  <button
                    type="button"
                    className="publish-link-btn"
                    onClick={() => setExpandedPlatform(platform)}
                  >填写显示名称</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
