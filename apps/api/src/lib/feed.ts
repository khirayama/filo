import { XMLParser } from "fast-xml-parser";
import { sha256Hex } from "./util";

export interface ParsedFeedItem {
  guid: string | null;
  url: string | null;
  title: string;
  author: string | null;
  summary: string | null;
  contentHtml: string | null;
  publishedAt: string | null;
}

export interface ParsedFeed {
  title: string;
  siteUrl: string | null;
  selfUrl: string | null;
  description: string | null;
  language: string | null;
  items: ParsedFeedItem[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: false,
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(node: unknown): string | null {
  if (node === undefined || node === null) return null;
  if (typeof node === "string") return node || null;
  if (typeof node === "number") return String(node);
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const inner = obj["#text"] ?? obj["__cdata"];
    if (inner !== undefined) return text(inner);
  }
  return null;
}

function parseDate(raw: string | null): string | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function atomLink(links: unknown, rel: string | null): string | null {
  for (const link of asArray(links)) {
    if (typeof link === "string") {
      if (rel === null) return link;
      continue;
    }
    const obj = link as Record<string, unknown>;
    const linkRel = (obj["@_rel"] as string | undefined) ?? "alternate";
    if ((rel === null && linkRel === "alternate") || linkRel === rel) {
      const href = obj["@_href"] as string | undefined;
      if (href) return href;
    }
  }
  return null;
}

export function looksLikeFeed(body: string, contentType: string | null): boolean {
  if (contentType && /(rss|atom|xml)/i.test(contentType)) {
    return /<(rss|feed|rdf:RDF)[\s>]/i.test(body);
  }
  return /^\s*(<\?xml[\s\S]{0,512}?)?[\s\S]{0,512}<(rss|feed|rdf:RDF)[\s>]/i.test(body);
}

export function parseFeed(xml: string): ParsedFeed | null {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return null;
  }

  const rss = (doc["rss"] ?? doc["rdf:RDF"]) as Record<string, unknown> | undefined;
  if (rss) {
    const channel = (rss["channel"] ?? (doc["rdf:RDF"] as Record<string, unknown> | undefined)?.["channel"]) as
      | Record<string, unknown>
      | undefined;
    if (!channel) return null;
    const itemsSource = (rss["item"] as unknown) ?? channel["item"];
    const items = asArray(itemsSource).map((item) => {
      const it = item as Record<string, unknown>;
      const guid = text(it["guid"]);
      return {
        guid: guid || null,
        url: text(it["link"]) || null,
        title: text(it["title"]) ?? "(untitled)",
        author: text(it["author"]) ?? text(it["dc:creator"]) ?? null,
        summary: text(it["description"]) ?? null,
        contentHtml: text(it["content:encoded"]) ?? null,
        publishedAt: parseDate(text(it["pubDate"]) ?? text(it["dc:date"])),
      } satisfies ParsedFeedItem;
    });
    return {
      title: text(channel["title"]) ?? "(untitled feed)",
      siteUrl: text(channel["link"]) ?? null,
      selfUrl: atomLink(channel["atom:link"], "self"),
      description: text(channel["description"]) ?? null,
      language: text(channel["language"]) ?? null,
      items,
    };
  }

  const atom = doc["feed"] as Record<string, unknown> | undefined;
  if (atom) {
    const items = asArray(atom["entry"]).map((entry) => {
      const it = entry as Record<string, unknown>;
      const content = it["content"];
      const summary = it["summary"];
      const authorNode = asArray(it["author"])[0] as Record<string, unknown> | undefined;
      return {
        guid: text(it["id"]) || null,
        url: atomLink(it["link"], null),
        title: text(it["title"]) ?? "(untitled)",
        author: authorNode ? text(authorNode["name"]) : null,
        summary: text(summary),
        contentHtml: text(content),
        publishedAt: parseDate(text(it["published"]) ?? text(it["updated"])),
      } satisfies ParsedFeedItem;
    });
    return {
      title: text(atom["title"]) ?? "(untitled feed)",
      siteUrl: atomLink(atom["link"], null),
      selfUrl: atomLink(atom["link"], "self"),
      description: text(atom["subtitle"]) ?? null,
      language: (atom["@_xml:lang"] as string | undefined) ?? null,
      items,
    };
  }

  return null;
}

// guid > normalized canonical url > stable hash of title+published+author
export async function dedupeKeyFor(item: ParsedFeedItem): Promise<string> {
  if (item.guid) return `guid:${item.guid}`;
  if (item.url) return `url:${item.url}`;
  return `hash:${await sha256Hex(`${item.title}|${item.publishedAt ?? ""}|${item.author ?? ""}`)}`;
}

// <link rel="alternate" type="application/rss+xml" href="..."> in HTML head
export function discoverFeedUrlsInHtml(html: string, baseUrl: string): string[] {
  const head = html.slice(0, 200_000);
  const results: string[] = [];
  const linkTags = head.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    if (!/rel\s*=\s*["']?[^"'>]*alternate/i.test(tag)) continue;
    if (!/type\s*=\s*["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const value = href?.[2] ?? href?.[3] ?? href?.[4];
    if (!value) continue;
    try {
      results.push(new URL(value, baseUrl).toString());
    } catch {
      // skip invalid href
    }
  }
  return [...new Set(results)];
}

export const COMMON_FEED_PATHS = ["/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml"];
