import type { Env } from "../env";
import { faviconUrlFor, resolveCanonicalFeedUrl } from "../lib/discovery";
import { dedupeKeyFor, parseFeed, type ParsedFeed } from "../lib/feed";
import { settleFetchJobs } from "../lib/feedJobs";
import { CADENCE_SAMPLE_SIZE, refreshIntervalMinutes } from "../lib/fetchSchedule";
import {
  alternateTrailingSlashUrl,
  canonicalizeFeedUrl,
  canonicalizeUrl,
  feedUrlAliases,
  readTextCapped,
  safeFetch,
} from "../lib/net";
import { isoOffset, nowIso } from "../lib/util";

interface FeedRow {
  id: number;
  feed_url: string;
  status: string;
}

interface FetchStateRow {
  http_etag: string | null;
  http_last_modified: string | null;
  consecutive_failures: number;
}

// Kept inside the same 1h..1d window as the cadence-derived interval.
const ERROR_BACKOFF_MINUTES = [60, 360, 60 * 24];
// Used until a feed has published enough dated articles to show a cadence.
const SUCCESS_FALLBACK_MINUTES = 60;
const NOT_MODIFIED_FALLBACK_MINUTES = 120;

// Cooldown until this feed is worth fetching again, from how often it publishes.
async function nextFetchInterval(env: Env, feedId: number, fallbackMinutes: number): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT published_at FROM articles
     WHERE feed_id = ? AND published_at IS NOT NULL
     ORDER BY published_at DESC LIMIT ?`
  )
    .bind(feedId, CADENCE_SAMPLE_SIZE)
    .all<{ published_at: string }>();
  return refreshIntervalMinutes(
    results.map((row) => row.published_at),
    fallbackMinutes
  );
}

interface FetchedFeedDocument {
  response: Response;
  parsed: ParsedFeed | null;
  error: string | null;
  requestedUrl: string;
  finalUrl: string;
  permanentRedirect: boolean;
}

async function fetchFeedDocumentAt(feedUrl: string, headers: Record<string, string>): Promise<FetchedFeedDocument> {
  const { response, finalUrl, permanentRedirect } = await safeFetch(feedUrl, { headers });
  const base = { response, requestedUrl: feedUrl, finalUrl, permanentRedirect };
  if (response.status === 304) return { ...base, parsed: null, error: null };
  if (!response.ok) {
    return { ...base, parsed: null, error: `feed responded with status ${response.status}` };
  }
  const parsed = parseFeed(await readTextCapped(response));
  return { ...base, parsed, error: parsed ? null : "feed could not be parsed" };
}

// When an https feed endpoint is dead at the network level, probe plain http
// once. The probe is trusted only as a forwarding address: it must prove a
// permanent move onto an https endpoint (e.g. an abandoned domain whose http
// side still 301s to the feed's new home). Content that exists solely over
// plaintext http is still rejected.
async function fetchViaHttpDowngrade(
  feedUrl: string,
  headers: Record<string, string>
): Promise<FetchedFeedDocument | null> {
  let probeUrl: URL;
  try {
    probeUrl = new URL(feedUrl);
  } catch {
    return null;
  }
  if (probeUrl.protocol !== "https:") return null;
  probeUrl.protocol = "http:";
  let fetched: FetchedFeedDocument;
  try {
    fetched = await fetchFeedDocumentAt(probeUrl.toString(), headers);
  } catch {
    return null;
  }
  if (fetched.error || !fetched.permanentRedirect) return null;
  if (!fetched.finalUrl.startsWith("https:")) return null;
  return fetched;
}

async function fetchFeedDocument(feedUrl: string, headers: Record<string, string>): Promise<FetchedFeedDocument> {
  let primary: FetchedFeedDocument;
  try {
    primary = await fetchFeedDocumentAt(feedUrl, headers);
  } catch (error) {
    const downgraded = await fetchViaHttpDowngrade(feedUrl, headers);
    if (downgraded) return downgraded;
    throw error;
  }
  if (!primary.error) return primary;

  const alternate = alternateTrailingSlashUrl(feedUrl);
  if (!alternate) throw new Error(primary.error);
  const fallback = await fetchFeedDocumentAt(alternate, headers);
  if (!fallback.error) return fallback;
  throw new Error(fallback.error);
}

// Persist a feed's new canonical URL, discovered via a permanent redirect or
// the feed's self link. When another feed row already owns that URL (e.g. an
// old domain now redirects to a feed users also subscribe to directly), the
// two rows are the same publication: fold this feed's subscribers into the
// existing row and pause the legacy one instead of failing on the UNIQUE index.
async function migrateFeedUrl(env: Env, feedId: number, newFeedUrl: string, now: string): Promise<void> {
  const [canonical, alternate] = feedUrlAliases(newFeedUrl);
  const target = await env.DB.prepare("SELECT id FROM feeds WHERE feed_url IN (?, ?) AND id != ?")
    .bind(canonical, alternate, feedId)
    .first<{ id: number }>();
  if (!target) {
    // OR IGNORE covers a race where the target row appears between the check and the update
    await env.DB.prepare("UPDATE OR IGNORE feeds SET feed_url = ?, updated_at = ? WHERE id = ?")
      .bind(canonical, now, feedId)
      .run();
    return;
  }
  await env.DB.batch([
    // a user subscribed to both rows keeps the surviving subscription
    env.DB.prepare(
      "DELETE FROM subscriptions WHERE feed_id = ? AND user_id IN (SELECT user_id FROM subscriptions WHERE feed_id = ?)"
    ).bind(feedId, target.id),
    env.DB.prepare("UPDATE subscriptions SET feed_id = ?, updated_at = ? WHERE feed_id = ?").bind(
      target.id,
      now,
      feedId
    ),
    // read cursors are article-id watermarks on a global sequence, so a carried
    // over cursor still approximates "read up to this point in time"
    env.DB.prepare(
      "DELETE FROM feed_read_cursors WHERE feed_id = ? AND user_id IN (SELECT user_id FROM feed_read_cursors WHERE feed_id = ?)"
    ).bind(feedId, target.id),
    env.DB.prepare("UPDATE feed_read_cursors SET feed_id = ?, updated_at = ? WHERE feed_id = ?").bind(
      target.id,
      now,
      feedId
    ),
    env.DB.prepare("UPDATE feeds SET status = 'paused', updated_at = ? WHERE id = ?").bind(now, feedId),
  ]);
}

async function markWaitingSubscriptions(env: Env, feedId: number, status: "ready" | "failed", errorCode: string | null) {
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE subscriptions
     SET initial_fetch_status = ?, initial_fetch_error_code = ?,
         initial_fetch_completed_at = ?, updated_at = ?
     WHERE feed_id = ? AND initial_fetch_status = 'fetching'`
  )
    .bind(status, status === "failed" ? errorCode : null, status === "ready" ? now : null, now, feedId)
    .run();
}

async function writeLog(env: Env, feedId: number, startedAt: string, result: string, count: number, error: string | null) {
  await env.DB.prepare(
    "INSERT INTO feed_fetch_logs (feed_id, started_at, finished_at, result, fetched_article_count, error_message) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(feedId, startedAt, nowIso(), result, count, error)
    .run();
}

export async function runFetchFeed(
  env: Env,
  feedId: number,
  reason: "initial" | "refresh" | "retry_initial"
): Promise<void> {
  const feed = await env.DB.prepare("SELECT id, feed_url, status FROM feeds WHERE id = ?")
    .bind(feedId)
    .first<FeedRow>();
  if (!feed) {
    await settleFetchJobs(env.DB, feedId, "failed", { finishedAt: nowIso(), lastError: "feed not found" });
    return;
  }
  // paused feeds are skipped for refresh, but user-driven initial retry is allowed
  if (feed.status === "paused" && reason === "refresh") {
    await settleFetchJobs(env.DB, feedId, "failed", { finishedAt: nowIso(), lastError: "feed is paused" });
    return;
  }

  await settleFetchJobs(env.DB, feedId, "running", { startedAt: nowIso() });

  const state = await env.DB.prepare(
    "SELECT http_etag, http_last_modified, consecutive_failures FROM feed_fetch_states WHERE feed_id = ?"
  )
    .bind(feedId)
    .first<FetchStateRow>();

  const startedAt = nowIso();
  const isInitial = reason === "initial" || reason === "retry_initial";

  try {
    const headers: Record<string, string> = {
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
    };
    if (state?.http_etag) headers["If-None-Match"] = state.http_etag;
    if (state?.http_last_modified) headers["If-Modified-Since"] = state.http_last_modified;

    const fetched = await fetchFeedDocument(feed.feed_url, headers);
    const response = fetched.response;
    const now = nowIso();

    if (response.status === 304) {
      const interval = await nextFetchInterval(env, feedId, NOT_MODIFIED_FALLBACK_MINUTES);
      await env.DB.prepare(
        `INSERT INTO feed_fetch_states (feed_id, last_fetched_at, last_success_fetched_at, last_result, next_fetch_after, consecutive_failures, updated_at)
         VALUES (?, ?, ?, 'not_modified', ?, 0, ?)
         ON CONFLICT (feed_id) DO UPDATE SET
           last_fetched_at = excluded.last_fetched_at, last_success_fetched_at = excluded.last_success_fetched_at,
           last_result = 'not_modified', last_error = NULL,
           next_fetch_after = excluded.next_fetch_after, consecutive_failures = 0, updated_at = excluded.updated_at`
      )
        .bind(feedId, now, now, isoOffset(interval), now)
        .run();
      await writeLog(env, feedId, startedAt, "not_modified", 0, null);
      // a 304 means the feed was fetched successfully before; waiting subscriptions are ready
      await markWaitingSubscriptions(env, feedId, "ready", null);
      await settleFetchJobs(env.DB, feedId, "completed", { finishedAt: now });
      // a permanently redirected feed has moved; follow it so refreshes stop
      // depending on the old endpoint staying alive
      if (fetched.permanentRedirect) {
        await migrateFeedUrl(env, feedId, canonicalizeFeedUrl(fetched.finalUrl), now);
      }
      return;
    }

    const parsed = fetched.parsed;
    if (!parsed) throw new Error("feed could not be parsed");
    // Only a permanent redirect moves the feed's home; a temporary one must
    // not rewrite the stored URL.
    const canonicalFeedUrl = await resolveCanonicalFeedUrl(
      parsed,
      fetched.permanentRedirect ? fetched.finalUrl : fetched.requestedUrl
    );
    // refresh feed metadata including favicon
    const siteUrl = parsed.siteUrl ?? canonicalFeedUrl;
    let faviconUrl: string | null = null;
    try {
      faviconUrl = await faviconUrlFor(siteUrl, canonicalFeedUrl);
    } catch {
      // favicon refresh failure should not block feed ingestion
    }
    await env.DB.prepare(
      `UPDATE feeds SET title = ?, site_url = COALESCE(?, site_url), description = ?,
       favicon_url = COALESCE(?, favicon_url), updated_at = ?
       WHERE id = ?`,
    )
      .bind(parsed.title, parsed.siteUrl, parsed.description, faviconUrl, now, feedId)
      .run();

    const newArticleIds: number[] = [];
    for (const item of parsed.items.slice(0, 200)) {
      const dedupeKey = await dedupeKeyFor(item);
      const canonicalUrl = item.url
        ? (() => {
            try {
              return canonicalizeUrl(item.url);
            } catch {
              return item.url;
            }
          })()
        : null;
      const existing = await env.DB.prepare("SELECT id FROM articles WHERE feed_id = ? AND dedupe_key = ?")
        .bind(feedId, dedupeKey)
        .first<{ id: number }>();
      if (existing) {
        await env.DB.prepare(
          `UPDATE articles SET title = ?, author = ?, rss_summary = ?, rss_content_html = ?,
             canonical_url = COALESCE(?, canonical_url), published_at = COALESCE(?, published_at),
             updated_at = ?
           WHERE id = ?`
        )
          .bind(
            item.title,
            item.author,
            item.summary,
            item.contentHtml,
            canonicalUrl,
            item.publishedAt,
            now,
            existing.id,
          )
          .run();
      } else {
        const inserted = await env.DB.prepare(
          `INSERT INTO articles (feed_id, guid, canonical_url, dedupe_key, title, author, rss_summary, rss_content_html, published_at, fetched_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
        )
          .bind(
            feedId,
            item.guid,
            canonicalUrl,
            dedupeKey,
            item.title,
            item.author,
            item.summary,
            item.contentHtml,
            item.publishedAt,
            now,
            now,
            now,
          )
          .first<{ id: number }>();
        if (inserted) newArticleIds.push(inserted.id);
      }
    }

    const etag = response.headers.get("ETag");
    const lastModified = response.headers.get("Last-Modified");
    // after the upserts above, so this run's articles count towards the cadence
    const interval = await nextFetchInterval(env, feedId, SUCCESS_FALLBACK_MINUTES);
    await env.DB.prepare(
      `INSERT INTO feed_fetch_states (feed_id, last_fetched_at, last_success_fetched_at, last_result, http_etag, http_last_modified, next_fetch_after, consecutive_failures, updated_at)
       VALUES (?, ?, ?, 'success', ?, ?, ?, 0, ?)
       ON CONFLICT (feed_id) DO UPDATE SET
         last_fetched_at = excluded.last_fetched_at, last_success_fetched_at = excluded.last_success_fetched_at,
         last_result = 'success', last_error = NULL, http_etag = excluded.http_etag,
         http_last_modified = excluded.http_last_modified, next_fetch_after = excluded.next_fetch_after,
         consecutive_failures = 0, updated_at = excluded.updated_at`
    )
      .bind(feedId, now, now, etag, lastModified, isoOffset(interval), now)
      .run();
    await writeLog(env, feedId, startedAt, "success", newArticleIds.length, null);
    await markWaitingSubscriptions(env, feedId, "ready", null);
    await settleFetchJobs(env.DB, feedId, "completed", { finishedAt: now });

    // Fetching never enqueues title translation: translation is user-triggered
    // only (status page or subscriptions page), because it draws on a serialized
    // provider budget that a per-fetch trigger would exhaust.

    // user-driven one-shot recovery reactivates a paused feed on success
    if (feed.status === "paused" && reason === "retry_initial") {
      await env.DB.prepare("UPDATE feeds SET status = 'active', updated_at = ? WHERE id = ?").bind(now, feedId).run();
    }

    // Runs last so waiting subscriptions are settled before any are repointed
    // to an existing feed row by a merge.
    if (canonicalFeedUrl !== feed.feed_url) {
      await migrateFeedUrl(env, feedId, canonicalFeedUrl, now);
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown fetch error";
    const now = nowIso();
    const failures = (state?.consecutive_failures ?? 0) + 1;
    const backoff = ERROR_BACKOFF_MINUTES[Math.min(failures, ERROR_BACKOFF_MINUTES.length) - 1] ?? 60 * 24;

    await env.DB.prepare(
      `INSERT INTO feed_fetch_states (feed_id, last_fetched_at, last_result, last_error, next_fetch_after, consecutive_failures, updated_at)
       VALUES (?, ?, 'error', ?, ?, ?, ?)
       ON CONFLICT (feed_id) DO UPDATE SET
         last_fetched_at = excluded.last_fetched_at, last_result = 'error', last_error = excluded.last_error,
         next_fetch_after = excluded.next_fetch_after, consecutive_failures = excluded.consecutive_failures,
         updated_at = excluded.updated_at`
    )
      .bind(feedId, now, message, isoOffset(backoff), failures, now)
      .run();
    await writeLog(env, feedId, startedAt, "error", 0, message);
    await settleFetchJobs(env.DB, feedId, "failed", { finishedAt: now, lastError: message });

    if (failures >= 3 && feed.status === "active") {
      await env.DB.prepare("UPDATE feeds SET status = 'paused', updated_at = ? WHERE id = ?").bind(now, feedId).run();
    }
    if (isInitial) {
      await markWaitingSubscriptions(env, feedId, "failed", "feed_unreachable");
    }
  }
}
