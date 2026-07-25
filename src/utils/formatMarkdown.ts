/** 统一 Markdown 的换行和结尾，避免写出格式凌乱的文件。 */
export function formatMarkdown(content: string): string {
  return `${content.replace(/\r\n/g, "\n").trim()}\n`;
}
