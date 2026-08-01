import { API_BASE_URL } from "./config";

export interface ReadingArticle {
  id: number;
  title: string;
  sourceLanguage: string | null;
  canonicalUrl: string | null;
  publishedAt: string | null;
  feed: { id: number; title: string; faviconUrl: string | null };
  userState: { isRead: boolean; inReadingList: boolean; isBookmarked: boolean };
}

export interface ReadingSessionItem {
  articleId: number;
  sortOrder: number;
  article: {
    id: number;
    title: string;
    sourceLanguage: string | null;
    canonicalUrl: string | null;
    publishedAt: string | null;
    feed: { id: number; title: string; faviconUrl: string | null };
  };
  createdAt: string | null;
}

export interface PlaybackState {
  currentArticleId: number | null;
  contentLanguage: string | null;
  positionPercent: number;
  updatedAt: string | null;
}

export interface ReadingSession {
  items: ReadingSessionItem[];
  playbackState: PlaybackState | null;
}

export interface SavedArticleResult {
  articleId: number;
  title: string;
  url: string;
  created: boolean;
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

  return {
    listReadingArticles: async () => {
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
    },
    importArticle: async (input: { url: string; title?: string }) =>
      (await send<SavedArticleResult>("POST", "/api/v1/articles/import", input)).data,
    getLanguage: async () => (await get<{ language: string }>("/api/v1/settings")).data.language,
    startReadingSession: async () => (await send<ReadingSession>("POST", "/api/v1/playback-queue/start")).data,
    removeFromReadingList: async (articleId: number) => {
      await send<unknown>("DELETE", `/api/v1/articles/${articleId}/reading-list`);
    },
    removeReadArticlesFromReadingList: async () => {
      await send<unknown>("DELETE", "/api/v1/articles/reading-list/read");
    },
    setArticleRead: async (articleId: number) => {
      await send<unknown>("PATCH", `/api/v1/articles/${articleId}/state`, { isRead: true });
    },
    updatePlaybackState: async (state: Pick<PlaybackState, "currentArticleId" | "contentLanguage" | "positionPercent">) => {
      await send<unknown>("PATCH", "/api/v1/playback-queue/state", state);
    },
  };
}
