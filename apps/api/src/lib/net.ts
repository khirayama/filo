import { ApiError, errors } from "./errors";

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (isPrivateIpv4(host)) return true;
  // IPv6 literal: loopback, link-local, unique-local
  if (host.includes(":")) {
    const v6 = host.replace(/^\[|\]$/g, "");
    if (v6 === "::1" || v6 === "::" || /^(fe80|fc|fd)/i.test(v6)) return true;
  }
  return false;
}

function assertSafeUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw errors.validation("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw errors.validation("Only http(s) URLs are allowed");
  }
  if (isBlockedHost(url.hostname)) {
    throw new ApiError(400, "feed_unreachable", "URL is not reachable");
  }
  return url;
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export interface SafeFetchResult {
  response: Response;
  // URL that produced the returned response, after following redirects.
  finalUrl: string;
  // True when at least one redirect was followed and every hop was 301/308,
  // i.e. the resource has permanently moved to finalUrl.
  permanentRedirect: boolean;
}

// fetch with SSRF guard applied to every redirect hop and a hard timeout.
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const {
    headers = {},
    timeoutMs = 10_000,
    maxRedirects = 5,
    maxAttempts = 2,
    retryDelayMs = 250,
  } = options;
  const attempts = Number.isFinite(maxAttempts) ? Math.max(1, Math.floor(maxAttempts)) : 1;

  for (let attempt = 0; attempt < attempts; attempt++) {
    let current = assertSafeUrl(rawUrl);
    let followedHops = 0;
    let allHopsPermanent = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      for (let hop = 0; hop <= maxRedirects; hop++) {
        const response = await fetch(current.toString(), {
          headers: { "User-Agent": "FiloBot/1.0 (+https://filo.app)", ...headers },
          redirect: "manual",
          signal: controller.signal,
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("Location");
          if (!location) return { response, finalUrl: current.toString(), permanentRedirect: false };
          if (response.status !== 301 && response.status !== 308) allHopsPermanent = false;
          current = assertSafeUrl(new URL(location, current).toString());
          followedHops++;
          continue;
        }
        return {
          response,
          finalUrl: current.toString(),
          permanentRedirect: followedHops > 0 && allHopsPermanent,
        };
      }
      throw new ApiError(400, "feed_unreachable", "Too many redirects");
    } catch (error) {
      // Retry only transport failures. Validation and redirect policy errors
      // are deterministic and must not be hidden by another request.
      if (error instanceof ApiError) throw error;
    } finally {
      clearTimeout(timer);
    }

    if (attempt + 1 < attempts && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  // Keep the public error deliberately generic: remote fetch errors can
  // contain implementation or network details that should not be exposed.
  throw new ApiError(400, "feed_unreachable", "Could not reach URL");
}

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

// Read a response body with a byte cap so oversized remote documents cannot
// exhaust Worker memory. Bodies are decoded as UTF-8, same as Response.text().
export async function readTextCapped(response: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new ApiError(400, "feed_unreachable", "Response body too large");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|yclid$|mc_cid$|mc_eid$)/;

function canonicalizeUrlWithOptions(rawUrl: string, stripTrailingSlash: boolean): string {
  const url = new URL(rawUrl);
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase();
  if (url.port === "443") {
    url.port = "";
  }
  const keep: [string, string][] = [];
  url.searchParams.forEach((value, key) => {
    if (!TRACKING_PARAMS.test(key.toLowerCase())) keep.push([key, value]);
  });
  url.search = "";
  for (const [key, value] of keep) url.searchParams.append(key, value);
  url.hash = "";
  if (stripTrailingSlash && url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

// Article URLs use a trailing-slash-insensitive dedupe key. Feed endpoints do
// not: /feed and /feed/ can be different resources on a publisher's server.
export function canonicalizeUrl(rawUrl: string): string {
  return canonicalizeUrlWithOptions(rawUrl, true);
}

export function canonicalizeFeedUrl(rawUrl: string): string {
  return canonicalizeUrlWithOptions(rawUrl, false);
}

export function alternateTrailingSlashUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.pathname === "/") return null;
  url.pathname = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : `${url.pathname}/`;
  return url.toString();
}
