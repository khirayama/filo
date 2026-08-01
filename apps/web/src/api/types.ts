export type Theme = "light" | "dark" | "system";
export type Language = "ja" | "en" | "zh" | "ko" | "es";
export type ArticleSortOrder = "published_at_desc" | "fetched_at_desc";
export type InitialFetchStatus = "fetching" | "ready" | "failed";
export type FeedHealthStatus = "healthy" | "stale" | "paused";
export type FeedJobStatus = "pending" | "running" | "completed" | "failed";

export interface FeedJob {
  status: FeedJobStatus;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
  stalled: boolean;
}

export interface Settings {
  theme: Theme;
  language: Language;
  readableLanguages: string[];
  articleSortOrder: ArticleSortOrder;
  openInBrowserByDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FeedSummary {
  id: number;
  title: string;
  siteUrl?: string | null;
  feedUrl?: string;
  faviconUrl: string | null;
  // サーバーが決めた feed の言語。翻訳の準備画面の候補に使う
  language?: string | null;
  latestPublishedAt?: string | null;
}

export interface Subscription {
  id: number;
  customTitle: string | null;
  unreadCount: number;
  sortOrder: number;
  initialFetchStatus: InitialFetchStatus;
  initialFetchErrorCode: string | null;
  feedHealthStatus: FeedHealthStatus;
  feed: FeedSummary;
  tagIds: number[];
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: number;
  name: string;
  color: string | null;
  sortOrder: number;
  subscriptionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleUserState {
  isRead: boolean;
  inReadingList: boolean;
  isBookmarked: boolean;
}

export interface ArticleListItem {
  id: number;
  title: string;
  sourceLanguage: string | null;
  canonicalUrl: string | null;
  rssSummary: string | null;
  previewText: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  feed: FeedSummary;
  subscriptionContext: { subscriptionIds: number[]; tagIds: number[] };
  userState: ArticleUserState;
}

export interface MarkAllReadResult {
  lastReadArticleId: number | null;
  unreadCount: number;
  updatedAt: string | null;
}

export interface RefreshResult {
  accepted: boolean;
  enqueued: number;
  skipped: number;
  queuedAt: string;
}

export interface ListMeta {
  nextCursor: string | null;
}

export interface OpmlImportJob {
  jobId: string;
  status: "pending" | "running" | "completed" | "failed";
  queuedAt: string;
  finishedAt?: string | null;
  total?: number;
  created?: number;
  skipped?: number;
  failed?: number;
  failures?: Array<{ feedUrl: string; reason: string }>;
}

export interface DeletionAccepted {
  status: string;
  deletionToken: string;
  queuedAt: string;
}

export interface DeletionStatus {
  status: "none" | "pending" | "running" | "failed" | "completed";
  retryable?: boolean;
  errorCode?: string;
}

export interface StatusSubscription {
  subscriptionId: number;
  feedTitle: string;
  feedId: number;
  feedStatus: string;
  lastResult: string | null;
  lastError: string | null;
  lastFetchedAt: string | null;
  consecutiveFailures: number;
  fetchJob: FeedJob | null;
}

export interface StatusOverview {
  generatedAt: string;
  feeds: {
    total: number;
    active: number;
    paused: number;
    lastFetchedAt: string | null;
  };
  articles: { total: number };
  subscriptionStatuses: StatusSubscription[];
}

export interface ArticleListFilters {
  subscriptionId?: number;
  tagId?: number;
  read?: boolean;
  readingList?: true;
  bookmarked?: true;
  sort?: ArticleSortOrder;
  cursor?: string;
  limit?: number;
}
