import { ApiError } from "./errors";
import { COMMON_FEED_PATHS, discoverFeedUrlsInHtml, looksLikeFeed, parseFeed, type ParsedFeed } from "./feed";
import { alternateTrailingSlashUrl, canonicalizeFeedUrl, readTextCapped, safeFetch } from "./net";

export interface DiscoveredFeed {
  feedUrl: string;
  parsed: ParsedFeed;
}

function sameEndpoint(left: string, right: string): boolean {
  return left.replace(/\/+$/, "") === right.replace(/\/+$/, "");
}

async function servesParseableFeed(url: string): Promise<boolean> {
  try {
    const { response } = await safeFetch(url, {
      headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    });
    if (!response.ok) return false;
    return parseFeed(await readTextCapped(response)) !== null;
  } catch {
    return false;
  }
}

// Prefer a feed's same-origin self link: it is the publisher's canonical
// endpoint and retains meaningful path slashes. Do not follow a self link to a
// different origin merely because the feed document declares one, and a self
// link naming a different endpoint is trusted only after it proves to serve a
// feed — some publishers point rel="self" at their HTML homepage.
export async function resolveCanonicalFeedUrl(parsed: ParsedFeed, fetchedUrl: string): Promise<string> {
  const fallback = canonicalizeFeedUrl(fetchedUrl);
  if (!parsed.selfUrl) return fallback;
  let canonical: string;
  try {
    const fetched = new URL(fetchedUrl);
    const self = new URL(parsed.selfUrl, fetched);
    if ((self.protocol !== "http:" && self.protocol !== "https:") || self.origin !== fetched.origin) {
      return fallback;
    }
    canonical = canonicalizeFeedUrl(self.toString());
  } catch {
    return fallback;
  }
  if (sameEndpoint(canonical, fallback)) return canonical;
  return (await servesParseableFeed(canonical)) ? canonical : fallback;
}

async function tryFetchFeed(url: string): Promise<DiscoveredFeed | null> {
  const alternate = alternateTrailingSlashUrl(url);
  const candidates = alternate ? [url, alternate] : [url];
  for (const candidate of candidates) {
    try {
      const { response, finalUrl } = await safeFetch(candidate, {
        headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8" },
      });
      if (!response.ok) continue;
      const contentType = response.headers.get("Content-Type");
      const body = await readTextCapped(response);
      if (!looksLikeFeed(body, contentType)) continue;
      const parsed = parseFeed(body);
      if (!parsed) continue;
      return { feedUrl: await resolveCanonicalFeedUrl(parsed, finalUrl), parsed };
    } catch {
      // Try the alternate slash form before treating this as a non-feed URL.
    }
  }
  return null;
}

// Accepts an RSS/Atom URL or a site URL; resolves to the first valid feed candidate.
export async function discoverFeed(inputUrl: string): Promise<DiscoveredFeed> {
  const direct = await tryFetchFeed(inputUrl);
  if (direct) return direct;

  let response: Response;
  try {
    ({ response } = await safeFetch(inputUrl, { headers: { Accept: "text/html,application/xhtml+xml" } }));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "feed_unreachable", "Could not reach URL");
  }
  if (!response.ok) {
    throw new ApiError(400, "feed_unreachable", `URL responded with status ${response.status}`);
  }

  const html = await readTextCapped(response);
  const candidates = discoverFeedUrlsInHtml(html, inputUrl);
  for (const candidate of candidates) {
    const found = await tryFetchFeed(candidate);
    if (found) return found;
  }

  const base = new URL(inputUrl);
  for (const path of COMMON_FEED_PATHS) {
    const candidate = new URL(path, `${base.protocol}//${base.host}`).toString();
    const found = await tryFetchFeed(candidate);
    if (found) return found;
  }

  throw new ApiError(400, "feed_discovery_failed", "No valid feed candidate found");
}

function discoverFaviconUrlInHtml(html: string, baseUrl: string): string | null {
  const head = html.slice(0, 200_000);
  const linkTags = head.match(/<link\b[^>]*>/gi) ?? [];
  let best: { url: string; size: number } | null = null;
  for (const tag of linkTags) {
    if (!/rel\s*=\s*["']?[^"'>]*(icon|shortcut icon)/i.test(tag)) continue;
    // skip apple-touch-icon (too large / not standard favicon)
    if (/rel\s*=\s*["']?apple-touch-icon/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const value = href?.[2] ?? href?.[3] ?? href?.[4];
    if (!value) continue;
    try {
      const url = new URL(value, baseUrl).toString();
      const sizeMatch = tag.match(/sizes\s*=\s*["']?(\d+)/i);
      const size = sizeMatch ? Number(sizeMatch[1]) : 0;
      if (!best || (size > 0 && size <= 64 && (best.size === 0 || size > best.size))) {
        best = { url, size };
      }
    } catch {
      // skip invalid href
    }
  }
  return best?.url ?? null;
}

export async function faviconUrlFor(siteUrl: string | null, feedUrl: string): Promise<string | null> {
  const siteBase = siteUrl ?? feedUrl;
  try {
    const { response } = await safeFetch(siteBase, {
      headers: { Accept: "text/html,application/xhtml+xml" },
      timeoutMs: 5_000,
    });
    if (response.ok) {
      const html = await readTextCapped(response);
      const found = discoverFaviconUrlInHtml(html, siteBase);
      if (found) return found;
    }
  } catch {
    // fall through to /favicon.ico
  }
  try {
    const base = new URL(siteBase);
    return `${base.protocol}//${base.host}/favicon.ico`;
  } catch {
    return null;
  }
}
