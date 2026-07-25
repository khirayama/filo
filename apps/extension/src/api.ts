const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8787";

export interface LookupResult {
  id: number;
  title: string;
  canonicalUrl: string;
  sourceLanguage: string | null;
  inQueue: boolean;
}

async function request<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let requestBody: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }
  const response = await fetch(`${API_BASE_URL}${path}`, { method, headers, body: requestBody });
  if (!response.ok) {
    const json = await response.json().catch(() => null) as { error?: { message: string } } | null;
    throw new Error(json?.error?.message ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function lookupArticleByUrl(token: string, url: string): Promise<LookupResult | null> {
  try {
    const res = await request<{ data: LookupResult }>(token, "GET", `/api/v1/articles/lookup?url=${encodeURIComponent(url)}`);
    return res.data;
  } catch {
    return null;
  }
}

export async function addToQueue(token: string, articleId: number): Promise<boolean> {
  try {
    await request(token, "POST", "/api/v1/playback-queue/items", { articleIds: [articleId] });
    // 音読キュー追加時に必要な範囲で本文を取得・解決する(他端末の連続再生用)
    await request(token, "POST", `/api/v1/articles/${articleId}/content`, {}).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export async function removeFromQueue(token: string, articleId: number): Promise<boolean> {
  try {
    await request(token, "DELETE", `/api/v1/playback-queue/items/${articleId}`);
    return true;
  } catch {
    return false;
  }
}

export interface ServerQueueItem {
  articleId: number;
  sortOrder: number;
  article: {
    id: number;
    title: string;
    originalTitle: string;
    sourceLanguage: string | null;
    canonicalUrl: string | null;
    publishedAt: string | null;
    feed: { id: number; title: string; faviconUrl: string | null };
  };
  createdAt: string | null;
}

export interface ServerPlaybackState {
  currentArticleId: number | null;
  contentLanguage: string | null;
  positionPercent: number;
  updatedAt: string | null;
}

export async function getPlaybackQueue(
  token: string,
): Promise<{ items: ServerQueueItem[]; playbackState: ServerPlaybackState | null } | null> {
  try {
    const res = await request<{ data: { items: ServerQueueItem[]; playbackState: ServerPlaybackState | null } }>(
      token,
      "GET",
      "/api/v1/playback-queue",
    );
    return res.data;
  } catch {
    return null;
  }
}

export interface SpeechSource {
  text: string;
  lang: string | null;
}

// 読み上げ対象本文の解決: 抽出本文 > RSS本文。本文翻訳は扱わない(プラットフォーム翻訳に委ねる)
export async function fetchSpeechText(
  token: string,
  articleId: number,
): Promise<SpeechSource | null> {
  try {
    const content = await request<{
      data: {
        status: string;
        sourceLanguage?: string | null;
        text?: string | null;
        html?: string | null;
      };
    }>(token, "GET", `/api/v1/articles/${articleId}/content`).then((r) => r.data);
    if (content.status === "ready" && (content.text || content.html)) {
      return { text: content.text ?? content.html ?? "", lang: content.sourceLanguage ?? null };
    }
  } catch {
    // RSS 本文へフォールバック
  }
  try {
    const detail = await request<{
      data: { rssContentHtml: string | null; rssSummary: string | null; sourceLanguage: string | null };
    }>(token, "GET", `/api/v1/articles/${articleId}`).then((r) => r.data);
    const raw = detail.rssContentHtml ?? detail.rssSummary;
    if (!raw) return null;
    return { text: raw, lang: detail.sourceLanguage };
  } catch {
    return null;
  }
}

export async function markArticleRead(token: string, articleId: number): Promise<void> {
  await request(token, "PATCH", `/api/v1/articles/${articleId}/state`, { isRead: true }).catch(() => {});
}

export async function patchPlaybackState(
  token: string,
  patch: { currentArticleId?: number | null; positionPercent?: number },
): Promise<void> {
  await request(token, "PATCH", "/api/v1/playback-queue/state", patch).catch(() => {});
}
