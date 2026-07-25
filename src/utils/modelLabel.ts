/** 将环境变量中的模型标识格式化为适合界面展示的名称。 */
export function formatModelLabel(model: string): string {
  const normalized = model.trim();
  if (!normalized) return "DeepSeek";
  if (/^deepseek-v4-pro$/i.test(normalized)) return "DeepSeek V4 Pro";
  if (/^deepseek-v4-flash$/i.test(normalized)) return "DeepSeek V4 Flash";
  return normalized
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.toLowerCase() === "deepseek" ? "DeepSeek" : part.toUpperCase() === "V4" ? "V4" : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
