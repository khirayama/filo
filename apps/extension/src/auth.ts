import { API_BASE_URL } from "./config";

const KEY = "filo:betterAuthToken";
export async function getToken(): Promise<string | null> { const value = (await chrome.storage.local.get(KEY))[KEY]; return typeof value === "string" ? value : null; }
export async function refreshToken(): Promise<string | null> {
  const current = await getToken(); if (!current) return null;
  const response = await fetch(`${API_BASE_URL}/api/auth/get-session`, { headers: { Authorization: `Bearer ${current}` } });
  const session = await response.json().catch(() => null) as { session?: unknown; user?: unknown } | null;
  if (!response.ok || !session?.session || !session.user) {
    await chrome.storage.local.remove(KEY);
    return null;
  }
  const next = response.headers.get("set-auth-token");
  if (next) { await chrome.storage.local.set({ [KEY]: next }); return next; }
  return current;
}
export async function signIn(email: string, password: string): Promise<void> { await authenticate("sign-in", { email, password }); }
export async function signUp(email: string, password: string): Promise<void> {
  await authenticate("sign-up", { email, password, name: email.split("@")[0] ?? "Filo user" });
}
async function authenticate(action: string, body: Record<string, string>): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/auth/${action}/email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error("認証に失敗しました。");
  const token = response.headers.get("set-auth-token");
  if (token) await chrome.storage.local.set({ [KEY]: token });
  else throw new Error("認証トークンを取得できませんでした。");
}
export async function signOut(): Promise<void> {
  const current = await getToken();
  try {
    if (current) {
      await fetch(`${API_BASE_URL}/api/auth/sign-out`, { method: "POST", headers: { Authorization: `Bearer ${current}` } });
    }
  } catch {
    // Local sign-out must still succeed if the network is unavailable.
  } finally {
    await chrome.storage.local.remove(KEY);
  }
}
