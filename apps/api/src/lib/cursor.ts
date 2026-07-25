import { errors } from "./errors";

export interface ArticleCursor {
  // sort timestamp of the last row (null only for published_at_desc null-tail)
  ts: string | null;
  id: number;
  // effective is_read (0/1) of the last row — unread articles sort first
  r: number;
}

function b64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function hmac(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

export async function encodeCursor(secret: string, sort: string, cursor: ArticleCursor): Promise<string> {
  const payload = JSON.stringify({ s: sort, ts: cursor.ts, id: cursor.id, r: cursor.r });
  const sig = b64urlEncode((await hmac(secret, payload)).slice(0, 16));
  return `${b64urlEncode(new TextEncoder().encode(payload))}.${sig}`;
}

export async function decodeCursor(secret: string, sort: string, raw: string): Promise<ArticleCursor> {
  const [body, sig] = raw.split(".");
  if (!body || !sig) throw errors.invalidCursor();
  let payload: string;
  try {
    payload = new TextDecoder().decode(b64urlDecode(body));
  } catch {
    throw errors.invalidCursor();
  }
  const expected = b64urlEncode((await hmac(secret, payload)).slice(0, 16));
  if (expected !== sig) throw errors.invalidCursor();
  let parsed: { s?: string; ts?: string | null; id?: number; r?: number };
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw errors.invalidCursor();
  }
  if (parsed.s !== sort || typeof parsed.id !== "number" || typeof parsed.r !== "number") throw errors.invalidCursor();
  return { ts: parsed.ts ?? null, id: parsed.id, r: parsed.r };
}
