import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { htmlToText, sanitizeHtml } from "./util";

export interface ExtractedContent {
  text: string;
  html: string;
}

function readableText(article: { title?: string | null; content?: string | null; textContent?: string | null }, fallbackTitle?: string | null): string {
  const title = (article.title?.trim() || fallbackTitle || "").replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  if (article.content) {
    const { document } = parseHTML(article.content);
    const blockTags = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "LI", "BLOCKQUOTE", "PRE", "FIGCAPTION", "DT", "DD"]);
    const visit = (node: any) => {
      for (const child of Array.from(node.childNodes ?? []) as any[]) {
        if (child.nodeType !== 1) continue;
        if (blockTags.has(child.tagName)) {
          const value = String(child.textContent ?? "").replace(/\s+/g, " ").trim();
          if (value) lines.push(value);
        } else visit(child);
      }
    };
    visit(document);
  }
  if (lines.length === 0) lines.push(...String(article.textContent ?? "").split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean));
  return [title, ...(title && lines[0] === title ? lines.slice(1) : lines)].filter(Boolean).join("\n\n");
}

export function extractFromHtml(rawHtml: string, url: string, title?: string | null): ExtractedContent | null {
  const { document } = parseHTML(rawHtml);
  const robots = document.querySelector('meta[name="robots"], meta[name="googlebot"]')?.getAttribute("content")?.toLowerCase() ?? "";
  if (robots.includes("noarchive") || robots.includes("noindex")) return null;
  const base = document.createElement("base");
  base.setAttribute("href", url);
  document.head.appendChild(base);
  // Readability expects a browser Document; linkedom supplies the compatible shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const article = new Readability(document as any, { charThreshold: 100 }).parse();
  const text = article ? readableText(article, title) : "";
  if (text.length < 100) return null;
  return { text, html: sanitizeHtml(article?.content ?? "") };
}

const RSS_CONTENT_MIN_LENGTH = 500;

export function extractFromRssContent(
  rssContentHtml: string | null,
  rssSummary: string | null,
  title?: string | null,
): ExtractedContent | null {
  const source = rssContentHtml ?? rssSummary;
  if (!source) return null;
  const text = readableText({ content: source }, title) || htmlToText(source);
  if (text.length < RSS_CONTENT_MIN_LENGTH) return null;
  return { text, html: sanitizeHtml(source) };
}
