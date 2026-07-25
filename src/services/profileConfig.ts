import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_PROFILE_NAME = "创作者";
const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
const PROFILE_DIR = path.resolve(process.cwd(), ".piance", "profile");
const PROFILE_CONFIG_PATH = path.resolve(PROFILE_DIR, "..", "profile.json");

const AVATAR_MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const AVATAR_EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

export interface CreatorProfile {
  name: string;
  avatarPath?: string;
}

export interface AvatarUpload {
  bytes: Buffer;
  mimeType: string;
}

export interface AvatarFile {
  path: string;
  mimeType: string;
  size: number;
}

function normalizeProfile(value: unknown): CreatorProfile {
  if (!value || typeof value !== "object") return { name: DEFAULT_PROFILE_NAME };
  const record = value as Record<string, unknown>;
  return {
    name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : DEFAULT_PROFILE_NAME,
    avatarPath: typeof record.avatarPath === "string" && record.avatarPath.trim() ? record.avatarPath.trim() : undefined,
  };
}

async function readProfileConfig(): Promise<CreatorProfile> {
  try {
    return normalizeProfile(JSON.parse(await readFile(PROFILE_CONFIG_PATH, "utf8")));
  } catch {
    return { name: DEFAULT_PROFILE_NAME };
  }
}

async function writeProfileConfig(profile: CreatorProfile): Promise<void> {
  await mkdir(path.dirname(PROFILE_CONFIG_PATH), { recursive: true });
  await writeFile(PROFILE_CONFIG_PATH, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
}

function relativeAvatarPath(extension: string): string {
  return `.piance/profile/avatar${extension}`;
}

function absoluteAvatarPath(avatarPath: string): string {
  const resolved = path.resolve(process.cwd(), avatarPath);
  if (!resolved.startsWith(`${PROFILE_DIR}${path.sep}`)) {
    throw new Error("头像路径无效。");
  }
  return resolved;
}

async function clearAvatarFiles(): Promise<void> {
  await Promise.all(Object.keys(AVATAR_MIME_BY_EXTENSION).map(async (extension) => {
    try {
      await unlink(path.join(PROFILE_DIR, `avatar${extension}`));
    } catch {
      // Missing old avatar files are fine.
    }
  }));
}

export async function getCreatorProfile(): Promise<CreatorProfile> {
  const profile = await readProfileConfig();
  if (!profile.avatarPath) return profile;
  try {
    await stat(absoluteAvatarPath(profile.avatarPath));
    return profile;
  } catch {
    return { name: profile.name };
  }
}

export async function saveCreatorProfile(name: string, avatar?: AvatarUpload): Promise<CreatorProfile> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("昵称不能为空。");
  const current = await readProfileConfig();
  const next: CreatorProfile = { name: trimmedName, avatarPath: current.avatarPath };

  if (avatar) {
    const extension = AVATAR_EXTENSION_BY_MIME[avatar.mimeType];
    if (!extension) throw new Error("头像仅支持 png、jpg、jpeg、webp。");
    if (avatar.bytes.byteLength > MAX_AVATAR_BYTES) throw new Error("头像文件不能超过 10MB。");
    await mkdir(PROFILE_DIR, { recursive: true });
    await clearAvatarFiles();
    const avatarPath = relativeAvatarPath(extension);
    await writeFile(absoluteAvatarPath(avatarPath), avatar.bytes);
    next.avatarPath = avatarPath;
  }

  await writeProfileConfig(next);
  return getCreatorProfile();
}

export async function resetCreatorProfile(): Promise<CreatorProfile> {
  await clearAvatarFiles();
  await writeProfileConfig({ name: DEFAULT_PROFILE_NAME });
  return { name: DEFAULT_PROFILE_NAME };
}

export async function getAvatarFile(): Promise<AvatarFile | null> {
  const profile = await getCreatorProfile();
  if (!profile.avatarPath) return null;
  const avatarPath = absoluteAvatarPath(profile.avatarPath);
  const extension = path.extname(avatarPath).toLowerCase();
  const mimeType = AVATAR_MIME_BY_EXTENSION[extension];
  if (!mimeType) return null;
  try {
    const avatarStat = await stat(avatarPath);
    return { path: avatarPath, mimeType, size: avatarStat.size };
  } catch {
    return null;
  }
}
