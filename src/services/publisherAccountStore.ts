/** 发布账号存储 — .piance/publisher-accounts.json，原子写入，并同步桥接层 accounts.json */

import { createId, nowIso, readAtomicJson, writeAtomicJson } from "./atomicJson.js";
import { syncBridgeAccounts } from "./publisherBridgeClient.js";
import {
  PUBLISHER_PLATFORMS,
  type PublisherAccount,
  type PublisherAccountStatus,
  type PublisherPlatform,
} from "../types/publisher.js";

const FILE_NAME = "publisher-accounts.json";

interface AccountStoreData {
  accounts: PublisherAccount[];
}

function isPlatform(value: unknown): value is PublisherPlatform {
  return typeof value === "string" && (PUBLISHER_PLATFORMS as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is PublisherAccountStatus {
  return typeof value === "string" && ["not_logged_in", "checking", "logged_in", "expired", "error"].includes(value);
}

function normalizeAccount(value: unknown): PublisherAccount | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (!isPlatform(rec.platform)) return null;
  const accountName = typeof rec.accountName === "string" ? rec.accountName.trim() : "";
  if (!accountName) return null;
  return {
    id: typeof rec.id === "string" ? rec.id : createId("acct"),
    platform: rec.platform,
    accountName,
    displayName: typeof rec.displayName === "string" ? rec.displayName.trim() : accountName,
    enabled: typeof rec.enabled === "boolean" ? rec.enabled : true,
    status: isStatus(rec.status) ? rec.status : "not_logged_in",
    lastCheckedAt: typeof rec.lastCheckedAt === "string" ? rec.lastCheckedAt : undefined,
    message: typeof rec.message === "string" ? rec.message : undefined,
  };
}

async function readAll(): Promise<PublisherAccount[]> {
  const data = await readAtomicJson<AccountStoreData>(FILE_NAME, { accounts: [] });
  const accounts = Array.isArray(data.accounts) ? data.accounts.map(normalizeAccount).filter(Boolean) as PublisherAccount[] : [];
  return accounts;
}

/** 写入 Preframe 账号文件并同步桥接层 accounts.json */
async function writeAll(accounts: PublisherAccount[]): Promise<void> {
  await writeAtomicJson<AccountStoreData>(FILE_NAME, { accounts });
  try {
    await syncBridgeAccounts(accounts);
  } catch (err) {
    // 桥接层同步失败不阻断 Preframe 主流程，但向上抛出明确错误
    throw new Error(`账号已保存，但同步桥接层失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function listAccounts(): Promise<PublisherAccount[]> {
  return readAll();
}

export async function findAccount(id: string): Promise<PublisherAccount | null> {
  const accounts = await readAll();
  return accounts.find((acc) => acc.id === id) ?? null;
}

export interface CreateAccountInput {
  platform: PublisherPlatform;
  accountName: string;
  displayName?: string;
}

/** 自动生成内部 accountName：{platform}-{n}，n 跳过已占用编号 */
export async function generateAccountName(platform: PublisherPlatform): Promise<string> {
  const accounts = await readAll();
  const used = new Set(accounts.map((acc) => acc.accountName));
  let n = 1;
  while (used.has(`${platform}-${n}`)) n += 1;
  return `${platform}-${n}`;
}

export async function createAccount(input: CreateAccountInput): Promise<PublisherAccount> {
  const accountName = input.accountName.trim();
  if (!accountName) throw new Error("账号标识不能为空。");
  if (!/^[a-zA-Z0-9_-]+$/.test(accountName)) throw new Error("账号标识仅支持英文、数字、下划线与短横线。");
  const accounts = await readAll();
  if (accounts.some((acc) => acc.accountName === accountName)) {
    throw new Error(`账号标识已存在：${accountName}`);
  }
  const account: PublisherAccount = {
    id: createId("acct"),
    platform: input.platform,
    accountName,
    displayName: input.displayName?.trim() || accountName,
    enabled: true,
    status: "not_logged_in",
  };
  await writeAll([...accounts, account]);
  return account;
}

/** 按平台创建账号，内部 accountName 自动生成（如 douyin-1、douyin-2），用户只选填显示名称 */
export async function createAccountByPlatform(
  platform: PublisherPlatform,
  displayName?: string,
): Promise<PublisherAccount> {
  const accountName = await generateAccountName(platform);
  return createAccount({ platform, accountName, displayName });
}

export interface UpdateAccountInput {
  displayName?: string;
  enabled?: boolean;
}

export async function updateAccount(id: string, input: UpdateAccountInput): Promise<PublisherAccount> {
  const accounts = await readAll();
  const idx = accounts.findIndex((acc) => acc.id === id);
  if (idx === -1) throw new Error("账号不存在。");
  const current = accounts[idx];
  const next: PublisherAccount = {
    ...current,
    ...(typeof input.displayName === "string" ? { displayName: input.displayName.trim() || current.displayName } : {}),
    ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
  };
  accounts[idx] = next;
  await writeAll(accounts);
  return next;
}

/** 仅更新登录状态（不触发桥接层同步以外的副作用） */
export async function updateAccountStatus(
  id: string,
  status: PublisherAccountStatus,
  message?: string,
): Promise<PublisherAccount> {
  const accounts = await readAll();
  const idx = accounts.findIndex((acc) => acc.id === id);
  if (idx === -1) throw new Error("账号不存在。");
  const next: PublisherAccount = {
    ...accounts[idx],
    status,
    lastCheckedAt: nowIso(),
    message: message || undefined,
  };
  accounts[idx] = next;
  await writeAll(accounts);
  return next;
}

export async function deleteAccount(id: string): Promise<void> {
  const accounts = await readAll();
  const next = accounts.filter((acc) => acc.id !== id);
  if (next.length === accounts.length) throw new Error("账号不存在。");
  await writeAll(next);
}
