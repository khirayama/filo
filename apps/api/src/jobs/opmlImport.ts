import type { Env } from "../env";
import { discoverFeed, faviconUrlFor } from "../lib/discovery";
import { parseOpml } from "../lib/opml";
import { feedUrlAliases } from "../lib/net";
import { attachTags, resolveTagIdsByNames } from "../lib/tagops";
import { nowIso } from "../lib/util";

interface OpmlJobRow {
  id: number;
  user_id: number;
  status: string;
  source_xml: string | null;
}

const MAX_FAILURE_SUMMARY = 50;

export async function runOpmlImport(env: Env, opmlJobId: number): Promise<void> {
  const job = await env.DB.prepare("SELECT id, user_id, status, source_xml FROM opml_import_jobs WHERE id = ?")
    .bind(opmlJobId)
    .first<OpmlJobRow>();
  if (!job || job.status === "completed" || job.status === "failed") return;

  const now = nowIso();
  await env.DB.prepare("UPDATE opml_import_jobs SET status = 'running', updated_at = ? WHERE id = ?")
    .bind(now, opmlJobId)
    .run();

  const finish = async (
    status: "completed" | "failed",
    counts: { total: number; created: number; skipped: number; failed: number },
    failures: Array<{ feedUrl: string; reason: string }>
  ) => {
    const finishedAt = nowIso();
    await env.DB.prepare(
      `UPDATE opml_import_jobs SET status = ?, total_count = ?, created_count = ?, skipped_count = ?, failed_count = ?,
         failure_summary_json = ?, source_xml = NULL, updated_at = ?, finished_at = ? WHERE id = ?`
    )
      .bind(
        status,
        counts.total,
        counts.created,
        counts.skipped,
        counts.failed,
        JSON.stringify(failures.slice(0, MAX_FAILURE_SUMMARY)),
        finishedAt,
        finishedAt,
        opmlJobId
      )
      .run();
  };

  let outlines;
  try {
    if (!job.source_xml) throw new Error("missing OPML payload");
    outlines = parseOpml(job.source_xml);
  } catch (error) {
    await finish("failed", { total: 0, created: 0, skipped: 0, failed: 0 }, [
      { feedUrl: "-", reason: error instanceof Error ? error.message : "invalid OPML" },
    ]);
    return;
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;
  const failures: Array<{ feedUrl: string; reason: string }> = [];

  for (const outline of outlines.outlines) {
    try {
      let feedUrlAliasesForOutline: [string, string];
      try {
        feedUrlAliasesForOutline = feedUrlAliases(outline.feedUrl);
      } catch {
        throw new Error("invalid feed URL");
      }

      let feed = await env.DB.prepare("SELECT id FROM feeds WHERE feed_url IN (?, ?) LIMIT 1")
        .bind(...feedUrlAliasesForOutline)
        .first<{ id: number }>();
      if (!feed) {
        const discovered = await discoverFeed(outline.feedUrl);
        const discoveredAliases = feedUrlAliases(discovered.feedUrl);
        feed = await env.DB.prepare("SELECT id FROM feeds WHERE feed_url IN (?, ?) LIMIT 1")
          .bind(...discoveredAliases)
          .first<{ id: number }>();
        if (!feed) {
          const ts = nowIso();
          feed = await env.DB.prepare(
            `INSERT INTO feeds (feed_url, site_url, title, description, favicon_url, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'active', ?, ?) RETURNING id`
          )
            .bind(
              discovered.feedUrl,
              discovered.parsed.siteUrl,
              discovered.parsed.title,
              discovered.parsed.description,
              await faviconUrlFor(discovered.parsed.siteUrl, discovered.feedUrl),
              ts,
              ts
            )
            .first<{ id: number }>();
        }
      }
      if (!feed) throw new Error("could not create feed");

      const existing = await env.DB.prepare("SELECT id FROM subscriptions WHERE user_id = ? AND feed_id = ?")
        .bind(job.user_id, feed.id)
        .first();
      if (existing) {
        skipped++;
        continue;
      }

      const fetchState = await env.DB.prepare("SELECT last_success_fetched_at FROM feed_fetch_states WHERE feed_id = ?")
        .bind(feed.id)
        .first<{ last_success_fetched_at: string | null }>();
      const hasArticles = await env.DB.prepare("SELECT id FROM articles WHERE feed_id = ? LIMIT 1").bind(feed.id).first();
      const isReady = Boolean(fetchState?.last_success_fetched_at) || Boolean(hasArticles);

      const maxOrder = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM subscriptions WHERE user_id = ?")
        .bind(job.user_id)
        .first<{ m: number }>();
      const ts = nowIso();
      const inserted = await env.DB.prepare(
        `INSERT INTO subscriptions (user_id, feed_id, custom_title, sort_order, initial_fetch_status, initial_fetch_requested_at, initial_fetch_completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
        .bind(job.user_id, feed.id, outline.title, (maxOrder?.m ?? 0) + 10, isReady ? "ready" : "fetching", ts, isReady ? ts : null, ts, ts)
        .first<{ id: number }>();
      if (!inserted) throw new Error("could not create subscription");

      if (outline.tagNames.length > 0) {
        const tagIds = await resolveTagIdsByNames(env.DB, job.user_id, outline.tagNames);
        await attachTags(env.DB, inserted.id, tagIds);
      }
      if (!isReady) {
        await env.JOBS.send({ jobType: "fetch_feed", feedId: feed.id, reason: "initial", attempt: 1 });
      }
      created++;
    } catch (error) {
      failed++;
      failures.push({ feedUrl: outline.feedUrl, reason: error instanceof Error ? error.message : "unknown error" });
    }
  }

  await finish("completed", { total: outlines.total, created, skipped, failed }, failures);
}
