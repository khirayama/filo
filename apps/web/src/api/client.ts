import type {
  ArticleListFilters,
  ArticleListItem,
  ArticleUserState,
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
} from "./types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8787";

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
    response = await fetch(`${API_BASE_URL}${path}`, { method, headers, body: requestBody });
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

export function createApiClient(getToken: TokenGetter) {
  const get = <T>(path: string) => request<{ data: T; meta?: ListMeta }>(getToken, "GET", path);
  const send = <T>(method: string, path: string, body?: unknown) =>
    request<{ data: T }>(getToken, method, path, body);

  return {
    getSettings: async () => (await get<Settings>("/api/v1/settings")).data,
    updateSettings: async (patch: Partial<Pick<Settings, "theme" | "language" | "readableLanguages" | "articleSortOrder" | "openInBrowserByDefault">>) =>
      (await send<Settings>("PATCH", "/api/v1/settings", patch)).data,
    getStatus: async () => (await get<StatusOverview>("/api/v1/status")).data,
    refreshFeeds: async (force = false) =>
      (await send<RefreshResult>("POST", "/api/v1/status/refresh", { force })).data,
    refreshFeed: async (feedId: number) =>
      (await send<RefreshResult>("POST", `/api/v1/status/refresh/${feedId}`)).data,
    listSubscriptions: async (tagId?: number) => {
      const all: Subscription[] = [];
      let cursor: string | null = null;
      do {
        const params = new URLSearchParams({ limit: "100" });
        if (tagId !== undefined) params.set("tagId", String(tagId));
        if (cursor) params.set("cursor", cursor);
        const res = await get<Subscription[]>(`/api/v1/subscriptions?${params}`);
        all.push(...res.data);
        cursor = res.meta?.nextCursor ?? null;
      } while (cursor);
      return all;
    },
    getSubscription: async (id: number) => (await get<Subscription>(`/api/v1/subscriptions/${id}`)).data,
    createSubscription: async (input: { feedUrl: string; customTitle?: string; tagIds?: number[]; tagNames?: string[] }) =>
      (await send<Subscription>("POST", "/api/v1/subscriptions", input)).data,
    updateSubscription: async (id: number, customTitle: string | null) =>
      (await send<Subscription>("PATCH", `/api/v1/subscriptions/${id}`, { customTitle })).data,
    deleteSubscription: async (id: number) => {
      await send<unknown>("DELETE", `/api/v1/subscriptions/${id}`);
    },
    markAllRead: async (id: number) =>
      (await send<MarkAllReadResult>("POST", `/api/v1/subscriptions/${id}/mark-all-read`)).data,
    retryInitialFetch: async (id: number) =>
      (await send<Subscription>("POST", `/api/v1/subscriptions/${id}/retry-initial-fetch`)).data,
    setSubscriptionTags: async (id: number, tagIds: number[]) =>
      (await send<Subscription>("PUT", `/api/v1/subscriptions/${id}/tags`, { tagIds })).data,
    reorderSubscriptions: async (subscriptionIds: number[]) => {
      await send<unknown>("PUT", "/api/v1/subscriptions/order", { subscriptionIds });
    },

    listTags: async () => (await get<Tag[]>("/api/v1/tags")).data,
    createTag: async (name: string, color?: string) => (await send<Tag>("POST", "/api/v1/tags", { name, color })).data,
    updateTag: async (id: number, patch: { name?: string; color?: string | null }) =>
      (await send<Tag>("PATCH", `/api/v1/tags/${id}`, patch)).data,
    deleteTag: async (id: number) => {
      await send<unknown>("DELETE", `/api/v1/tags/${id}`);
    },
    reorderTags: async (tagIds: number[]) => {
      await send<Tag[]>("PUT", "/api/v1/tags/order", { tagIds });
    },

    listArticles: async (filters: ArticleListFilters = {}) => {
      const params = new URLSearchParams();
      if (filters.subscriptionId !== undefined) params.set("subscriptionId", String(filters.subscriptionId));
      if (filters.tagId !== undefined) params.set("tagId", String(filters.tagId));
      if (filters.read !== undefined) params.set("read", String(filters.read));
      if (filters.readingList !== undefined) params.set("readingList", String(filters.readingList));
      if (filters.bookmarked !== undefined) params.set("bookmarked", String(filters.bookmarked));
      if (filters.sort) params.set("sort", filters.sort);
      if (filters.cursor) params.set("cursor", filters.cursor);
      params.set("limit", String(filters.limit ?? 20));
      const res = await get<ArticleListItem[]>(`/api/v1/articles?${params}`);
      return { articles: res.data, nextCursor: res.meta?.nextCursor ?? null };
    },
    markAllArticlesRead: async (tagId?: number) =>
      (await send<{ updatedFeeds: number }>("POST", "/api/v1/articles/mark-all-read", tagId === undefined ? {} : { tagId })).data,
    setArticleRead: async (id: number, isRead: boolean) =>
      (await send<ArticleUserState>("PATCH", `/api/v1/articles/${id}/state`, { isRead })).data,
    setReadingListMembership: async (id: number, active: boolean) =>
      (await send<ArticleUserState>(active ? "PUT" : "DELETE", `/api/v1/articles/${id}/reading-list`)).data,
    setBookmarkMembership: async (id: number, active: boolean) =>
      (await send<ArticleUserState>(active ? "PUT" : "DELETE", `/api/v1/articles/${id}/bookmark`)).data,

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
