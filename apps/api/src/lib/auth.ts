import type { MiddlewareHandler } from "hono";
import type { Env } from "../env";
import { createBetterAuth } from "../betterAuth";
import { errors } from "./errors";
import { nowIso } from "./util";

export interface AuthedUser { id: number; authUserId: string; isAdmin: boolean; }
export type AppContext = { Bindings: Env; Variables: { user: AuthedUser; requestId: string } };
type AuthIdentity = { id: string; email: string };

function requestHeaders(authHeader?: string | Headers): Headers {
  return authHeader instanceof Headers ? authHeader : new Headers(authHeader ? { Authorization: authHeader } : undefined);
}

async function getAuthIdentity(env: Env, authHeader?: string | Headers): Promise<AuthIdentity> {
  const session = await createBetterAuth(env).api.getSession({ headers: requestHeaders(authHeader) });
  if (!session) throw errors.unauthorized();
  return { id: session.user.id, email: session.user.email };
}

export async function verifyAuthUserId(env: Env, authHeader?: string | Headers): Promise<string> {
  return (await getAuthIdentity(env, authHeader)).id;
}

async function resolveUser(env: Env, authHeader?: string | Headers): Promise<AuthedUser> {
  const identity = await getAuthIdentity(env, authHeader);
  const id = identity.id;

  // A tombstone is authoritative even while the Better Auth session remains
  // valid (the deletion queue may still be retrying). It is looked up in the
  // same round trip as the application row.
  const lookup = await env.DB.prepare(
    `SELECT EXISTS (SELECT 1 FROM deleted_user_tombstones WHERE auth_user_id = ?) AS tombstoned,
            u.id, u.email
     FROM (SELECT 1) LEFT JOIN users u ON u.auth_user_id = ?`,
  ).bind(id, id).first<{ tombstoned: number; id: number | null; email: string | null }>();
  if (lookup?.tombstoned === 1) throw errors.forbidden();

  let row: { id: number; email: string | null } | null =
    lookup?.id != null ? { id: lookup.id, email: lookup.email } : null;
  let needsProvisioning = false;

  if (!row) {
    const now = nowIso();
    await env.DB.prepare(
      "INSERT INTO users (auth_user_id, email, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (auth_user_id) DO NOTHING",
    ).bind(id, identity.email, now, now).run();
    // The insert is deliberately idempotent: concurrent requests race on the
    // unique auth_user_id constraint, then both observe the same application
    // row here.
    row = await env.DB.prepare("SELECT id, email FROM users WHERE auth_user_id = ? LIMIT 1")
      .bind(id).first<{ id: number; email: string | null }>();
    needsProvisioning = true;
  }
  if (!row) throw errors.internal();

  // Better Auth owns the canonical email. Keep the application projection in
  // sync when an authenticated identity changes its email outside this API.
  if (row.email !== identity.email) {
    await env.DB.prepare("UPDATE users SET email = ?, updated_at = ? WHERE id = ?")
      .bind(identity.email, nowIso(), row.id)
      .run();
    row = { ...row, email: identity.email };
  }

  // These rows are created once with the user projection. Running the
  // idempotent inserts on every authenticated request still makes D1 inspect
  // the conflict indexes on every request, so only the new-user path needs
  // the repair/provisioning work. Existing users are covered by migrations.
  if (needsProvisioning) {
    const settingsNow = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO user_settings (user_id, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO NOTHING",
      ).bind(row.id, settingsNow, settingsNow),
      env.DB.prepare(
        "INSERT INTO user_unread_counts (user_id, reading_list_count, updated_at) VALUES (?, 0, ?) ON CONFLICT (user_id) DO NOTHING",
      ).bind(row.id, settingsNow),
    ]);
  }

  const admins = (env.ADMIN_BETTER_AUTH_USER_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return { id: row.id, authUserId: id, isAdmin: admins.includes(id) };
}
export const requireUser: MiddlewareHandler<AppContext> = async (c, next) => { c.set("user", await resolveUser(c.env, c.req.raw.headers)); await next(); };
export const requireAdmin: MiddlewareHandler<AppContext> = async (c, next) => { if (!c.get("user").isAdmin) throw errors.adminRequired(); await next(); };
