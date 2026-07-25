import { normalizeTagName, nowIso } from "./util";

// Reuse-or-create tags by name for a user; returns tag ids.
export async function resolveTagIdsByNames(db: D1Database, userId: number, names: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (const rawName of names) {
    const name = rawName.trim();
    if (!name) continue;
    const normalized = normalizeTagName(name);
    const existing = await db
      .prepare("SELECT id FROM tags WHERE user_id = ? AND normalized_name = ?")
      .bind(userId, normalized)
      .first<{ id: number }>();
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const maxOrder = await db
      .prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM tags WHERE user_id = ?")
      .bind(userId)
      .first<{ m: number }>();
    const now = nowIso();
    const inserted = await db
      .prepare(
        "INSERT INTO tags (user_id, name, normalized_name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id"
      )
      .bind(userId, name, normalized, (maxOrder?.m ?? 0) + 10, now, now)
      .first<{ id: number }>();
    if (inserted) ids.push(inserted.id);
  }
  return ids;
}

export async function attachTags(db: D1Database, subscriptionId: number, tagIds: number[]): Promise<void> {
  const now = nowIso();
  for (const tagId of new Set(tagIds)) {
    await db
      .prepare(
        "INSERT INTO subscription_tags (subscription_id, tag_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING"
      )
      .bind(subscriptionId, tagId, now)
      .run();
  }
}

export async function tagIdsForSubscriptions(db: D1Database, subscriptionIds: number[]): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (subscriptionIds.length === 0) return map;
  const placeholders = subscriptionIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT st.subscription_id, st.tag_id FROM subscription_tags st
       JOIN tags t ON t.id = st.tag_id
       WHERE st.subscription_id IN (${placeholders})
       ORDER BY t.sort_order ASC, t.id ASC`
    )
    .bind(...subscriptionIds)
    .all<{ subscription_id: number; tag_id: number }>();
  for (const row of results) {
    const list = map.get(row.subscription_id) ?? [];
    list.push(row.tag_id);
    map.set(row.subscription_id, list);
  }
  return map;
}
