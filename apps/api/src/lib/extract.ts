import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { htmlToText, sanitizeHtml } from "./util";

export interface ExtractedContent {
  text: string;
  html: string;
}

export function extractFromHtml(rawHtml: string, url: string): ExtractedContent | null {
  const { document } = parseHTML(rawHtml);

  const base = document.createElement("base");
  base.setAttribute("href", url);
  document.head.appendChild(base);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reader = new Readability(document as any);
  const article = reader.parse();
  if (!article?.textContent || article.textContent.trim().length < 100) return null;

  const text = article.textContent.trim();
  const html = sanitizeHtml(article.content ?? "");
  return { text, html };
}

const RSS_CONTENT_MIN_LENGTH = 500;

export function extractFromRssContent(
  rssContentHtml: string | null,
  rssSummary: string | null,
): ExtractedContent | null {
  const source = rssContentHtml ?? rssSummary;
  if (!source) return null;

  const text = htmlToText(source);
  if (text.length < RSS_CONTENT_MIN_LENGTH) return null;

  const html = sanitizeHtml(source);
  return { text, html };
}
