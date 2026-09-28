import type { Env } from "../env";
import { faviconUrlFor, resolveCanonicalFeedUrl } from "../lib/discovery";
import { dedupeKeyFor, parseFeed, type ParsedFeed } from "../lib/feed";
import { settleFetchJobs } from "../lib/feedJobs";
import { recordD1BatchMeta } from "../lib/observability";
import { CADENCE_SAMPLE_SIZE, refreshIntervalMinutes } from "../lib/fetchSchedule";
import { detectArticleLanguage, detectFeedLanguage } from "../lib/languageDetect";
import {
  alternateTrailingSlashUrl,
  canonicalizeFeedUrl,
  canonicalizeUrl,
  readTextCapped,
  safeFetch,
} from "../lib/net";
import { isoOffset, nowIso } from "../lib/util";

interface FeedRow {
  id: number;
  feed_url: string;
  status: string;
  language: string | null;
  language_source: string | null;
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

// Keep the stored URL aligned with the feed's permanent redirect or self link.
// A conflicting URL is left untouched; feed identity is established at
// subscription time and is never merged implicitly during a fetch.
async function updateFeedUrl(env: Env, feedId: number, newFeedUrl: string, now: string): Promise<void> {
  await env.DB.prepare("UPDATE OR IGNORE feeds SET feed_url = ?, updated_at = ? WHERE id = ?")
    .bind(canonicalizeFeedUrl(newFeedUrl), now, feedId)
    .run();
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

// フィード言語が未設定なら、保存済み記事のタイトルと説明文から決める。
// 1 回の文書に載る item が少ないフィードでも、蓄積した記事を合わせれば材料が足りる。
// 単独のタイトルでは誤判定するが、数十件を連結すれば安定して当たる。
async function ensureFeedLanguage(
  env: Env,
  feedId: number,
  current: string | null,
  now: string,
): Promise<string | null> {
  if (current) return current;
  const { results } = await env.DB.prepare(
    `SELECT title, rss_summary FROM articles WHERE feed_id = ? ORDER BY id DESC LIMIT 60`,
  )
    .bind(feedId)
    .all<{ title: string; rss_summary: string | null }>();
  if (results.length === 0) return null;

  const detected = detectFeedLanguage(
    null,
    results.map((row) => ({ title: row.title, summary: row.rss_summary })),
  );
  if (detected.confidence !== "high" || !detected.language) return null;
  await env.DB.prepare(
    "UPDATE feeds SET language = ?, language_source = 'detected', updated_at = ? WHERE id = ?",
  )
    .bind(detected.language, now, feedId)
    .run();
  return detected.language;
}

// source_language が未設定の記事を、保存済みのタイトルと説明文から埋める
async function backfillArticleLanguages(
  env: Env,
  feedId: number,
  feedLanguage: string | null,
  now: string,
): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT id, title, rss_summary FROM articles
     WHERE feed_id = ? AND source_language IS NULL
     ORDER BY id DESC LIMIT 500`,
  )
    .bind(feedId)
    .all<{ id: number; title: string; rss_summary: string | null }>();
  if (results.length === 0) return;

  const updates = [];
  for (const row of results) {
    const language = detectArticleLanguage(`${row.title} ${row.rss_summary ?? ""}`, feedLanguage).language;
    if (!language) continue;
    updates.push(
      env.DB.prepare("UPDATE articles SET source_language = ?, updated_at = ? WHERE id = ?")
        .bind(language, now, row.id),
    );
  }
  for (let i = 0; i < updates.length; i += 50) {
    await env.DB.batch(updates.slice(i, i + 50));
  }
}

interface PreparedArticle {
  dedupeKey: string;
  guid: string | null;
  canonicalUrl: string | null;
  title: string;
  author: string | null;
  summary: string | null;
  contentHtml: string | null;
  sourceLanguage: string | null;
  publishedAt: string | null;
}

interface ExistingArticle {
  id: number;
  dedupe_key: string;
  title: string;
  author: string | null;
  rss_summary: string | null;
  rss_content_html: string | null;
  canonical_url: string | null;
  published_at: string | null;
  source_language: string | null;
}

// Mirrors the UPDATE below: a missing URL/date in the feed never clears the
// stored value, and the source language is only filled once.
function articleChanged(current: ExistingArticle, item: PreparedArticle): boolean {
  return current.title !== item.title
    || current.author !== item.author
    || current.rss_summary !== item.summary
    || current.rss_content_html !== item.contentHtml
    || (item.canonicalUrl !== null && current.canonical_url !== item.canonicalUrl)
    || (item.publishedAt !== null && current.published_at !== item.publishedAt)
    || (current.source_language === null && item.sourceLanguage !== null);
}

/**
 * Feed items are shared data. A fetch can contain up to 200 items, so doing a
 * SELECT followed by an UPDATE/INSERT for each item creates hundreds of D1
 * round trips. Read the existing rows in one batch, compare them here, and
 * send an UPDATE only for articles that actually changed. Most items of a
 * refetched feed are unchanged, so they cost the lookup read and nothing else.
 */
async function ingestArticles(
  env: Env,
  feedId: number,
  items: ParsedFeed["items"],
  feedLanguage: string | null,
  now: string,
): Promise<number[]> {
  const byDedupeKey = new Map<string, PreparedArticle>();
  for (const item of items.slice(0, 200)) {
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
    const sourceLanguage = detectArticleLanguage(
      `${item.title} ${item.summary ?? ""}`,
      feedLanguage,
    ).language;
    byDedupeKey.set(dedupeKey, {
      dedupeKey,
      guid: item.guid,
      canonicalUrl,
      title: item.title,
      author: item.author,
      summary: item.summary,
      contentHtml: item.contentHtml,
      sourceLanguage,
      publishedAt: item.publishedAt,
    });
  }

  const prepared = [...byDedupeKey.values()];
  const existing = new Map<string, ExistingArticle>();
  const lookupStatements: D1PreparedStatement[] = [];
  for (let i = 0; i < prepared.length; i += 80) {
    const chunk = prepared.slice(i, i + 80);
    const placeholders = chunk.map(() => "?").join(",");
    lookupStatements.push(
      env.DB.prepare(
        `SELECT id, dedupe_key, title, author, rss_summary, rss_content_html,
                canonical_url, published_at, source_language
         FROM articles
         WHERE feed_id = ? AND dedupe_key IN (${placeholders})`,
      ).bind(feedId, ...chunk.map((item) => item.dedupeKey)),
    );
  }
  if (lookupStatements.length > 0) {
    const lookupResults = await env.DB.batch(lookupStatements);
    recordD1BatchMeta("feed_ingest.lookup_keys", lookupResults, { item_count: prepared.length });
    for (const result of lookupResults) {
      for (const row of result.results as unknown as ExistingArticle[]) {
        existing.set(row.dedupe_key, row);
      }
    }
  }

  const updates: D1PreparedStatement[] = [];
  const inserts: D1PreparedStatement[] = [];
  for (const item of prepared) {
    const current = existing.get(item.dedupeKey);
    if (current !== undefined) {
      if (!articleChanged(current, item)) continue;
      updates.push(
        env.DB.prepare(
          `UPDATE articles SET title = ?, author = ?, rss_summary = ?, rss_content_html = ?,
             canonical_url = COALESCE(?, canonical_url), published_at = COALESCE(?, published_at),
             source_language = COALESCE(source_language, ?), updated_at = ?
           WHERE id = ?`,
        ).bind(
          item.title,
          item.author,
          item.summary,
          item.contentHtml,
          item.canonicalUrl,
          item.publishedAt,
          item.sourceLanguage,
          now,
          current.id,
        ),
      );
      continue;
    }
    inserts.push(
      env.DB.prepare(
        `INSERT INTO articles
           (feed_id, guid, canonical_url, dedupe_key, title, author, rss_summary,
            rss_content_html, source_language, published_at, fetched_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (feed_id, dedupe_key) DO NOTHING
         RETURNING id`,
      ).bind(
        feedId,
        item.guid,
        item.canonicalUrl,
        item.dedupeKey,
        item.title,
        item.author,
        item.summary,
        item.contentHtml,
        item.sourceLanguage,
        item.publishedAt,
        now,
        now,
        now,
      ),
    );
  }

  for (let i = 0; i < updates.length; i += 50) {
    const results = await env.DB.batch(updates.slice(i, i + 50));
    recordD1BatchMeta("feed_ingest.update_articles", results, { item_count: results.length });
  }

  const newArticleIds: number[] = [];
  for (let i = 0; i < inserts.length; i += 50) {
    const chunk = inserts.slice(i, i + 50);
    const results = await env.DB.batch(chunk);
    recordD1BatchMeta("feed_ingest.insert_articles", results, { item_count: chunk.length });
    for (const result of results) {
      const inserted = (result.results?.[0] ?? null) as { id?: number } | null;
      if (inserted?.id !== undefined) newArticleIds.push(inserted.id);
    }
  }
  return newArticleIds;
}

export async function runFetchFeed(
  env: Env,
  feedId: number,
  reason: "initial" | "refresh" | "retry_initial"
): Promise<void> {
  const feed = await env.DB.prepare("SELECT id, feed_url, status, language, language_source FROM feeds WHERE id = ?")
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
      if (fetched.permanentRedirect) {
        await updateFeedUrl(env, feedId, fetched.finalUrl, now);
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
    // フィード言語は発行者の申告を最優先し、無ければ全 item を連結した長文から判定する。
    // 単独のタイトルでは誤判定するが、連結すれば安定して当たる(lib/languageDetect.ts)。
    const detectedFeed = detectFeedLanguage(
      parsed.language,
      parsed.items.map((item) => ({ title: item.title, summary: item.summary })),
    );
    // 申告済みのフィードを判定結果で上書きしない。判定結果も確度が低ければ据え置く
    const keepExisting = feed.language_source === "declared" && !parsed.language;
    const nextLanguage = keepExisting || detectedFeed.confidence !== "high" ? null : detectedFeed.language;
    const nextLanguageSource = nextLanguage == null ? null : (parsed.language ? "declared" : "detected");
    await env.DB.prepare(
      `UPDATE feeds SET title = ?, site_url = COALESCE(?, site_url), description = ?,
       favicon_url = COALESCE(?, favicon_url), language = COALESCE(?, language),
       language_source = COALESCE(?, language_source), updated_at = ?
       WHERE id = ?
         AND (
           title IS NOT ?
           OR description IS NOT ?
           OR (? IS NOT NULL AND site_url IS NOT ?)
           OR (? IS NOT NULL AND favicon_url IS NOT ?)
           OR (? IS NOT NULL AND language IS NOT ?)
           OR (? IS NOT NULL AND language_source IS NOT ?)
         )`,
    )
      .bind(
        parsed.title, parsed.siteUrl, parsed.description, faviconUrl,
        nextLanguage, nextLanguageSource, now, feedId,
        parsed.title, parsed.description,
        parsed.siteUrl, parsed.siteUrl,
        faviconUrl, faviconUrl,
        nextLanguage, nextLanguage,
        nextLanguageSource, nextLanguageSource,
      )
      .run();
    const feedLanguage = nextLanguage ?? feed.language;

    const newArticleIds = await ingestArticles(env, feedId, parsed.items, feedLanguage, now);

    // feeds.article_count and the subscribers' unread counters are advanced
    // by the article insert trigger (migration 0019), in the same statement
    // as each insert.

    // 保存済み記事からのフィード言語判定は、記事が増えたときだけ結果が変わりうる。
    // 304 や新着なしで毎回やり直すと、同じ行を読んで同じ結論を出すだけになる。
    const language = newArticleIds.length > 0
      ? await ensureFeedLanguage(env, feedId, feedLanguage, now)
      : feedLanguage;
    // 言語が未設定の記事は、フィード言語が変わったときにだけ新たに判定できる。
    // 同じフィード言語で判定し直しても同じ null が返るので、読み直さない。
    if (language && language !== feed.language) {
      await backfillArticleLanguages(env, feedId, language, now);
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

    // user-driven one-shot recovery reactivates a paused feed on success
    if (feed.status === "paused" && reason === "retry_initial") {
      await env.DB.prepare("UPDATE feeds SET status = 'active', updated_at = ? WHERE id = ?").bind(now, feedId).run();
    }

    if (canonicalFeedUrl !== feed.feed_url) {
      await updateFeedUrl(env, feedId, canonicalFeedUrl, now);
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
