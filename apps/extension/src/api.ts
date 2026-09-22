import { API_BASE_URL } from "./config";
import type { SupportedLanguage } from "../../web/src/lib/messages";

export interface ReadingArticle {
  id: number;
  title: string;
  sourceLanguage: string | null;
  canonicalUrl: string | null;
  publishedAt: string | null;
  feed: { id: number; title: string; faviconUrl: string | null };
  userState: { isRead: boolean; inReadingList: boolean; isBookmarked: boolean };
}

export interface SavedArticleResult {
  articleId: number;
  title: string;
  url: string;
  created: boolean;
}

export interface ExtensionUserSettings {
  language: SupportedLanguage;
}

type TokenGetter = () => Promise<string | null>;

export class ExtensionApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(getToken: TokenGetter, method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  if (!token) throw new ExtensionApiError(401, "ログインが必要です。");
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => null) as
    | { data?: T; meta?: { nextCursor?: string | null }; error?: { message?: string } }
    | null;
  if (!response.ok) {
    throw new ExtensionApiError(response.status, json?.error?.message ?? "APIへの接続に失敗しました。");
  }
  return json as T;
}

export function createExtensionApi(getToken: TokenGetter) {
  const get = <T>(path: string) => request<{ data: T; meta?: { nextCursor?: string | null } }>(getToken, "GET", path);
  const send = <T>(method: string, path: string, body?: unknown) =>
    request<{ data: T }>(getToken, method, path, body);
  const cache = new Map<string, { expiresAt: number; value?: unknown; inFlight?: Promise<unknown> }>();
  let authMarker: string | null | undefined;
  let cacheGeneration = 0;
  const prepareCache = async () => {
    const token = await getToken();
    const nextMarker = token ? `${token.length}:${token.slice(0, 8)}` : null;
    if (authMarker !== nextMarker) {
      authMarker = nextMarker;
      cacheGeneration += 1;
      cache.clear();
    }
  };
  const cached = async <T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> => {
    await prepareCache();
    const current = cache.get(key);
    if (current?.inFlight) return current.inFlight as Promise<T>;
    if (current && current.expiresAt > Date.now() && current.value !== undefined) return current.value as T;
    const generation = cacheGeneration;
    const inFlight = loader().then((value) => {
      if (cacheGeneration === generation) cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    }).finally(() => {
      const entry = cache.get(key);
      if (entry?.inFlight === inFlight) cache.set(key, { value: entry.value, expiresAt: entry.expiresAt });
    });
    cache.set(key, { value: current?.value, expiresAt: current?.expiresAt ?? 0, inFlight });
    return inFlight;
  };
  const invalidate = () => {
    cacheGeneration += 1;
    cache.clear();
  };

  return {
    getSettings: async () => cached("settings", 30_000, async () =>
      (await get<ExtensionUserSettings>("/api/v1/settings")).data,
    ),
    updateSettings: async (patch: { language: SupportedLanguage }) => {
      const value = (await send<ExtensionUserSettings>("PATCH", "/api/v1/settings", patch)).data;
      invalidate();
      return value;
    },
    listReadingArticles: async () => cached("reading-articles", 5_000, async () => {
      const articles: ReadingArticle[] = [];
      let cursor: string | null = null;
      do {
        const params = new URLSearchParams({ readingList: "true", limit: "100" });
        if (cursor) params.set("cursor", cursor);
        const response = await get<ReadingArticle[]>(`/api/v1/articles?${params}`);
        articles.push(...response.data);
        cursor = response.meta?.nextCursor ?? null;
      } while (cursor);
      return articles;
    }),
    importArticle: async (input: { url: string; title?: string }) => {
      const value = (await send<SavedArticleResult>("POST", "/api/v1/articles/import", input)).data;
      invalidate();
      return value;
    },
    removeFromReadingList: async (articleId: number) => {
      await send<unknown>("DELETE", `/api/v1/articles/${articleId}/reading-list`);
      invalidate();
    },
    setArticleRead: async (articleId: number, isRead: boolean) => {
      const value = (await send<ReadingArticle["userState"]>("PATCH", `/api/v1/articles/${articleId}/state`, { isRead })).data;
      invalidate();
      return value;
    },
    setReadingListMembership: async (articleId: number, active: boolean) => {
      const value = (await send<ReadingArticle["userState"]>(active ? "PUT" : "DELETE", `/api/v1/articles/${articleId}/reading-list`)).data;
      invalidate();
      return value;
    },
    setBookmarkMembership: async (articleId: number, active: boolean) => {
      const value = (await send<ReadingArticle["userState"]>(active ? "PUT" : "DELETE", `/api/v1/articles/${articleId}/bookmark`)).data;
      invalidate();
      return value;
    },
  };
}
