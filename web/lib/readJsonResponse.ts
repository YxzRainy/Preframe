export class ApiPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiPayloadError";
  }
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiPayloadError("接口返回了非 JSON 内容，请检查服务端日志或模型服务响应。");
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ApiPayloadError("接口返回了无效 JSON 内容，请检查服务端日志或模型服务响应。");
  }
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
