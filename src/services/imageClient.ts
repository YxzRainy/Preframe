export const COVER_RATIOS = {
  "1:1": { label: "1:1 方形", size: "1024x1024" },
  "3:4": { label: "3:4 小红书竖版", size: "768x1024" },
  "4:3": { label: "4:3 横版", size: "1024x768" },
  "9:16": { label: "9:16 抖音 / 视频号", size: "576x1024" },
  "16:9": { label: "16:9 横屏", size: "1024x576" },
} as const;

export type CoverRatio = keyof typeof COVER_RATIOS;

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
  extension: "png" | "jpg" | "webp";
}

export class ImageClientError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ImageClientError";
  }
}

function parseExtraBody(): Record<string, unknown> {
  const raw = process.env.IMAGE_API_EXTRA_BODY?.trim();
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("必须是 JSON 对象");
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new ImageClientError("IMAGE_API_EXTRA_BODY 不是合法的 JSON 对象。", { cause: error });
  }
}

function decodeBase64(value: string): GeneratedImage {
  const dataUrl = /^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/.exec(value);
  const mimeType = dataUrl?.[1] ?? "image/png";
  const encoded = dataUrl?.[2] ?? value;
  return {
    bytes: Buffer.from(encoded, "base64"),
    mimeType,
    extension: mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png",
  };
}

function responseItem(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const collection = Array.isArray(record.data) ? record.data : Array.isArray(record.images) ? record.images : undefined;
  const item = collection?.[0];
  return item && typeof item === "object" ? item as Record<string, unknown> : undefined;
}

/** 调用可配置的 OpenAI-compatible 图片生成接口。 */
export async function generateImage(prompt: string, ratio: CoverRatio): Promise<GeneratedImage> {
  const apiKey = process.env.IMAGE_API_KEY?.trim();
  const apiUrl = process.env.IMAGE_API_URL?.trim();
  const model = process.env.IMAGE_MODEL?.trim();
  if (!apiKey) throw new ImageClientError("缺少 IMAGE_API_KEY，请在 .env 中配置图片生成 API Key。");
  if (!apiUrl) throw new ImageClientError("缺少 IMAGE_API_URL，请在 .env 中配置完整的图片生成接口地址。");
  if (!model) throw new ImageClientError("缺少 IMAGE_MODEL，请在 .env 中配置图片生成模型名称。");
  if (!prompt.trim()) throw new ImageClientError("封面提示词不能为空。");
  if (!(ratio in COVER_RATIOS)) throw new ImageClientError("不支持的封面比例。");

  const sizeField = process.env.IMAGE_API_SIZE_FIELD?.trim() || "size";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(sizeField)) {
    throw new ImageClientError("IMAGE_API_SIZE_FIELD 格式无效。");
  }
  const sizeValue = sizeField === "aspect_ratio" ? ratio : COVER_RATIOS[ratio].size;
  const body = {
    model,
    prompt: prompt.trim(),
    n: 1,
    response_format: "b64_json",
    [sizeField]: sizeValue,
    ...parseExtraBody(),
  };

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    throw new ImageClientError(`图片生成网络请求失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }

  let payload: unknown;
  try {
    const rawText = await response.text();
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new ImageClientError(
        `图片 API 返回了非 JSON 内容（HTTP ${response.status}，content-type: ${contentType || "未返回"}）。原始返回前 200 字符：${rawText.slice(0, 200).replace(/\s+/g, " ")}`,
      );
    }
    payload = JSON.parse(rawText);
  } catch (error) {
    if (error instanceof ImageClientError) throw error;
    throw new ImageClientError(`图片 API 返回的不是合法 JSON（HTTP ${response.status}）。`, { cause: error });
  }
  if (!response.ok) {
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
    const detail = typeof nested.message === "string" ? nested.message : typeof record.message === "string" ? record.message : "未知错误";
    throw new ImageClientError(`图片 API 报错（HTTP ${response.status}）：${detail}`);
  }

  const item = responseItem(payload);
  const base64 = item?.b64_json ?? item?.base64 ?? item?.image_base64;
  if (typeof base64 === "string" && base64) return decodeBase64(base64);

  const imageUrl = item?.url;
  if (typeof imageUrl === "string" && imageUrl) {
    try {
      const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(120_000) });
      if (!imageResponse.ok) throw new Error(`HTTP ${imageResponse.status}`);
      const mimeType = imageResponse.headers.get("content-type")?.split(";")[0] ?? "image/png";
      return {
        bytes: Buffer.from(await imageResponse.arrayBuffer()),
        mimeType,
        extension: mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png",
      };
    } catch (error) {
      throw new ImageClientError(`无法下载图片 API 返回的图片：${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  throw new ImageClientError("图片 API 返回为空，未找到 base64 图片或图片 URL。");
}
