import { ApiError } from "./errors";

export function nowIso(): string {
  return new Date().toISOString();
}

// D1 default CURRENT_TIMESTAMP stores "YYYY-MM-DD HH:MM:SS"; app writes ISO.
// Normalize both shapes to ISO 8601 UTC for API responses.
export function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.includes("T")) return value;
  return `${value.replace(" ", "T")}Z`;
}

export function intToBool(value: number | null | undefined): boolean {
  return value === 1;
}

export function isoOffset(minutes: number, from = Date.now()): string {
  return new Date(from + minutes * 60_000).toISOString();
}

export function parseId(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new ApiError(400, "validation_error", "invalid id");
  return Number(raw);
}

export function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return 20;
  if (!/^\d+$/.test(raw)) throw new RangeError("limit must be an integer");
  const limit = Number(raw);
  if (limit < 1 || limit > 100) throw new RangeError("limit must be between 1 and 100");
  return limit;
}

export function normalizeTagName(name: string): string {
  return name.trim().normalize("NFKC").toLowerCase();
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const body = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${prefix}_${body}`;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|iframe|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<img\b[^>]*\salt\s*=\s*"([^"]{4,200})"[^>]*>/gi, " $1 ")
    .replace(/<img\b[^>]*\salt\s*=\s*'([^']{4,200})'[^>]*>/gi, " $1 ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

// Strip dangerous markup while keeping basic article formatting.
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<(script|style|noscript|iframe|object|embed|template|form)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|noscript|iframe|object|embed|template|form)\b[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, "");
}

export function previewFrom(text: string | null | undefined, max = 200): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
