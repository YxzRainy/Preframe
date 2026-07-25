/** 将用户输入转换为跨平台安全的文件或目录名，并保留中文。 */
export function sanitizeFilename(input: string, fallback = "未命名项目"): string {
  const sanitized = input
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 80);
  return sanitized || fallback;
}
