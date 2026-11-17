import { API_BASE_URL } from "./config";

// The session token lives in the extension origin's IndexedDB. chrome.storage
// .local is also readable from content scripts, which this extension injects
// into arbitrary pages to read them; IndexedDB of the extension origin is not.
// Only a non-secret flag goes to storage.local, so the popup can follow
// sign-in changes through storage.onChanged.
const DB_NAME = "filo";
const STORE = "auth";
const TOKEN = "token";
export const SIGNED_IN_KEY = "filo:signedIn";

interface AuthErrorResponse {
  code?: string;
  message?: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, use: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = use(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function getToken(): Promise<string | null> {
  const value = await withStore<unknown>("readonly", (store) => store.get(TOKEN));
  return typeof value === "string" ? value : null;
}

async function setToken(value: string): Promise<void> {
  await withStore("readwrite", (store) => store.put(value, TOKEN));
  await chrome.storage.local.set({ [SIGNED_IN_KEY]: true });
}

export async function clearToken(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(TOKEN));
  await chrome.storage.local.remove(SIGNED_IN_KEY);
}

// Validates the stored session once (when the popup opens) and stores a
// rotated token if the server issued one. API requests use the stored token
// directly and clear it on 401.
export async function refreshToken(): Promise<string | null> {
  const current = await getToken();
  if (!current) {
    // Keep the popup's flag in step with a token store that was cleared.
    await chrome.storage.local.remove(SIGNED_IN_KEY);
    return null;
  }
  const response = await fetch(`${API_BASE_URL}/api/auth/get-session`, { headers: { Authorization: `Bearer ${current}` } });
  // A server or rate-limit error says nothing about the session; keep it.
  if (!response.ok && response.status !== 401) return current;
  const session = await response.json().catch(() => null) as { session?: unknown; user?: unknown } | null;
  if (!response.ok || !session?.session || !session.user) {
    await clearToken();
    return null;
  }
  const next = response.headers.get("set-auth-token");
  if (next) {
    await setToken(next);
    return next;
  }
  return current;
}

export async function signIn(email: string, password: string): Promise<void> {
  await authenticate("sign-in", { email: email.trim(), password });
}

export async function signUp(email: string, password: string): Promise<void> {
  const normalizedEmail = email.trim();
  await authenticate("sign-up", { email: normalizedEmail, password, name: normalizedEmail.split("@")[0] || "Filo user" });
}

async function authenticate(action: string, body: Record<string, string>): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/auth/${action}/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as AuthErrorResponse | null;
    throw new Error(error?.message ?? "認証に失敗しました。");
  }
  const token = response.headers.get("set-auth-token");
  if (!token) throw new Error("認証トークンを取得できませんでした。");
  await setToken(token);
}

export async function signOut(): Promise<void> {
  const current = await getToken();
  try {
    if (current) {
      await fetch(`${API_BASE_URL}/api/auth/sign-out`, {
        method: "POST",
        headers: { Authorization: `Bearer ${current}`, "Content-Type": "application/json" },
        body: "{}",
      });
    }
  } catch {
    // Local sign-out must still succeed if the network is unavailable.
  } finally {
    await clearToken();
  }
}
