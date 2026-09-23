import { Hono } from "hono";
import { requireArticleAccess } from "../lib/articleAccess";
import type { AppContext } from "../lib/auth";
import { enqueueArticleContent } from "../lib/articleContentJobs";
import { errors } from "../lib/errors";
import { nowIso, parseId } from "../lib/util";

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
    const rawBody = await c.req.text();
    let body: { force?: unknown } = {};
    if (rawBody.trim()) {
      try {
        const parsed: unknown = JSON.parse(rawBody);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid body");
        if (Object.keys(parsed).some((key) => key !== "force")) throw new Error("unknown field");
        body = parsed as { force?: unknown };
      } catch {
        throw errors.validation("Invalid JSON body");
      }
    }
    if (body.force !== undefined && typeof body.force !== "boolean") throw errors.validation("force must be a boolean");
    const force = body.force === true;
    const result = await enqueueArticleContent(c.env.DB, c.env.JOBS, articleId, force);
    return c.json({ data: { status: result.status } }, result.status === "ready" ? 200 : 202);
  })
  .get("/:articleId/content", async (c) => {
    const user = c.get("user");
    const articleId = parseId(c.req.param("articleId"));
    await requireArticleAccess(c.env.DB, user.id, articleId);
    await c.env.DB.prepare("UPDATE article_contents SET updated_at = ? WHERE article_id = ? AND status = 'ready'")
      .bind(nowIso(), articleId).run().catch(() => undefined);
    const content = await c.env.DB.prepare(
      `SELECT ac.text, ac.html, a.source_language, ac.status, ac.error_message
       FROM article_contents ac JOIN articles a ON a.id = ac.article_id
       WHERE ac.article_id = ?`,
    ).bind(articleId).first<ContentRow>();
    if (!content) return c.json({ data: { status: "not_requested" } });
    if (content.status !== "ready") {
      return c.json({ data: { status: content.status, errorMessage: content.error_message } });
    }
    return c.json({ data: {
      status: "ready",
      sourceLanguage: content.source_language,
      text: content.text,
      html: content.html,
    } });
  });
