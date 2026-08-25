import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../_utils";
import {
  createPreparation,
  listPreparations,
  type CreatePreparationInput,
} from "../../../../../src/services/publishPreparationStore.js";
import { buildPlatformVariants } from "../../../../../src/services/platformVariantBuilder.js";
import {
  PREPARATION_PLATFORMS,
  type PublishDraftTarget,
  type PublishPreparationMaster,
  type PublisherPlatform,
} from "../../../../../src/types/publisher.js";

export const runtime = "nodejs";

function isPlatform(value: unknown): value is PublisherPlatform {
  return typeof value === "string" && (PREPARATION_PLATFORMS as readonly string[]).includes(value);
}

function normalizeMaster(value: unknown): PublishPreparationMaster {
  const rec = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    title: typeof rec.title === "string" ? rec.title : "",
    description: typeof rec.description === "string" ? rec.description : "",
    tags: Array.isArray(rec.tags) ? rec.tags.filter((t): t is string => typeof t === "string") : [],
    thumbnailPath: typeof rec.thumbnailPath === "string" ? rec.thumbnailPath : undefined,
  };
}

type NewDraftTarget = Omit<PublishDraftTarget, "id" | "validationErrors" | "manuallyPublished" | "manuallyPublishedAt" | "publishResult" | "publishUrl" | "publishNote">;

function normalizeTargetInput(value: unknown): NewDraftTarget | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (!isPlatform(rec.platform)) return null;
  return {
    platform: rec.platform,
    title: typeof rec.title === "string" ? rec.title : "",
    description: typeof rec.description === "string" ? rec.description : "",
    tags: Array.isArray(rec.tags) ? rec.tags.filter((t): t is string => typeof t === "string") : [],
    thumbnailPath: typeof rec.thumbnailPath === "string" ? rec.thumbnailPath : undefined,
    enabled: typeof rec.enabled === "boolean" ? rec.enabled : true,
  };
}

export async function GET() {
  try {
    const preparations = await listPreparations();
    return NextResponse.json({ ok: true, success: true, data: { preparations } });
  } catch (error) {
    return apiError(error, "publisher", "发布准备列表读取失败。", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readRequestJson(request);
    const videoPath = typeof body.videoPath === "string" ? body.videoPath.trim() : "";
    if (!videoPath) return apiError(new Error("视频文件路径不能为空。"), "publisher", "视频文件路径不能为空。", 400);
    const projectSlug = typeof body.projectSlug === "string" ? body.projectSlug.trim() || undefined : undefined;
    const masterContent = normalizeMaster(body.masterContent);
    const rawTargets = Array.isArray(body.targets) ? body.targets : [];
    let targets = rawTargets.map(normalizeTargetInput).filter(Boolean) as NewDraftTarget[];
    if (targets.length === 0) return apiError(new Error("至少选择一个目标平台。"), "publisher", "至少选择一个目标平台。", 400);

    let variantMissingFields: string[] = [];
    if (projectSlug) {
      const variants = await buildPlatformVariants({
        projectSlug,
        enabledPlatforms: targets.map((target) => target.platform),
      });
      variantMissingFields = variants.missingFields;
      targets = targets.map((target) => {
        const variant = variants.targets.find((item) => item.platform === target.platform);
        if (!variant) return target;
        return {
          ...target,
          title: target.title || variant.title,
          description: variant.source?.description === "platform_doc" ? variant.description : target.description || variant.description,
          tags: target.tags.length > 0 ? target.tags : variant.tags,
          thumbnailPath: target.thumbnailPath || variant.thumbnailPath,
        };
      });
    }

    const input: CreatePreparationInput = { projectSlug, videoPath, masterContent, targets };
    const preparation = await createPreparation(input);
    return NextResponse.json({ ok: true, success: true, data: { preparation, variantMissingFields } }, { status: 201 });
  } catch (error) {
    return apiError(error, "publisher", "发布准备创建失败。", 400);
  }
}
