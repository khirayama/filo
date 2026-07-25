import { supportedLanguagesCte } from "./translate";

// Per-feed translation coverage, derived from stored rows so the numbers stay
// honest regardless of what jobs claim. Every article needs one row for every
// supported target language; every such pair is exactly one of:
//   missing    — no row yet (未リクエスト)
//   queued     — pending, not yet picked up by the drain (順番待ち)
//   processing — pending, in flight to the model (翻訳中 / LLM応答待ち)
//   ready      — done (完了)
//   error      — gave up after retries (失敗)
// `pending` is kept as queued + processing for callers that only need the
// in-queue total.
export interface FeedTranslationCoverage {
  articles: number;
  untranslatable: number;
  needed: number;
  ready: number;
  failed: number;
  queued: number;
  processing: number;
  pending: number;
  missing: number;
  lastError: string | null;
}

const EMPTY_COVERAGE: FeedTranslationCoverage = {
  articles: 0,
  untranslatable: 0,
  needed: 0,
  ready: 0,
  failed: 0,
  queued: 0,
  processing: 0,
  pending: 0,
  missing: 0,
  lastError: null,
};

export function emptyCoverage(): FeedTranslationCoverage {
  return { ...EMPTY_COVERAGE };
}

export async function feedTranslationCoverage(
  db: D1Database,
  userId: number,
): Promise<Map<number, FeedTranslationCoverage>> {
  const coverage = new Map<number, FeedTranslationCoverage>();

  const { results: articleRows } = await db.prepare(
    `SELECT a.feed_id,
            COUNT(*) AS articles,
            SUM(CASE WHEN a.title IS NULL OR a.title = '' THEN 1 ELSE 0 END) AS untranslatable
     FROM articles a
     JOIN subscriptions s ON s.feed_id = a.feed_id AND s.user_id = ?
     GROUP BY a.feed_id`,
  )
    .bind(userId)
    .all<{ feed_id: number; articles: number; untranslatable: number | null }>();
  for (const row of articleRows) {
    coverage.set(row.feed_id, {
      ...emptyCoverage(),
      articles: row.articles,
      untranslatable: row.untranslatable ?? 0,
    });
  }

  const { results: pairRows } = await db.prepare(
    `WITH ${supportedLanguagesCte()}
     SELECT a.feed_id,
            COUNT(*) AS needed,
            SUM(CASE WHEN t.status = 'ready' THEN 1 ELSE 0 END) AS ready,
            SUM(CASE WHEN t.status = 'error' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN t.status = 'pending' AND t.processing_at IS NULL THEN 1 ELSE 0 END) AS queued,
            SUM(CASE WHEN t.status = 'pending' AND t.processing_at IS NOT NULL THEN 1 ELSE 0 END) AS processing
     FROM articles a
     JOIN subscriptions s ON s.feed_id = a.feed_id AND s.user_id = ?
     CROSS JOIN langs
     LEFT JOIN article_listing_translations t ON t.article_id = a.id AND t.language = langs.lang
     WHERE a.title IS NOT NULL AND a.title != ''
     GROUP BY a.feed_id`,
  )
    .bind(userId)
    .all<{ feed_id: number; needed: number; ready: number | null; failed: number | null; queued: number | null; processing: number | null }>();
  for (const row of pairRows) {
    const entry = coverage.get(row.feed_id) ?? emptyCoverage();
    entry.needed = row.needed;
    entry.ready = row.ready ?? 0;
    entry.failed = row.failed ?? 0;
    entry.queued = row.queued ?? 0;
    entry.processing = row.processing ?? 0;
    entry.pending = entry.queued + entry.processing;
    entry.missing = Math.max(entry.needed - entry.ready - entry.failed - entry.pending, 0);
    coverage.set(row.feed_id, entry);
  }

  // Latest error message per feed (SQLite's bare-column-with-MAX picks the
  // message from the most recently updated error row).
  const { results: errorRows } = await db.prepare(
    `SELECT a.feed_id, t.error_message, MAX(t.updated_at) AS updated_at
     FROM article_listing_translations t
     JOIN articles a ON a.id = t.article_id
     JOIN subscriptions s ON s.feed_id = a.feed_id AND s.user_id = ?
     WHERE t.status = 'error' AND t.error_message IS NOT NULL
     GROUP BY a.feed_id`,
  )
    .bind(userId)
    .all<{ feed_id: number; error_message: string | null }>();
  for (const row of errorRows) {
    const entry = coverage.get(row.feed_id);
    if (entry) entry.lastError = row.error_message;
  }

  return coverage;
}
