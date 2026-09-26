import { API_BASE_URL } from "./config";
import { clearToken, getToken } from "./auth";
import type { SupportedLanguage } from "../../web/src/lib/messages";
import type { ReaderItem } from "./reader";

interface ReadingArticle {
  id: number;
  title: string;
  canonicalUrl: string | null;
  feed: { title: string };
  userState: { isRead: boolean };
}

interface ArticleContent {
  status: "not_requested" | "pending" | "ready" | "error";
  sourceLanguage?: string | null;
  text?: string | null;
}

export class ExtensionApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
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
  if (response.status === 401) {
    await clearToken();
    throw new ExtensionApiError(401, "ログインが必要です。");
  }
  if (!response.ok) throw new ExtensionApiError(response.status, json?.error?.message ?? "APIへの接続に失敗しました。");
  return json as T;
}

function toReaderItem(article: ReadingArticle): ReaderItem | null {
  if (!article.canonicalUrl) return null;
  return {
    articleId: article.id,
    title: article.title,
    url: article.canonicalUrl,
    feedTitle: article.feed.title,
    isRead: article.userState.isRead,
  };
}

export const api = {
  async getSettings(): Promise<{ language: SupportedLanguage }> {
    return (await request<{ data: { language: SupportedLanguage } }>("GET", "/api/v1/settings")).data;
  },
  // The reading list in its canonical order (the same query the apps use).
  async listReadingList(): Promise<ReaderItem[]> {
    const items: ReaderItem[] = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ readingList: "true", limit: "100" });
      if (cursor) params.set("cursor", cursor);
      const page = await request<{ data: ReadingArticle[]; meta?: { nextCursor?: string | null } }>("GET", `/api/v1/articles?${params}`);
      for (const article of page.data) {
        const item = toReaderItem(article);
        if (item) items.push(item);
      }
      cursor = page.meta?.nextCursor ?? null;
    } while (cursor);
    return items;
  },
  async importArticle(input: { url: string; title?: string }): Promise<void> {
    await request("POST", "/api/v1/articles/import", input);
  },
  async removeFromReadingList(articleId: number): Promise<void> {
    await request("DELETE", `/api/v1/articles/${articleId}/reading-list`);
  },
  async markRead(articleId: number): Promise<void> {
    await request("PATCH", `/api/v1/articles/${articleId}/state`, { isRead: true });
  },
  // Server-side extraction, used when the page itself yields no readable text.
  async fetchArticleText(articleId: number): Promise<{ text: string; lang: string | null } | null> {
    await request("POST", `/api/v1/articles/${articleId}/content`, {});
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const content = (await request<{ data: ArticleContent }>("GET", `/api/v1/articles/${articleId}/content`)).data;
      if (content.status === "ready" && content.text) return { text: content.text, lang: content.sourceLanguage ?? null };
      if (content.status === "error") return null;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return null;
  },
};
