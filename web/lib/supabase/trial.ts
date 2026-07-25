import "server-only";

import { loadModelConfig } from "../../../src/services/modelClient";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "./admin";
import { createSupabaseServerClient, isSupabaseServerConfigured } from "./server";

export const FREE_TRIAL_LIMIT = Number(process.env.FREE_TRIAL_LIMIT || 3);

export interface TrialStatus {
  supabaseConfigured: boolean;
  adminConfigured: boolean;
  authenticated: boolean;
  userId: string | null;
  email: string | null;
  freeTrialUsed: number;
  freeTrialLimit: number;
  freeTrialRemaining: number;
  customModelConfigured: boolean;
  serverModelAvailable: boolean;
  canUseCustomModel: boolean;
  canUseServerTrial: boolean;
}

interface UserProfileRow {
  id: string;
  email: string | null;
  free_trial_used: number | null;
  free_trial_limit: number | null;
}

function fallbackStatus(overrides: Partial<TrialStatus> = {}): TrialStatus {
  const freeTrialLimit = Math.max(0, FREE_TRIAL_LIMIT || 3);
  const freeTrialUsed = overrides.freeTrialUsed ?? 0;
  return {
    supabaseConfigured: isSupabaseServerConfigured(),
    adminConfigured: isSupabaseAdminConfigured(),
    authenticated: false,
    userId: null,
    email: null,
    freeTrialUsed,
    freeTrialLimit,
    freeTrialRemaining: Math.max(0, freeTrialLimit - freeTrialUsed),
    customModelConfigured: false,
    serverModelAvailable: false,
    canUseCustomModel: false,
    canUseServerTrial: false,
    ...overrides,
  };
}

async function modelFlags() {
  const config = await loadModelConfig();
  const customModelConfigured = config.source === "file";
  const serverModelAvailable = Boolean(config.apiKey && !customModelConfigured);
  return {
    customModelConfigured,
    serverModelAvailable,
    canUseCustomModel: customModelConfigured,
  };
}

function fromProfile(row: UserProfileRow | null | undefined): Pick<TrialStatus, "freeTrialUsed" | "freeTrialLimit" | "freeTrialRemaining"> {
  const freeTrialLimit = Math.max(0, row?.free_trial_limit ?? (FREE_TRIAL_LIMIT || 3));
  const freeTrialUsed = Math.max(0, row?.free_trial_used ?? 0);
  return {
    freeTrialUsed,
    freeTrialLimit,
    freeTrialRemaining: Math.max(0, freeTrialLimit - freeTrialUsed),
  };
}

async function ensureProfile(userId: string, email: string | null): Promise<UserProfileRow | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const { data, error } = await admin
    .from("user_profiles")
    .upsert(
      { id: userId, email, free_trial_limit: FREE_TRIAL_LIMIT || 3 },
      { onConflict: "id", ignoreDuplicates: true },
    )
    .select("id,email,free_trial_used,free_trial_limit")
    .single<UserProfileRow>();

  if (error) throw error;
  return data;
}

export async function getTrialStatus(): Promise<TrialStatus> {
  const flags = await modelFlags();
  const base = fallbackStatus(flags);
  if (!base.supabaseConfigured) return base;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return base;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return base;

  const userId = userData.user.id;
  const email = userData.user.email ?? null;
  let profile: UserProfileRow | null = null;

  if (base.adminConfigured) {
    profile = await ensureProfile(userId, email);
  } else {
    const { data } = await supabase
      .from("user_profiles")
      .select("id,email,free_trial_used,free_trial_limit")
      .eq("id", userId)
      .single<UserProfileRow>();
    profile = data ?? null;
  }

  const trial = fromProfile(profile);
  return {
    ...base,
    ...trial,
    authenticated: true,
    userId,
    email,
    canUseServerTrial: base.serverModelAvailable && trial.freeTrialRemaining > 0,
  };
}

export async function consumeFreeTrial(userId: string): Promise<Pick<TrialStatus, "freeTrialUsed" | "freeTrialLimit" | "freeTrialRemaining">> {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("免费体验服务未配置 SUPABASE_SERVICE_ROLE_KEY。");

  const { data, error } = await admin
    .rpc("increment_trial", { p_user_id: userId })
    .single<{ free_trial_used: number; free_trial_limit: number }>();

  if (error) throw error;
  const freeTrialUsed = Math.max(0, data?.free_trial_used ?? 0);
  const freeTrialLimit = Math.max(0, data?.free_trial_limit ?? (FREE_TRIAL_LIMIT || 3));
  return {
    freeTrialUsed,
    freeTrialLimit,
    freeTrialRemaining: Math.max(0, freeTrialLimit - freeTrialUsed),
  };
}
