export class ApiPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiPayloadError";
  }
}

function responseFailureMessage(response: Response, contentType: string, raw: string): string {
  const status = response.status || 0;
  const normalizedType = contentType.toLowerCase();
  const isGatewayPage = normalizedType.includes("text/html") && [502, 503, 504].includes(status);
  if (isGatewayPage) {
    return `请求被部署网关中断（HTTP ${status}）。生成任务响应时间过长，请检查托管平台的函数时限。`;
  }
  const preview = raw.replace(/\s+/gu, " ").trim().slice(0, 120);
  return `接口返回了非 JSON 内容（HTTP ${status || "未知"}，content-type: ${contentType || "未返回"}${preview ? `，响应摘要：${preview}` : ""}）。请检查服务端日志。`;
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiPayloadError(responseFailureMessage(response, contentType, raw));
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ApiPayloadError(`接口返回了无效 JSON 内容（HTTP ${response.status || "未知"}）。请检查服务端日志。`);
  }
}

/** Reads the final payload from a server-sent event response. */
export async function readEventStreamJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (contentType.toLowerCase().includes("application/json")) {
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new ApiPayloadError(`生成接口返回了无效 JSON 内容（HTTP ${response.status || "未知"}）。请检查服务端日志。`);
    }
  }
  if (!contentType.toLowerCase().includes("text/event-stream")) {
    throw new ApiPayloadError(responseFailureMessage(response, contentType, raw));
  }

  const events = [...raw.matchAll(/(?:^|\n)event:\s*result\s*\ndata:\s*([^\n]+)(?:\n|$)/gu)];
  const payload = events.at(-1)?.[1];
  if (!payload) throw new ApiPayloadError(`生成连接已结束，但没有返回最终结果（HTTP ${response.status || "未知"}）。请检查服务端日志。`);
  try {
    return JSON.parse(payload) as T;
  } catch {
    throw new ApiPayloadError(`生成接口返回了无效的最终结果（HTTP ${response.status || "未知"}）。请检查服务端日志。`);
  }
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
