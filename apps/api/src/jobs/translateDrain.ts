import type { Env } from "../env";
import {
  BATCH_MAX_TITLES,
  MAX_TRANSLATION_ATTEMPTS,
  assessTranslation,
  callTranslationApi,
  countPendingTranslations,
  pacingMsForTokens,
  type TranslationCallOutcome,
} from "../lib/translate";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "../lib/languages";
import { nowIso } from "../lib/util";

// One drain is bounded by wall-clock time so a queue invocation always
// finishes promptly; leftover pending rows are handled by re-enqueueing the
// drain message (the queue's max_concurrency=1 keeps drains serialized).
const RUN_TIME_BUDGET_MS = 60_000;

// How many pending rows one snapshot pulls from D1. Batches are packed from
// this snapshot; the loop re-selects once a snapshot is exhausted.
const SNAPSHOT_LIMIT = 200;

// Batches sent to the model at the same time. Decoding is memory-bandwidth
// bound on weights that the sequences share, so two concurrent batches measure
// ~7.9s per title against ~10s serially. Four concurrent was slower than two,
// and the local server must be started with a matching parallel slot count
// (`lms load --parallel 2`) or it just queues the second request.
const CONCURRENT_BATCHES = 2;

interface PendingRow {
  article_id: number;
  language: string;
  attempt_count: number;
  title: string | null;
}

interface WorkItem {
  articleId: number;
  title: string;
  langs: Array<{ lang: SupportedLanguage; attempts: number }>;
}

interface WorkBatch {
  targetLangs: SupportedLanguage[];
  items: WorkItem[];
}

export interface DrainResult {
  translated: number;
  failed: number;
  remaining: number;
  rateLimited: boolean;
}

async function selectPendingRows(env: Env): Promise<PendingRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT t.article_id, t.language, t.attempt_count, a.title
     FROM article_listing_translations t
     JOIN articles a ON a.id = t.article_id
     WHERE t.status = 'pending'
     ORDER BY t.article_id DESC
     LIMIT ${SNAPSHOT_LIMIT}`,
  ).all<PendingRow>();
  return results;
}

// Pack a snapshot into batches without using any stored or feed-level source
// language. The AI identifies source_lang for each article.
function planBatches(rows: PendingRow[]): { batches: WorkBatch[]; stale: PendingRow[] } {
  const stale: PendingRow[] = [];
  const byArticle = new Map<number, { title: string; langs: WorkItem["langs"] }>();
  for (const row of rows) {
    const language = row.language as SupportedLanguage;
    if (!row.title || !SUPPORTED_LANGUAGES.includes(language)) {
      stale.push(row);
      continue;
    }
    const entry = byArticle.get(row.article_id) ?? { title: row.title, langs: [] };
    entry.langs.push({ lang: language, attempts: row.attempt_count });
    byArticle.set(row.article_id, entry);
  }

  const items: WorkItem[] = [...byArticle.entries()].map(([articleId, entry]) => ({
    articleId,
    title: entry.title,
    langs: entry.langs,
  }));

  // Request only the languages actually pending in each batch, not every
  // supported language. When most articles are already translated into some
  // languages (e.g. a backlog of only zh/ko/es), asking for all five would
  // regenerate the finished ones and discard the output — pure wasted
  // generation on a local model. targetLangs is the union of the batch's
  // pending languages, kept in SUPPORTED_LANGUAGES order for deterministic
  // output.
  const batches: WorkBatch[] = [];
  for (let i = 0; i < items.length; i += BATCH_MAX_TITLES) {
    const chunk = items.slice(i, i + BATCH_MAX_TITLES);
    const needed = new Set<SupportedLanguage>();
    for (const item of chunk) for (const { lang } of item.langs) needed.add(lang);
    const targetLangs = SUPPORTED_LANGUAGES.filter((lang) => needed.has(lang));
    batches.push({ targetLangs, items: chunk });
  }
  return { batches, stale };
}

// Mark a batch's (article, language) pairs as in flight to the model, or clear
// the mark. `processing_at` distinguishes 翻訳中 (awaiting the model) from
// 順番待ち (queued) on the status screen; setting it also bumps updated_at so
// the watchdog counts the claim as live activity.
async function setBatchProcessing(env: Env, batch: WorkBatch, at: string | null): Promise<void> {
  const now = nowIso();
  const statements = batch.items.flatMap((item) =>
    item.langs.map(({ lang }) =>
      env.DB.prepare(
        "UPDATE article_listing_translations SET processing_at = ?, updated_at = ? WHERE article_id = ? AND language = ?",
      ).bind(at, now, item.articleId, lang),
    ),
  );
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
}

// Turn one model outcome into the row updates it implies. Every pair in the
// batch either becomes ready or has an attempt recorded against it, so a
// batch that reaches this point always changes state.
function statementsForOutcome(
  env: Env,
  batch: WorkBatch,
  outcome: TranslationCallOutcome,
): { statements: D1PreparedStatement[]; translated: number; failed: number } {
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  let translated = 0;
  let failed = 0;

  for (const item of batch.items) {
    const got = outcome.byId?.get(item.articleId);
    if (got?.sourceLang) {
      statements.push(
        env.DB.prepare("UPDATE articles SET source_language = ?, updated_at = ? WHERE id = ?")
          .bind(got.sourceLang, now, item.articleId),
      );
    }
    for (const { lang, attempts } of item.langs) {
      const value = got?.translations[lang];
      const assessment = value
        ? assessTranslation(value, item.title, lang, got?.sourceLang)
        : null;
      if (value && assessment?.displayable) {
        if (assessment.severity === "warning") {
          console.log(`[translate] accepted output with validation warning: article=${item.articleId} language=${lang} reason=${assessment.reason ?? "unspecified"}`);
        }
        statements.push(
          env.DB.prepare(
            `UPDATE article_listing_translations
             SET title = ?, status = 'ready', attempt_count = 0, error_message = NULL,
                 processing_at = NULL, updated_at = ?
             WHERE article_id = ? AND language = ?`,
          ).bind(value, now, item.articleId, lang),
        );
        translated++;
      } else {
        const reason = (outcome.failureReason
          ?? (value
            ? `model returned ${assessment?.reason ?? "unusable output"}: ${JSON.stringify(value)}`
            : "model response was missing this item")).slice(0, 200);
        const exhausted = attempts + 1 >= MAX_TRANSLATION_ATTEMPTS;
        statements.push(
          env.DB.prepare(
            `UPDATE article_listing_translations
             SET attempt_count = ?, status = ?, error_message = ?,
                 processing_at = NULL, updated_at = ?
             WHERE article_id = ? AND language = ?`,
          ).bind(attempts + 1, exhausted ? "error" : "pending", reason, now, item.articleId, lang),
        );
        if (exhausted) failed++;
      }
    }
  }
  return { statements, translated, failed };
}

// Drain pending translation rows until the time budget runs out, then
// re-enqueue the drain message if work remains. All state lives in
// article_listing_translations, so a duplicate or lost message never loses
// work — the next drain picks up exactly where this one stopped.
export async function runTranslateDrain(env: Env): Promise<DrainResult> {
  const deadline = Date.now() + RUN_TIME_BUDGET_MS;
  let translated = 0;
  let failed = 0;
  let rateLimited = false;
  // Seconds the *next* drain should wait before its first request (token
  // pacing that crosses the run boundary, or the provider's Retry-After).
  let requeueDelaySeconds = 0;
  let pendingPaceMs = 0;

  // The queue runs one drain at a time, so nothing is legitimately in flight
  // when this one starts: clear any processing marks a previous crashed drain
  // left behind so those pairs count as 順番待ち again.
  await env.DB.prepare(
    "UPDATE article_listing_translations SET processing_at = NULL WHERE status = 'pending' AND processing_at IS NOT NULL",
  ).run();

  outer: while (Date.now() < deadline) {
    const rows = await selectPendingRows(env);
    if (rows.length === 0) break;
    const { batches, stale } = planBatches(rows);

    if (stale.length > 0) {
      const statements = stale.map((row) =>
        env.DB.prepare("DELETE FROM article_listing_translations WHERE article_id = ? AND language = ?")
          .bind(row.article_id, row.language),
      );
      for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
    }
    if (batches.length === 0) continue;

    let progressed = 0;
    for (let i = 0; i < batches.length; i += CONCURRENT_BATCHES) {
      if (Date.now() > deadline) break outer;
      const group = batches.slice(i, i + CONCURRENT_BATCHES);
      if (pendingPaceMs > 0) await new Promise((r) => setTimeout(r, pendingPaceMs));

      // Claim every batch of the group as 翻訳中 before the (tens-of-seconds)
      // model calls so the status screen shows exactly what is in flight.
      for (const batch of group) {
        console.log(`[translate] batch →${batch.targetLangs.join("/")}: ${batch.items.length} titles`);
        await setBatchProcessing(env, batch, nowIso());
      }

      const outcomes = await Promise.all(group.map((batch) =>
        callTranslationApi(
          env,
          batch.items.map((item) => ({ id: item.articleId, text: item.title })),
          batch.targetLangs,
        ),
      ));

      // A sibling batch that came back rate limited must not discard the one
      // that succeeded: its generation is already paid for. Results are
      // written first, and the drain stops afterwards.
      let limited: TranslationCallOutcome | null = null;
      // Concurrent requests spend the token budget together, so the group is
      // paced on its combined usage rather than on one batch's.
      let groupTokens = 0;
      for (const [index, outcome] of outcomes.entries()) {
        const batch = group[index]!;
        if (outcome.rateLimited) {
          limited = outcome;
          // Never translated: un-claim so it shows as 順番待ち, not stuck 翻訳中.
          await setBatchProcessing(env, batch, null);
          continue;
        }
        groupTokens += outcome.tokensUsed;

        const applied = statementsForOutcome(env, batch, outcome);
        translated += applied.translated;
        failed += applied.failed;
        for (let j = 0; j < applied.statements.length; j += 50) {
          await env.DB.batch(applied.statements.slice(j, j + 50));
        }
        progressed += applied.statements.length;
      }
      pendingPaceMs = pacingMsForTokens(env, groupTokens);
      requeueDelaySeconds = Math.ceil(pendingPaceMs / 1000);
      if (limited) {
        rateLimited = true;
        requeueDelaySeconds = Math.min(Math.max(limited.retryAfterSeconds ?? 60, 30), 300);
        break outer;
      }
    }
    // Every processed pair changes state (ready, error, or attempt_count+1),
    // so zero progress means nothing was processable; stop instead of spinning.
    if (progressed === 0) break;
  }

  const remaining = await countPendingTranslations(env);
  console.log(`[translate] drain: translated=${translated} failed=${failed} remaining=${remaining} rateLimited=${rateLimited}`);

  if (remaining > 0) {
    // No progress without a rate limit means the provider is failing; back off
    // a minute so retries do not burn the request quota.
    const delaySeconds = rateLimited
      ? requeueDelaySeconds
      : translated > 0
        ? requeueDelaySeconds
        : Math.max(requeueDelaySeconds, 60);
    await env.TRANSLATE_JOBS.send({ jobType: "translate_drain" }, { delaySeconds });
  }
  return { translated, failed, remaining, rateLimited };
}
