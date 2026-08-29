import type { MiddlewareHandler } from "hono";
import type { Env } from "../env";
import { createBetterAuth } from "../betterAuth";
import { errors } from "./errors";
import { nowIso } from "./util";

export interface AuthedUser { id: number; authUserId: string; isAdmin: boolean; }
export type AppContext = { Bindings: Env; Variables: { user: AuthedUser; requestId: string } };
export type OpsContext = { Bindings: Env; Variables: { user: AuthedUser | null; requestId: string } };
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
  // valid (the deletion queue may still be retrying).
  const tombstone = await env.DB.prepare(
    "SELECT 1 AS found FROM deleted_user_tombstones WHERE auth_user_id = ? LIMIT 1",
  ).bind(id).first<{ found: number }>();
  if (tombstone) throw errors.forbidden();

  let row = await env.DB.prepare("SELECT id, email FROM users WHERE auth_user_id = ? LIMIT 1")
    .bind(id).first<{ id: number; email: string | null }>();

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
  }
  if (!row) throw errors.internal();

  // Settings are part of first-request provisioning too. Always use an
  // idempotent insert so an existing row missing settings is repaired and
  // concurrent requests cannot create duplicates.
  const settingsNow = nowIso();
  await env.DB.prepare(
    "INSERT INTO user_settings (user_id, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO NOTHING",
  ).bind(row.id, settingsNow, settingsNow).run();

  const admins = (env.ADMIN_BETTER_AUTH_USER_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return { id: row.id, authUserId: id, isAdmin: admins.includes(id) };
}
export const requireUser: MiddlewareHandler<AppContext> = async (c, next) => { c.set("user", await resolveUser(c.env, c.req.raw.headers)); await next(); };
export const requireUserOrSystem: MiddlewareHandler<OpsContext> = async (c, next) => { if (c.req.header("Authorization") === `Bearer ${c.env.CRON_SECRET}`) { c.set("user", null); await next(); return; } c.set("user", await resolveUser(c.env, c.req.raw.headers)); await next(); };
export const requireAdmin: MiddlewareHandler<AppContext> = async (c, next) => { if (!c.get("user").isAdmin) throw errors.adminRequired(); await next(); };
