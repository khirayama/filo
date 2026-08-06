import type { Env } from "../env";
import { extractFromHtml, extractFromRssContent } from "../lib/extract";
import { readTextCapped, safeFetch } from "../lib/net";
import { nowIso } from "../lib/util";

export async function runExtractContent(env: Env, articleId: number): Promise<void> {
  const article = await env.DB.prepare(
    `SELECT title, canonical_url, rss_content_html, rss_summary FROM articles WHERE id = ?`,
  ).bind(articleId).first<{
    title: string;
    canonical_url: string | null;
    rss_content_html: string | null;
    rss_summary: string | null;
  }>();
  if (!article) return;

  let result = extractFromRssContent(article.rss_content_html, article.rss_summary, article.title);
  if (!result && article.canonical_url) {
    try {
      const { response, finalUrl } = await safeFetch(article.canonical_url, {
        headers: { Accept: "text/html,application/xhtml+xml" },
        timeoutMs: 15_000,
      });
      const robots = response.headers.get("X-Robots-Tag")?.toLowerCase() ?? "";
      if (response.ok && !robots.includes("noarchive") && !robots.includes("noindex")) {
        result = extractFromHtml(await readTextCapped(response), finalUrl, article.title);
      }
    } catch {
      // The client-visible DOM is the primary path; server extraction is best-effort fallback.
    }
  }

  const now = nowIso();
  if (!result) {
    await env.DB.prepare(
      `INSERT INTO article_contents (article_id, status, error_message, created_at, updated_at)
       VALUES (?, 'error', 'extraction failed', ?, ?)
       ON CONFLICT (article_id) DO UPDATE SET status = 'error', text = NULL, html = NULL,
         error_message = 'extraction failed', updated_at = excluded.updated_at`,
    ).bind(articleId, now, now).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO article_contents (article_id, text, html, status, created_at, updated_at)
     VALUES (?, ?, ?, 'ready', ?, ?)
     ON CONFLICT (article_id) DO UPDATE SET text = excluded.text, html = excluded.html,
       status = 'ready', error_message = NULL, updated_at = excluded.updated_at`,
  ).bind(articleId, result.text, result.html, now, now).run();
}
