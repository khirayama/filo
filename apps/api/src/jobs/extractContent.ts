import type { Env } from "../env";
import { extractFromHtml, extractFromRssContent } from "../lib/extract";
import { readTextCapped, safeFetch } from "../lib/net";
import { nowIso } from "../lib/util";

export async function runExtractContent(
  env: Env,
  articleId: number,
): Promise<void> {
  const article = await env.DB.prepare(
    `SELECT a.id, a.canonical_url, a.rss_content_html, a.rss_summary
     FROM articles a
     WHERE a.id = ?`,
  )
    .bind(articleId)
    .first<{
      id: number;
      canonical_url: string | null;
      rss_content_html: string | null;
      rss_summary: string | null;
    }>();
  if (!article) return;

  const now = nowIso();

  const rssExtract = extractFromRssContent(
    article.rss_content_html,
    article.rss_summary,
  );

  let result = rssExtract;

  if (!result && article.canonical_url) {
    try {
      const { response } = await safeFetch(article.canonical_url, {
        headers: { Accept: "text/html,application/xhtml+xml" },
        timeoutMs: 15_000,
      });
      if (response.ok) {
        const html = await readTextCapped(response);
        result = extractFromHtml(html, article.canonical_url);
      }
    } catch {
      // URL fetch failed — fall through to error
    }
  }

  if (!result) {
    await env.DB.prepare(
      `INSERT INTO article_contents (article_id, status, error_message, created_at, updated_at)
       VALUES (?, 'error', 'extraction failed', ?, ?)
       ON CONFLICT (article_id) DO UPDATE SET
         status = 'error', error_message = 'extraction failed', updated_at = excluded.updated_at`,
    )
      .bind(articleId, now, now)
      .run();
    return;
  }

  await env.DB.prepare(
    `INSERT INTO article_contents (article_id, text, html, status, created_at, updated_at)
     VALUES (?, ?, ?, 'ready', ?, ?)
     ON CONFLICT (article_id) DO UPDATE SET
       text = excluded.text, html = excluded.html,
       status = 'ready', error_message = NULL, updated_at = excluded.updated_at`,
  )
    .bind(articleId, result.text, result.html, now, now)
    .run();
}
