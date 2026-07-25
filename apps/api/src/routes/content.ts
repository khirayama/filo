import { Hono } from "hono";
import { requireArticleAccess } from "../lib/articleAccess";
import type { AppContext } from "../lib/auth";
import { parseId } from "../lib/util";

interface ContentRow {
  text: string | null;
  html: string | null;
  source_language: string | null;
  status: string;
  error_message: string | null;
}

export const contentRoutes = new Hono<AppContext>()
  .post("/:articleId/content", async (c) => {
    const user = c.get("user");
    const articleId = parseId(c.req.param("articleId"));
    await requireArticleAccess(c.env.DB, user.id, articleId);

    const body = await c.req.json<{ force?: unknown }>().catch(() => ({}) as { force?: unknown });
    const force = body.force === true;

    const existing = await c.env.DB.prepare(
      "SELECT status FROM article_contents WHERE article_id = ?",
    )
      .bind(articleId)
      .first<{ status: string }>();

    if (existing && existing.status === "pending" && !force) {
      return c.json({ data: { status: "pending" } }, 202);
    }

    if (existing && existing.status === "ready" && !force) {
      return c.json({ data: { status: "ready" } });
    }

    // Mark pending before enqueueing so repeated requests short-circuit above
    // instead of enqueueing duplicate jobs.
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO article_contents (article_id, status, created_at, updated_at)
       VALUES (?, 'pending', ?, ?)
       ON CONFLICT (article_id) DO UPDATE SET
         status = 'pending', error_message = NULL, updated_at = excluded.updated_at`,
    )
      .bind(articleId, now, now)
      .run();

    await c.env.JOBS.send({ jobType: "extract_content", articleId });
    return c.json({ data: { status: "pending" } }, 202);
  })
  .get("/:articleId/content", async (c) => {
    const user = c.get("user");
    const articleId = parseId(c.req.param("articleId"));
    await requireArticleAccess(c.env.DB, user.id, articleId);

    const content = await c.env.DB.prepare(
      "SELECT text, html, source_language, status, error_message FROM article_contents WHERE article_id = ?",
    )
      .bind(articleId)
      .first<ContentRow>();

    if (!content) {
      return c.json({ data: { status: "not_requested" } });
    }

    if (content.status !== "ready") {
      return c.json({
        data: {
          status: content.status,
          errorMessage: content.error_message,
        },
      });
    }

    return c.json({
      data: {
        status: "ready",
        sourceLanguage: content.source_language,
        text: content.text,
        html: content.html,
      },
    });
  });
