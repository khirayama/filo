import type { Env } from "../env";
import { discoverFeed } from "../lib/discovery";
import { parseOpml } from "../lib/opml";
import { canonicalizeFeedUrl } from "../lib/net";
import { createSubscription, findOrCreateFeed } from "../lib/subscriptions";
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
      let feedUrl: string;
      try {
        feedUrl = canonicalizeFeedUrl(outline.feedUrl);
      } catch {
        throw new Error("invalid feed URL");
      }

      let feedId = (await env.DB.prepare("SELECT id FROM feeds WHERE feed_url = ?")
        .bind(feedUrl)
        .first<{ id: number }>())?.id;
      if (feedId === undefined) {
        let discovered: Awaited<ReturnType<typeof discoverFeed>> | null = null;
        let discoveryError: unknown = null;
        for (const inputUrl of [outline.feedUrl, outline.siteUrl]) {
          if (!inputUrl) continue;
          try {
            discovered = await discoverFeed(inputUrl);
            break;
          } catch (error) {
            discoveryError = error;
          }
        }
        if (!discovered) throw discoveryError instanceof Error ? discoveryError : new Error("feed discovery failed");
        feedId = await findOrCreateFeed(env.DB, discovered);
      }

      const subscriptionId = await createSubscription(env.DB, env.JOBS, job.user_id, feedId, {
        customTitle: outline.title,
        tagNames: outline.tagNames,
      });
      if (subscriptionId === null) {
        skipped++;
        continue;
      }
      created++;
    } catch (error) {
      failed++;
      failures.push({ feedUrl: outline.feedUrl, reason: error instanceof Error ? error.message : "unknown error" });
    }
  }

  await finish("completed", { total: outlines.total, created, skipped, failed }, failures);
}
