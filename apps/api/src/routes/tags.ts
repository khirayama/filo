import { Hono } from "hono";
import type { AppContext } from "../lib/auth";
import { errors } from "../lib/errors";
import { serializeTag, type TagRow } from "../lib/serialize";
import { normalizeTagName, nowIso, parseId } from "../lib/util";

const TAG_SELECT = `
  SELECT t.*, (
    SELECT COUNT(*) FROM subscription_tags st WHERE st.tag_id = t.id
  ) AS subscription_count
  FROM tags t
`;

async function loadTag(db: D1Database, userId: number, tagId: number): Promise<TagRow> {
  const row = await db
    .prepare(`${TAG_SELECT} WHERE t.id = ? AND t.user_id = ?`)
    .bind(tagId, userId)
    .first<TagRow>();
  if (!row) throw errors.notFound("tag_not_found", "Tag not found");
  return row;
}

function validateColor(color: unknown): string | null {
  if (color === undefined || color === null) return null;
  if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw errors.validation("color must be #RRGGBB");
  }
  return color;
}

export const tagRoutes = new Hono<AppContext>()
  .get("/", async (c) => {
    const { results } = await c.env.DB.prepare(
      `${TAG_SELECT} WHERE t.user_id = ? ORDER BY t.sort_order ASC, t.id ASC`
    )
      .bind(c.get("user").id)
      .all<TagRow>();
    return c.json({ data: results.map(serializeTag) });
  })
  .post("/", async (c) => {
    const body = await c.req.json<{ name?: unknown; color?: unknown }>().catch(() => null);
    if (!body || typeof body.name !== "string" || !body.name.trim() || body.name.length > 100) {
      throw errors.validation("name is required");
    }
    const color = validateColor(body.color);
    const name = body.name.trim();
    const normalized = normalizeTagName(name);
    const user = c.get("user");

    const existing = await c.env.DB.prepare("SELECT id FROM tags WHERE user_id = ? AND normalized_name = ?")
      .bind(user.id, normalized)
      .first();
    if (existing) throw errors.conflict("tag_already_exists", "Tag already exists");

    const maxOrder = await c.env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM tags WHERE user_id = ?")
      .bind(user.id)
      .first<{ m: number }>();
    const now = nowIso();
    const inserted = await c.env.DB.prepare(
      "INSERT INTO tags (user_id, name, normalized_name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id"
    )
      .bind(user.id, name, normalized, color, (maxOrder?.m ?? 0) + 10, now, now)
      .first<{ id: number }>();
    if (!inserted) throw errors.internal();

    const row = await loadTag(c.env.DB, user.id, inserted.id);
    return c.json({ data: serializeTag(row) }, 201);
  })
  .put("/order", async (c) => {
    const body = await c.req.json<{ tagIds?: unknown }>().catch(() => null);
    if (!body || !Array.isArray(body.tagIds) || body.tagIds.some((id) => typeof id !== "number")) {
      throw errors.validation("tagIds is required");
    }
    const user = c.get("user");
    const tagIds = body.tagIds as number[];

    const { results } = await c.env.DB.prepare("SELECT id FROM tags WHERE user_id = ?")
      .bind(user.id)
      .all<{ id: number }>();
    const owned = new Set(results.map((r) => r.id));
    if (tagIds.length !== owned.size || tagIds.some((id) => !owned.has(id)) || new Set(tagIds).size !== tagIds.length) {
      throw errors.validation("tagIds must contain all of the user's tags exactly once");
    }

    const now = nowIso();
    const statements = tagIds.map((id, index) =>
      c.env.DB.prepare("UPDATE tags SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(
        (index + 1) * 10,
        now,
        id,
        user.id
      )
    );
    if (statements.length > 0) await c.env.DB.batch(statements);
    const { results: updated } = await c.env.DB.prepare(
      `${TAG_SELECT} WHERE t.user_id = ? ORDER BY t.sort_order ASC, t.id ASC`
    )
      .bind(user.id)
      .all<TagRow>();
    return c.json({ data: updated.map(serializeTag) });
  })
  .get("/:tagId", async (c) => {
    const row = await loadTag(c.env.DB, c.get("user").id, parseId(c.req.param("tagId")));
    return c.json({ data: serializeTag(row) });
  })
  .patch("/:tagId", async (c) => {
    const tagId = parseId(c.req.param("tagId"));
    const user = c.get("user");
    await loadTag(c.env.DB, user.id, tagId);

    const body = await c.req.json<{ name?: unknown; color?: unknown }>().catch(() => null);
    if (!body) throw errors.validation();

    const updates: string[] = [];
    const values: unknown[] = [];
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 100) {
        throw errors.validation("invalid name");
      }
      const normalized = normalizeTagName(body.name);
      const duplicate = await c.env.DB.prepare(
        "SELECT id FROM tags WHERE user_id = ? AND normalized_name = ? AND id != ?"
      )
        .bind(user.id, normalized, tagId)
        .first();
      if (duplicate) throw errors.conflict("tag_already_exists", "Tag already exists");
      updates.push("name = ?", "normalized_name = ?");
      values.push(body.name.trim(), normalized);
    }
    if (body.color !== undefined) {
      updates.push("color = ?");
      values.push(body.color === null ? null : validateColor(body.color));
    }
    if (updates.length === 0) throw errors.validation("at least one field is required");

    updates.push("updated_at = ?");
    values.push(nowIso(), tagId, user.id);
    await c.env.DB.prepare(`UPDATE tags SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`)
      .bind(...values)
      .run();

    const row = await loadTag(c.env.DB, user.id, tagId);
    return c.json({ data: serializeTag(row) });
  })
  .delete("/:tagId", async (c) => {
    const tagId = parseId(c.req.param("tagId"));
    const user = c.get("user");
    await loadTag(c.env.DB, user.id, tagId);
    await c.env.DB.prepare("DELETE FROM tags WHERE id = ? AND user_id = ?").bind(tagId, user.id).run();
    return c.json({ data: { deleted: true } });
  });
