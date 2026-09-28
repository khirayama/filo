import type { JobMessage } from "../env";
import { faviconUrlFor, type DiscoveredFeed } from "./discovery";
import { createSubscriptionUnreadCountMutation } from "./readCursor";
import { attachTagsStatement, resolveTagIdsByNames } from "./tagops";
import { nowIso } from "./util";

// Feeds are shared: a known URL reuses its row, otherwise the discovered
// document becomes a new active feed.
export async function findOrCreateFeed(db: D1Database, discovered: DiscoveredFeed): Promise<number> {
  const existing = await db.prepare("SELECT id FROM feeds WHERE feed_url = ?")
    .bind(discovered.feedUrl)
    .first<{ id: number }>();
  if (existing) return existing.id;

  const now = nowIso();
  const inserted = await db.prepare(
    `INSERT INTO feeds (feed_url, site_url, title, description, favicon_url, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?) RETURNING id`,
  )
    .bind(
      discovered.feedUrl,
      discovered.parsed.siteUrl,
      discovered.parsed.title,
      discovered.parsed.description,
      await faviconUrlFor(discovered.parsed.siteUrl, discovered.feedUrl),
      now,
      now,
    )
    .first<{ id: number }>();
  if (!inserted) throw new Error("could not create feed");
  return inserted.id;
}

export interface NewSubscription {
  customTitle: string | null;
  // Must already be verified as the user's own tags.
  tagIds?: readonly number[];
  tagNames?: readonly string[];
}

// Returns the new subscription id, or null when the user already subscribes
// to the feed. The unread counter row is written in the same batch as the
// subscription, so no subscription can exist without one.
export async function createSubscription(
  db: D1Database,
  jobs: Queue<JobMessage>,
  userId: number,
  feedId: number,
  input: NewSubscription,
): Promise<number | null> {
  const existing = await db.prepare("SELECT id FROM subscriptions WHERE user_id = ? AND feed_id = ?")
    .bind(userId, feedId)
    .first();
  if (existing) return null;

  // A feed that was fetched before, or already has articles, is ready at once.
  const ready = await db.prepare(
    `SELECT EXISTS (SELECT 1 FROM feed_fetch_states WHERE feed_id = ? AND last_success_fetched_at IS NOT NULL)
         OR EXISTS (SELECT 1 FROM articles WHERE feed_id = ?) AS ready`,
  ).bind(feedId, feedId).first<{ ready: number }>();
  const isReady = ready?.ready === 1;

  const now = nowIso();
  const [inserted] = await db.batch([
    db.prepare(
      `INSERT INTO subscriptions
         (user_id, feed_id, custom_title, sort_order, initial_fetch_status,
          initial_fetch_requested_at, initial_fetch_completed_at, created_at, updated_at)
       VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM subscriptions WHERE user_id = ?), ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, feed_id) DO NOTHING
       RETURNING id`,
    ).bind(userId, feedId, input.customTitle, userId, isReady ? "ready" : "fetching", now, isReady ? now : null, now, now),
    // Counted in the same batch, so an article inserted by a concurrent fetch
    // is either counted here or incremented by the insert trigger, never both.
    createSubscriptionUnreadCountMutation(db, userId, feedId, now),
  ]);
  // A concurrent request may have subscribed first.
  const subscriptionId = (inserted?.results[0] as { id?: number } | undefined)?.id;
  if (subscriptionId === undefined) return null;

  const tagIds = [
    ...(input.tagIds ?? []),
    ...(await resolveTagIdsByNames(db, userId, [...(input.tagNames ?? [])])),
  ];
  if (tagIds.length > 0) await attachTagsStatement(db, subscriptionId, tagIds, now).run();

  if (!isReady) await jobs.send({ jobType: "fetch_feed", feedId, reason: "initial", attempt: 1 });
  return subscriptionId;
}
