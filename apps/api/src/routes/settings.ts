import { Hono } from "hono";
import type { AppContext } from "../lib/auth";
import { errors } from "../lib/errors";
import { isSupportedLanguage, parseReadableLanguages } from "../lib/languages";
import { intToBool, nowIso, toIso } from "../lib/util";

interface SettingsRow {
  theme: string;
  language: string;
  readable_languages: string | null;
  article_sort_order: string;
  open_in_browser_by_default: number;
  created_at: string;
  updated_at: string;
}

function serialize(row: SettingsRow) {
  return {
    theme: row.theme,
    language: row.language,
    readableLanguages: parseReadableLanguages(row.readable_languages),
    articleSortOrder: row.article_sort_order,
    openInBrowserByDefault: intToBool(row.open_in_browser_by_default),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function loadSettings(c: { env: { DB: D1Database } }, userId: number): Promise<SettingsRow> {
  const row = await c.env.DB.prepare("SELECT * FROM user_settings WHERE user_id = ?")
    .bind(userId)
    .first<SettingsRow>();
  if (!row) throw errors.internal("settings row missing");
  return row;
}

export const settingsRoutes = new Hono<AppContext>()
  .get("/", async (c) => {
    const row = await loadSettings(c, c.get("user").id);
    return c.json({ data: serialize(row) });
  })
  .patch("/", async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== "object") throw errors.validation();

    const updates: string[] = [];
    const values: unknown[] = [];
    if (body.theme !== undefined) {
      if (!["light", "dark", "system"].includes(body.theme as string)) throw errors.validation("invalid theme");
      updates.push("theme = ?");
      values.push(body.theme);
    }
    if (body.language !== undefined) {
      if (!isSupportedLanguage(body.language)) throw errors.validation("invalid language");
      updates.push("language = ?");
      values.push(body.language);
    }
    if (body.articleSortOrder !== undefined) {
      if (!["published_at_desc", "fetched_at_desc"].includes(body.articleSortOrder as string)) {
        throw errors.validation("invalid articleSortOrder");
      }
      updates.push("article_sort_order = ?");
      values.push(body.articleSortOrder);
    }
    if (body.readableLanguages !== undefined) {
      if (!Array.isArray(body.readableLanguages) || !body.readableLanguages.every(isSupportedLanguage)) {
        throw errors.validation("invalid readableLanguages");
      }
      updates.push("readable_languages = ?");
      values.push(JSON.stringify(body.readableLanguages));
    }
    if (body.openInBrowserByDefault !== undefined) {
      if (typeof body.openInBrowserByDefault !== "boolean") throw errors.validation("invalid openInBrowserByDefault");
      updates.push("open_in_browser_by_default = ?");
      values.push(body.openInBrowserByDefault ? 1 : 0);
    }
    if (updates.length === 0) throw errors.validation("at least one field is required");

    updates.push("updated_at = ?");
    values.push(nowIso(), c.get("user").id);
    await c.env.DB.prepare(`UPDATE user_settings SET ${updates.join(", ")} WHERE user_id = ?`)
      .bind(...values)
      .run();

    const row = await loadSettings(c, c.get("user").id);
    return c.json({ data: serialize(row) });
  });
