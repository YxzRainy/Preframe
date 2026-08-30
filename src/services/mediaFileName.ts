/** 用于素材匹配的稳定文件名规范化。 */
export function normalizeMediaFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return base
    .toLowerCase()
    .replace(/[_\-./\\]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(final|成片|cut|export|render|v\d+)\b/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
