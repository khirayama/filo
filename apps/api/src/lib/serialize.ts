import { intToBool, toIso } from "./util";

export interface SubscriptionRow {
  id: number;
  custom_title: string | null;
  sort_order: number;
  initial_fetch_status: string;
  initial_fetch_error_code: string | null;
  created_at: string;
  updated_at: string;
  feed_id: number;
  feed_title: string;
  feed_site_url: string | null;
  feed_url: string;
  feed_favicon_url: string | null;
  feed_status: string;
  last_success_fetched_at: string | null;
  latest_published_at: string | null;
}

export const SUBSCRIPTION_SELECT = `
  SELECT
    s.id, s.custom_title, s.sort_order, s.initial_fetch_status, s.initial_fetch_error_code,
    s.created_at, s.updated_at,
    f.id AS feed_id, f.title AS feed_title, f.site_url AS feed_site_url,
    f.feed_url AS feed_url, f.favicon_url AS feed_favicon_url, f.status AS feed_status,
    fs.last_success_fetched_at AS last_success_fetched_at,
    (SELECT MAX(a.published_at) FROM articles a WHERE a.feed_id = f.id) AS latest_published_at
  FROM subscriptions s
  JOIN feeds f ON f.id = s.feed_id
  LEFT JOIN feed_fetch_states fs ON fs.feed_id = f.id
`;

const STALE_THRESHOLD_MS = 72 * 60 * 60 * 1000;

function deriveFeedHealthStatus(row: SubscriptionRow): "healthy" | "stale" | "paused" {
  if (row.feed_status === "paused") return "paused";
  const lastSuccess = toIso(row.last_success_fetched_at);
  if (!lastSuccess) return "healthy"; // new feeds are not flagged while initial fetch runs
  if (Date.now() - new Date(lastSuccess).getTime() > STALE_THRESHOLD_MS) return "stale";
  return "healthy";
}

export function serializeSubscription(row: SubscriptionRow, tagIds: number[], unreadCount: number) {
  return {
    id: row.id,
    customTitle: row.custom_title,
    unreadCount,
    sortOrder: row.sort_order,
    initialFetchStatus: row.initial_fetch_status,
    initialFetchErrorCode: row.initial_fetch_status === "failed" ? row.initial_fetch_error_code : null,
    feedHealthStatus: deriveFeedHealthStatus(row),
    feed: {
      id: row.feed_id,
      title: row.feed_title,
      siteUrl: row.feed_site_url,
      feedUrl: row.feed_url,
      faviconUrl: row.feed_favicon_url,
      latestPublishedAt: toIso(row.latest_published_at),
    },
    tagIds,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export interface TagRow {
  id: number;
  name: string;
  color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  subscription_count?: number;
}

export function serializeTag(row: TagRow) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    sortOrder: row.sort_order,
    subscriptionCount: row.subscription_count ?? 0,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export interface ArticleStateRow {
  is_read: number | null;
  in_reading_list: number | null;
  is_bookmarked: number | null;
}

export function serializeUserState(row: ArticleStateRow | null | undefined) {
  return {
    isRead: intToBool(row?.is_read ?? 0),
    inReadingList: intToBool(row?.in_reading_list ?? 0),
    isBookmarked: intToBool(row?.is_bookmarked ?? 0),
  };
}
