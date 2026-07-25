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
  translatedTitle: string | null;
  titleTranslationPending: boolean;
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

export type ContentStatus = "not_requested" | "pending" | "ready" | "error";

export interface ArticleDetail {
  id: number;
  title: string;
  originalTitle: string;
  translatedTitle: string | null;
  titleTranslationPending: boolean;
  sourceLanguage: string | null;
  canonicalUrl: string | null;
  author: string | null;
  rssSummary: string | null;
  rssContentHtml: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  feed: FeedSummary | null;
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

export interface ArticleContent {
  status: ContentStatus;
  sourceLanguage?: string | null;
  text?: string | null;
  html?: string | null;
  errorMessage?: string | null;
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

// Translation progress is derived from stored translation rows, not from job
// records: every (article, target language) pair is missing, pending, ready,
// or failed, so the numbers always match reality.
export interface TranslationCoverage {
  articles: number;
  untranslatable: number;
  needed: number;
  ready: number;
  failed: number;
  // queued (順番待ち) + processing (翻訳中 / LLM応答待ち) = pending.
  queued: number;
  processing: number;
  pending: number;
  missing: number;
  lastError: string | null;
}

export interface TranslatingTitle {
  title: string;
  languages: string[];
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
  translation: TranslationCoverage;
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
  translator: { pending: number; current: TranslatingTitle[] };
  subscriptionStatuses: StatusSubscription[];
}

export interface PlaybackQueueArticle {
  id: number;
  title: string;
  originalTitle: string;
  sourceLanguage: string | null;
  canonicalUrl: string | null;
  publishedAt: string | null;
  feed: { id: number; title: string; faviconUrl: string | null };
}

export interface PlaybackQueueItem {
  articleId: number;
  sortOrder: number;
  article: PlaybackQueueArticle;
  createdAt: string | null;
}

export interface PlaybackState {
  currentArticleId: number | null;
  contentLanguage: string | null;
  positionPercent: number;
  updatedAt: string | null;
}

export interface PlaybackQueue {
  items: PlaybackQueueItem[];
  playbackState: PlaybackState | null;
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
