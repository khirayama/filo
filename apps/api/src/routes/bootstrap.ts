import { Hono } from "hono";
import type { AppContext } from "../lib/auth";
import { recordD1BatchMeta } from "../lib/observability";
import {
  SUBSCRIPTION_SELECT,
  serializeSubscription,
  serializeTag,
  type SubscriptionRow,
  type TagRow,
} from "../lib/serialize";
import { parseReadableLanguages } from "../lib/languages";
import { intToBool, toIso } from "../lib/util";

interface SettingsRow {
  theme: string;
  language: string;
  readable_languages: string | null;
  article_sort_order: string;
  open_in_browser_by_default: number;
  created_at: string;
  updated_at: string;
}

function serializeSettings(row: SettingsRow) {
  return {
    theme: row.theme,
    language: row.language,
    readableLanguages: parseReadableLanguages(row.readable_languages),
    articleSortOrder: row.article_sort_order,
    openInBrowserByDefault: intToBool(row.open_in_browser_by_default),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

/**
 * The authenticated shell needs the same four small, mostly-static datasets
 * on every client. Keep them behind one request and one D1 batch. This is an
 * additive endpoint; the existing resource endpoints remain unchanged for
 * older clients and deep links.
 */
export const bootstrapRoutes = new Hono<AppContext>().get("/", async (c) => {
  const userId = c.get("user").id;
  const batchResults = await c.env.DB.batch([
    c.env.DB.prepare(`${SUBSCRIPTION_SELECT} WHERE s.user_id = ? ORDER BY s.sort_order ASC, s.id ASC`).bind(userId),
    c.env.DB.prepare(
      `SELECT t.*, (
         SELECT COUNT(*) FROM subscription_tags st WHERE st.tag_id = t.id
       ) AS subscription_count
       FROM tags t
       WHERE t.user_id = ?
       ORDER BY t.sort_order ASC, t.id ASC`,
    ).bind(userId),
    c.env.DB.prepare("SELECT * FROM user_settings WHERE user_id = ?").bind(userId),
    c.env.DB.prepare(
      `SELECT
         (SELECT COALESCE(SUM(unread_count), 0)
          FROM subscription_unread_counts WHERE user_id = ?) AS all_articles,
         (SELECT reading_list_count
          FROM user_unread_counts WHERE user_id = ?) AS reading_list`,
    ).bind(userId, userId),
    c.env.DB.prepare(
      `SELECT st.subscription_id, st.tag_id
       FROM subscription_tags st
       JOIN subscriptions s ON s.id = st.subscription_id
       JOIN tags t ON t.id = st.tag_id
       WHERE s.user_id = ?
       ORDER BY s.id ASC, t.sort_order ASC, t.id ASC`,
    ).bind(userId),
  ]);
  recordD1BatchMeta("bootstrap.shell", batchResults, { user_data: true });
  const [subscriptionResult, tagResult, settingsResult, unreadResult, tagLinkResult] = batchResults;
  if (!subscriptionResult || !tagResult || !settingsResult || !unreadResult || !tagLinkResult) {
    throw new Error("bootstrap query batch was incomplete");
  }

  const subscriptions = subscriptionResult.results as unknown as SubscriptionRow[];
  const tags = tagResult.results as unknown as TagRow[];
  const settings = settingsResult.results[0] as unknown as SettingsRow | undefined;
  const unread = unreadResult.results[0] as unknown as {
    all_articles: number | null;
    reading_list: number | null;
  } | undefined;
  if (!settings) throw new Error("settings row missing");

  const tagMap = new Map<number, number[]>();
  for (const row of tagLinkResult.results as unknown as Array<{ subscription_id: number; tag_id: number }>) {
    const ids = tagMap.get(row.subscription_id) ?? [];
    ids.push(row.tag_id);
    tagMap.set(row.subscription_id, ids);
  }

  return c.json({
    data: {
      tags: tags.map(serializeTag),
      subscriptions: subscriptions.map((row) =>
        serializeSubscription(row, tagMap.get(row.id) ?? [], row.unread_count),
      ),
      settings: serializeSettings(settings),
      unreadCounts: {
        allArticles: Number(unread?.all_articles ?? 0),
        readingList: Number(unread?.reading_list ?? 0),
      },
    },
  });
});
