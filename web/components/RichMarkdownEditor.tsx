"use client";

import { memo, useCallback, type FormEvent, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface RichMarkdownEditorProps {
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  onSave: () => void;
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.replace(/\u00a0/g, " ") || "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as HTMLElement;
  const content = Array.from(element.childNodes).map(inlineMarkdown).join("");
  switch (element.tagName) {
    case "BR": return "\n";
    case "STRONG":
    case "B": return `**${content}**`;
    case "EM":
    case "I": return `*${content}*`;
    case "DEL":
    case "S": return `~~${content}~~`;
    case "CODE": return `\`${content}\``;
    case "A": {
      const href = element.getAttribute("href");
      return href ? `[${content}](${href})` : content;
    }
    default: return content;
  }
}

function listItemMarkdown(element: HTMLElement): string {
  return Array.from(element.childNodes)
    .filter((node) => !(node.nodeType === Node.ELEMENT_NODE && ["UL", "OL"].includes((node as HTMLElement).tagName)))
    .map(inlineMarkdown)
    .join("")
    .trim();
}

function blockMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.trim() ? `${node.textContent}\n\n` : "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as HTMLElement;
  const inline = inlineMarkdown(element).trim();
  switch (element.tagName) {
    case "H1": return `# ${inline}\n\n`;
    case "H2": return `## ${inline}\n\n`;
    case "H3": return `### ${inline}\n\n`;
    case "H4": return `#### ${inline}\n\n`;
    case "H5": return `##### ${inline}\n\n`;
    case "H6": return `###### ${inline}\n\n`;
    case "P":
    case "DIV": return inline ? `${inline}\n\n` : "\n";
    case "BLOCKQUOTE": return inline.split("\n").map((line) => `> ${line}`).join("\n") + "\n\n";
    case "UL": return Array.from(element.children)
      .filter((child) => child.tagName === "LI")
      .map((child) => `- ${listItemMarkdown(child as HTMLElement)}`)
      .join("\n") + "\n\n";
    case "OL": return Array.from(element.children)
      .filter((child) => child.tagName === "LI")
      .map((child, index) => `${index + 1}. ${listItemMarkdown(child as HTMLElement)}`)
      .join("\n") + "\n\n";
    case "PRE": return `\`\`\`\n${element.textContent?.trim() || ""}\n\`\`\`\n\n`;
    case "HR": return "---\n\n";
    default: return inline ? `${inline}\n\n` : "";
  }
}

function serializeMarkdown(element: HTMLElement): string {
  const markdown = Array.from(element.childNodes).map(blockMarkdown).join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return markdown ? `${markdown}\n` : "";
}

export const RichMarkdownEditor = memo(function RichMarkdownEditor({ initialMarkdown, onChange, onSave }: RichMarkdownEditorProps) {
  const handleInput = useCallback((event: FormEvent<HTMLElement>) => {
    onChange(serializeMarkdown(event.currentTarget));
  }, [onChange]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      onSave();
    }
  }, [onSave]);

  return (
    <article
      className="markdown-body document-rich-editor"
      contentEditable
      role="textbox"
      aria-label="编辑文档正文"
      aria-multiline="true"
      suppressContentEditableWarning
      spellCheck
      onInput={handleInput}
      onKeyDown={handleKeyDown}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{initialMarkdown}</ReactMarkdown>
    </article>
  );
});
