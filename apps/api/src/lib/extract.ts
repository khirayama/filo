import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { htmlToText, sanitizeHtml } from "./util";

export interface ExtractedContent {
  text: string;
  html: string;
}

export function extractFromHtml(rawHtml: string, url: string): ExtractedContent | null {
  const { document } = parseHTML(rawHtml);
  const robots = document.querySelector('meta[name="robots"], meta[name="googlebot"]')?.getAttribute("content")?.toLowerCase() ?? "";
  if (robots.includes("noarchive") || robots.includes("noindex")) return null;
  const base = document.createElement("base");
  base.setAttribute("href", url);
  document.head.appendChild(base);
  // Readability expects a browser Document; linkedom supplies the compatible shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const article = new Readability(document as any, { charThreshold: 100 }).parse();
  const text = article?.textContent?.trim() ?? "";
  if (text.length < 100) return null;
  return { text, html: sanitizeHtml(article?.content ?? "") };
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
  return { text, html: sanitizeHtml(source) };
}
