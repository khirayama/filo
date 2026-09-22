import type {
  ArticleListFilters,
  ArticleListItem,
  ArticleUserState,
  BootstrapData,
  RefreshResult,
  DeletionAccepted,
  DeletionStatus,
  ListMeta,
  MarkAllReadResult,
  OpmlImportJob,
  Settings,
  StatusOverview,
  Subscription,
  Tag,
  SavedArticleResult,
  UnreadCounts,
  UnreadCountScope,
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

interface CacheEntry {
  expiresAt: number;
  value?: unknown;
  inFlight?: Promise<unknown>;
}

const responseCache = new Map<string, CacheEntry>();
const cacheEpoch = new Map<string, number>();

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

type TokenGetter = () => Promise<string | null>;

async function request<T>(
  getToken: TokenGetter,
  method: string,
  path: string,
  body?: unknown,
  options: { formData?: FormData; skipAuth?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (!options.skipAuth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let requestBody: BodyInit | undefined;
  if (options.formData) {
    requestBody = options.formData;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { method, headers, body: requestBody, credentials: "include" });
  } catch {
    throw new ApiRequestError(0, "network_error", "Network error");
  }

  if (response.status === 204) return undefined as T;
  const json = (await response.json().catch(() => null)) as
    | { data?: T; meta?: ListMeta; error?: { code: string; message: string } }
    | null;
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      json?.error?.code ?? "internal_error",
      json?.error?.message ?? "Unexpected error"
    );
  }
  return json as T;
}

export function createApiClient(getToken: TokenGetter, cacheScope = "default") {
  const get = <T>(path: string) => request<{ data: T; meta?: ListMeta }>(getToken, "GET", path);
  const send = <T>(method: string, path: string, body?: unknown) =>
    request<{ data: T }>(getToken, method, path, body);
  const cacheKey = (path: string) => `${cacheScope}:${path}`;
  const invalidate = (prefixes: readonly string[]) => {
    for (const key of responseCache.keys()) {
      if (key.startsWith(`${cacheScope}:`) && prefixes.some((prefix) => key.slice(cacheScope.length + 1).startsWith(prefix))) {
        responseCache.delete(key);
        cacheEpoch.set(key, (cacheEpoch.get(key) ?? 0) + 1);
      }
    }
  };
  const cached = async <T>(path: string, ttlMs: number, loader: () => Promise<T>): Promise<T> => {
    const key = cacheKey(path);
    const now = Date.now();
    const existing = responseCache.get(key);
    if (existing?.inFlight) return existing.inFlight as Promise<T>;
    if (existing && existing.expiresAt > now && existing.value !== undefined) return existing.value as T;
    const epoch = cacheEpoch.get(key) ?? 0;
    const inFlight = loader().then((value) => {
      if ((cacheEpoch.get(key) ?? 0) === epoch) {
        responseCache.set(key, { value, expiresAt: Date.now() + ttlMs });
      }
      return value;
    }).finally(() => {
      const current = responseCache.get(key);
      if (current?.inFlight === inFlight) {
        responseCache.set(key, { value: current.value, expiresAt: current.expiresAt });
      }
    });
    responseCache.set(key, { value: existing?.value, expiresAt: existing?.expiresAt ?? 0, inFlight });
    return inFlight;
  };
  const invalidateArticles = () => invalidate([
    "/api/v1/articles",
    "/api/v1/bootstrap",
    "/api/v1/subscriptions",
    "/api/v1/status",
  ]);
  const invalidateShell = () => invalidate([
    "/api/v1/bootstrap",
    "/api/v1/settings",
    "/api/v1/subscriptions",
    "/api/v1/tags",
    "/api/v1/articles/unread-counts",
  ]);

  return {
    getBootstrap: async () => cached("/api/v1/bootstrap", 30_000, async () =>
      (await get<BootstrapData>("/api/v1/bootstrap")).data,
    ),
    getSettings: async () => (await cached("/api/v1/bootstrap", 30_000, async () =>
      (await get<BootstrapData>("/api/v1/bootstrap")).data,
    )).settings,
    updateSettings: async (patch: Partial<Pick<Settings, "theme" | "language" | "readableLanguages" | "articleSortOrder" | "openInBrowserByDefault">>) => {
      const value = (await send<Settings>("PATCH", "/api/v1/settings", patch)).data;
      invalidateShell();
      return value;
    },
    getStatus: async () => cached("/api/v1/status", 3_000, async () =>
      (await get<StatusOverview>("/api/v1/status")).data,
    ),
    refreshFeeds: async (force = false) => {
      const value = (await send<RefreshResult>("POST", "/api/v1/status/refresh", { force })).data;
      invalidateArticles();
      return value;
    },
    refreshFeed: async (feedId: number) => {
      const value = (await send<RefreshResult>("POST", `/api/v1/status/refresh/${feedId}`)).data;
      invalidateArticles();
      return value;
    },
    listSubscriptions: async (tagId?: number) => {
      if (tagId === undefined) return (await cached("/api/v1/bootstrap", 30_000, async () =>
        (await get<BootstrapData>("/api/v1/bootstrap")).data,
      )).subscriptions;
      return cached(
        `/api/v1/subscriptions?tagId=${tagId}`,
        30_000,
        async () => {
          const all: Subscription[] = [];
          let cursor: string | null = null;
          do {
            const params = new URLSearchParams({ limit: "100" });
            params.set("tagId", String(tagId));
            if (cursor) params.set("cursor", cursor);
            const res = await get<Subscription[]>(`/api/v1/subscriptions?${params}`);
            all.push(...res.data);
            cursor = res.meta?.nextCursor ?? null;
          } while (cursor);
          return all;
        },
      );
    },
    getSubscription: async (id: number) => (await get<Subscription>(`/api/v1/subscriptions/${id}`)).data,
    createSubscription: async (input: { feedUrl: string; customTitle?: string; tagIds?: number[]; tagNames?: string[] }) => {
      const value = (await send<Subscription>("POST", "/api/v1/subscriptions", input)).data;
      invalidateShell();
      return value;
    },
    updateSubscription: async (id: number, customTitle: string | null) => {
      const value = (await send<Subscription>("PATCH", `/api/v1/subscriptions/${id}`, { customTitle })).data;
      invalidateShell();
      return value;
    },
    deleteSubscription: async (id: number) => {
      await send<unknown>("DELETE", `/api/v1/subscriptions/${id}`);
      invalidateShell();
    },
    markAllRead: async (id: number) => {
      const value = (await send<MarkAllReadResult>("POST", `/api/v1/subscriptions/${id}/mark-all-read`)).data;
      invalidateArticles();
      return value;
    },
    retryInitialFetch: async (id: number) => {
      const value = (await send<Subscription>("POST", `/api/v1/subscriptions/${id}/retry-initial-fetch`)).data;
      invalidateShell();
      return value;
    },
    setSubscriptionTags: async (id: number, tagIds: number[]) => {
      const value = (await send<Subscription>("PUT", `/api/v1/subscriptions/${id}/tags`, { tagIds })).data;
      invalidateShell();
      return value;
    },
    reorderSubscriptions: async (subscriptionIds: number[]) => {
      await send<unknown>("PUT", "/api/v1/subscriptions/order", { subscriptionIds });
      invalidateShell();
    },

    listTags: async () => (await cached("/api/v1/bootstrap", 30_000, async () =>
      (await get<BootstrapData>("/api/v1/bootstrap")).data,
    )).tags,
    createTag: async (name: string, color?: string) => {
      const value = (await send<Tag>("POST", "/api/v1/tags", { name, color })).data;
      invalidateShell();
      return value;
    },
    updateTag: async (id: number, patch: { name?: string; color?: string | null }) => {
      const value = (await send<Tag>("PATCH", `/api/v1/tags/${id}`, patch)).data;
      invalidateShell();
      return value;
    },
    deleteTag: async (id: number) => {
      await send<unknown>("DELETE", `/api/v1/tags/${id}`);
      invalidateShell();
    },
    reorderTags: async (tagIds: number[]) => {
      await send<Tag[]>("PUT", "/api/v1/tags/order", { tagIds });
      invalidateShell();
    },

    listArticles: async (filters: ArticleListFilters = {}) => {
      const params = new URLSearchParams();
      if (filters.subscriptionId !== undefined) params.set("subscriptionId", String(filters.subscriptionId));
      if (filters.tagId !== undefined) params.set("tagId", String(filters.tagId));
      if (filters.read !== undefined) params.set("read", String(filters.read));
      if (filters.readingList !== undefined) params.set("readingList", String(filters.readingList));
      if (filters.bookmarked !== undefined) params.set("bookmarked", String(filters.bookmarked));
      if (filters.sort) params.set("sort", filters.sort);
      if (filters.readOrder) params.set("readOrder", filters.readOrder);
      if (filters.cursor) params.set("cursor", filters.cursor);
      params.set("limit", String(filters.limit ?? 20));
      const path = `/api/v1/articles?${params}`;
      return cached(path, 5_000, async () => {
        const res = await get<ArticleListItem[]>(path);
        return { articles: res.data, nextCursor: res.meta?.nextCursor ?? null };
      });
    },
    getUnreadCounts: async (scope: UnreadCountScope = "both") => {
      return cached(
        `/api/v1/articles/unread-counts?scope=${scope}`,
        10_000,
        async () => (await get<UnreadCounts>(`/api/v1/articles/unread-counts?scope=${scope}`)).data,
      );
    },
    markAllArticlesRead: async (tagId?: number) => {
      const value = (await send<{ updatedFeeds: number }>("POST", "/api/v1/articles/mark-all-read", tagId === undefined ? {} : { tagId })).data;
      invalidateArticles();
      return value;
    },
    removeReadArticlesFromReadingList: async () => {
      const value = (await send<{ removedCount: number }>("DELETE", "/api/v1/articles/reading-list/read")).data;
      invalidateArticles();
      return value;
    },
    setArticleRead: async (id: number, isRead: boolean) => {
      const value = (await send<ArticleUserState>("PATCH", `/api/v1/articles/${id}/state`, { isRead })).data;
      invalidateArticles();
      return value;
    },
    setReadingListMembership: async (id: number, active: boolean) => {
      const value = (await send<ArticleUserState>(active ? "PUT" : "DELETE", `/api/v1/articles/${id}/reading-list`)).data;
      invalidateArticles();
      return value;
    },
    importArticle: async (input: { url: string; title?: string; summary?: string }) => {
      const value = (await send<SavedArticleResult>("POST", "/api/v1/articles/import", input)).data;
      invalidateArticles();
      return value;
    },
    setBookmarkMembership: async (id: number, active: boolean) => {
      const value = (await send<ArticleUserState>(active ? "PUT" : "DELETE", `/api/v1/articles/${id}/bookmark`)).data;
      invalidateArticles();
      return value;
    },
    importOpml: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await request<{ data: OpmlImportJob }>(getToken, "POST", "/api/v1/opml/import", undefined, {
        formData,
      });
      return res.data;
    },
    getOpmlImport: async (jobId: string) => (await get<OpmlImportJob>(`/api/v1/opml/imports/${jobId}`)).data,
    exportOpml: async () => {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/api/v1/opml/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new ApiRequestError(response.status, "internal_error", "Export failed");
      return response.blob();
    },

    deleteAccount: async () => (await send<DeletionAccepted>("DELETE", "/api/v1/account")).data,
    getDeletionStatus: async (deletionToken?: string) => {
      const path = deletionToken
        ? `/api/v1/account/deletion-status?deletionToken=${encodeURIComponent(deletionToken)}`
        : "/api/v1/account/deletion-status";
      return (
        await request<{ data: DeletionStatus }>(getToken, "GET", path, undefined, {
          skipAuth: Boolean(deletionToken),
        })
      ).data;
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
