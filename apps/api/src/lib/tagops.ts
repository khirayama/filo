import { recordD1BatchMeta, recordD1Meta } from "./observability";
import { normalizeTagName, nowIso } from "./util";

// Reuse-or-create tags by name for a user; returns tag ids.
export async function resolveTagIdsByNames(db: D1Database, userId: number, names: string[]): Promise<number[]> {
  const unique = [...new Map(
    names
      .map((rawName) => {
        const name = rawName.trim();
        return name ? { name, normalized: normalizeTagName(name) } : null;
      })
      .filter((entry): entry is { name: string; normalized: string } => entry !== null)
      .map((entry) => [entry.normalized, entry] as const),
  ).values()];
  if (unique.length === 0) return [];

  const idsByName = new Map<string, number>();
  const loadExisting = async (entries: readonly { normalized: string }[]) => {
    for (let i = 0; i < entries.length; i += 80) {
      const chunk = entries.slice(i, i + 80);
      const placeholders = chunk.map(() => "?").join(",");
      const result = await db
        .prepare(`SELECT id, normalized_name FROM tags WHERE user_id = ? AND normalized_name IN (${placeholders})`)
        .bind(userId, ...chunk.map((entry) => entry.normalized))
        .all<{ id: number; normalized_name: string }>();
      recordD1Meta("tags.resolve_names", result.meta, { tag_count: chunk.length });
      for (const row of result.results) idsByName.set(row.normalized_name, row.id);
    }
  };

  await loadExisting(unique);
  const missing = unique.filter((entry) => !idsByName.has(entry.normalized));
  if (missing.length > 0) {
    const maxOrder = await db
      .prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM tags WHERE user_id = ?")
      .bind(userId)
      .first<{ m: number }>();
    const now = nowIso();
    const inserts = missing.map((entry, index) =>
      db.prepare(
        `INSERT INTO tags (user_id, name, normalized_name, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, normalized_name) DO NOTHING
         RETURNING id, normalized_name`,
      ).bind(userId, entry.name, entry.normalized, (maxOrder?.m ?? 0) + (index + 1) * 10, now, now),
    );
    for (let i = 0; i < inserts.length; i += 50) {
      const results = await db.batch(inserts.slice(i, i + 50));
      recordD1BatchMeta("tags.resolve_names_insert", results, { tag_count: results.length });
      for (const result of results) {
        const inserted = result.results?.[0] as { id?: number; normalized_name?: string } | undefined;
        if (inserted?.id !== undefined && inserted.normalized_name) {
          idsByName.set(inserted.normalized_name, inserted.id);
        }
      }
    }
    const unresolved = missing.filter((entry) => !idsByName.has(entry.normalized));
    if (unresolved.length > 0) await loadExisting(unresolved);
  }
  return unique.flatMap((entry) => {
    const id = idsByName.get(entry.normalized);
    return id === undefined ? [] : [id];
  });
}

// One statement for any number of tags. Links that already exist are left
// untouched, so re-attaching an unchanged tag writes nothing.
export function attachTagsStatement(
  db: D1Database,
  subscriptionId: number,
  tagIds: readonly number[],
  now: string,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO subscription_tags (subscription_id, tag_id, created_at)
     SELECT ?, value, ? FROM json_each(?) WHERE true
     ON CONFLICT DO NOTHING`,
  ).bind(subscriptionId, now, JSON.stringify([...new Set(tagIds)]));
}

export async function ownedTagIds(db: D1Database, userId: number, tagIds: readonly number[]): Promise<Set<number>> {
  const unique = [...new Set(tagIds)];
  const owned = new Set<number>();
  for (let i = 0; i < unique.length; i += 80) {
    const chunk = unique.slice(i, i + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await db
      .prepare(`SELECT id FROM tags WHERE user_id = ? AND id IN (${placeholders})`)
      .bind(userId, ...chunk)
      .all<{ id: number }>();
    recordD1Meta("subscriptions.validate_tags", result.meta, { tag_count: chunk.length });
    for (const row of result.results) owned.add(row.id);
  }
  return owned;
}

export async function tagIdsForSubscriptions(db: D1Database, subscriptionIds: number[]): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (subscriptionIds.length === 0) return map;
  for (let i = 0; i < subscriptionIds.length; i += 80) {
    const chunk = subscriptionIds.slice(i, i + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await db
      .prepare(
        `SELECT st.subscription_id, st.tag_id FROM subscription_tags st
         JOIN tags t ON t.id = st.tag_id
         WHERE st.subscription_id IN (${placeholders})
         ORDER BY t.sort_order ASC, t.id ASC`
      )
      .bind(...chunk)
      .all<{ subscription_id: number; tag_id: number }>();
    recordD1Meta("subscriptions.tag_ids", result.meta, { subscription_count: chunk.length });
    for (const row of result.results) {
      const list = map.get(row.subscription_id) ?? [];
      list.push(row.tag_id);
      map.set(row.subscription_id, list);
    }
  }
  return map;
}
