import { Hono } from "hono";
import type { AppContext } from "../lib/auth";
import { errors } from "../lib/errors";
import { buildOpml, type OpmlExportEntry } from "../lib/opml";
import { nowIso, toIso } from "../lib/util";

const MAX_OPML_BYTES = 5 * 1024 * 1024;

interface OpmlJobRow {
  id: number;
  status: string;
  total_count: number;
  created_count: number;
  skipped_count: number;
  failed_count: number;
  failure_summary_json: string | null;
  created_at: string;
  finished_at: string | null;
}

function serializeJob(row: OpmlJobRow) {
  const base = {
    jobId: `opml_${row.id}`,
    status: row.status,
    queuedAt: toIso(row.created_at),
  };
  if (row.status !== "completed" && row.status !== "failed") return base;
  let failures: unknown[] = [];
  if (row.failure_summary_json) {
    try {
      failures = JSON.parse(row.failure_summary_json) as unknown[];
    } catch {
      failures = [];
    }
  }
  return {
    ...base,
    finishedAt: toIso(row.finished_at),
    total: row.total_count,
    created: row.created_count,
    skipped: row.skipped_count,
    failed: row.failed_count,
    failures,
  };
}

export const opmlRoutes = new Hono<AppContext>()
  .post("/import", async (c) => {
    const user = c.get("user");
    const contentType = c.req.header("Content-Type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      throw errors.validation("multipart/form-data upload is required");
    }
    const form = await c.req.formData().catch(() => null);
    if (!form) throw errors.validation("invalid form data");
    const file = form.get("file") as unknown;
    if (!(file instanceof File)) throw errors.validation("file field is required");
    if (file.size > MAX_OPML_BYTES) throw errors.tooLarge("OPML file exceeds 5MB");
    const xml = await file.text();

    const now = nowIso();
    const inserted = await c.env.DB.prepare(
      "INSERT INTO opml_import_jobs (user_id, status, source_xml, created_at, updated_at) VALUES (?, 'pending', ?, ?, ?) RETURNING id, status, total_count, created_count, skipped_count, failed_count, failure_summary_json, created_at, finished_at"
    )
      .bind(user.id, xml, now, now)
      .first<OpmlJobRow>();
    if (!inserted) throw errors.internal();

    await c.env.JOBS.send({ jobType: "opml_import", opmlJobId: inserted.id, attempt: 1 });
    return c.json({ data: serializeJob(inserted) }, 202);
  })
  .get("/imports/:jobId", async (c) => {
    const user = c.get("user");
    const raw = c.req.param("jobId");
    const match = raw.match(/^opml_(\d+)$/);
    if (!match) throw errors.validation("invalid jobId");
    const row = await c.env.DB.prepare(
      "SELECT id, status, total_count, created_count, skipped_count, failed_count, failure_summary_json, created_at, finished_at FROM opml_import_jobs WHERE id = ? AND user_id = ?"
    )
      .bind(Number(match[1]), user.id)
      .first<OpmlJobRow>();
    if (!row) throw errors.notFound("opml_import_not_found", "Import job not found");
    return c.json({ data: serializeJob(row) });
  })
  .get("/export", async (c) => {
    const user = c.get("user");
    const { results } = await c.env.DB.prepare(
      `SELECT s.id AS subscription_id, s.custom_title, f.title AS feed_title, f.feed_url, f.site_url
       FROM subscriptions s JOIN feeds f ON f.id = s.feed_id
       WHERE s.user_id = ? ORDER BY s.sort_order ASC, s.id ASC`
    )
      .bind(user.id)
      .all<{ subscription_id: number; custom_title: string | null; feed_title: string; feed_url: string; site_url: string | null }>();

    const { results: tagRows } = await c.env.DB.prepare(
      `SELECT st.subscription_id, t.name FROM subscription_tags st
       JOIN tags t ON t.id = st.tag_id
       JOIN subscriptions s ON s.id = st.subscription_id
       WHERE s.user_id = ?`
    )
      .bind(user.id)
      .all<{ subscription_id: number; name: string }>();
    const tagsBySubscription = new Map<number, string[]>();
    for (const row of tagRows) {
      const list = tagsBySubscription.get(row.subscription_id) ?? [];
      list.push(row.name);
      tagsBySubscription.set(row.subscription_id, list);
    }

    const entries: OpmlExportEntry[] = results.map((row) => ({
      title: row.custom_title ?? row.feed_title,
      feedUrl: row.feed_url,
      siteUrl: row.site_url,
      tagNames: tagsBySubscription.get(row.subscription_id) ?? [],
    }));

    return new Response(buildOpml(entries), {
      headers: {
        "Content-Type": "text/x-opml; charset=utf-8",
        "Content-Disposition": 'attachment; filename="filo-subscriptions.opml"',
        "Cache-Control": "no-store",
      },
    });
  });
