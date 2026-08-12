import { verifyToken } from "@clerk/backend";
import type { MiddlewareHandler } from "hono";
import type { Env } from "../env";
import { errors } from "./errors";
import { nowIso } from "./util";

export interface AuthedUser {
  id: number;
  clerkUserId: string;
  isAdmin: boolean;
}

export type AppContext = {
  Bindings: Env;
  Variables: { user: AuthedUser; requestId: string };
};

export type OpsContext = {
  Bindings: Env;
  Variables: { user: AuthedUser | null; requestId: string };
};

// Verify a Clerk Bearer token and return its clerk_user_id.
export async function verifyClerkUserId(env: Env, authHeader: string | undefined): Promise<string> {
  if (!authHeader?.startsWith("Bearer ")) throw errors.unauthorized();
  const token = authHeader.slice("Bearer ".length);
  let primaryVerificationError: unknown;
  try {
    const jwtKey = (env.CLERK_JWT_PUBLIC_KEY ?? env.CLERK_JWT_KEY)?.replace(/\\n/g, "\n");
    const verify = async (options: Parameters<typeof verifyToken>[1]) => {
      const result = await verifyToken(token, options);
      if ("errors" in result) {
        const resultErrors = (result as { errors?: unknown[] }).errors;
        if (resultErrors?.length) throw resultErrors[0];
      }
      return result;
    };

    let payload: Awaited<ReturnType<typeof verifyToken>>;
    try {
      payload = await verify({ secretKey: env.CLERK_SECRET_KEY, ...(jwtKey ? { jwtKey } : {}) });
    } catch (error) {
      primaryVerificationError = error;
      if (!jwtKey) throw error;
      payload = await verify({ secretKey: env.CLERK_SECRET_KEY });
    }
    if (!payload.sub) throw errors.unauthorized();
    return payload.sub;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "message" in error
          ? String((error as { message?: unknown }).message)
          : String(error);
    const reason =
      typeof error === "object" && error !== null && "reason" in error
        ? String((error as { reason?: unknown }).reason)
        : "unknown";
    const primary = primaryVerificationError instanceof Error ? primaryVerificationError.message : "none";
    console.error(`clerk token verification failed message=${message} reason=${reason} primary=${primary}`);
    throw errors.unauthorized();
  }
}

async function resolveUser(env: Env, authHeader: string | undefined): Promise<AuthedUser> {
  const clerkUserId = await verifyClerkUserId(env, authHeader);

  const tombstone = await env.DB.prepare(
    "SELECT clerk_user_id FROM deleted_user_tombstones WHERE clerk_user_id = ?",
  )
    .bind(clerkUserId)
    .first();
  if (tombstone) throw errors.forbidden();

  let row = await env.DB.prepare("SELECT id FROM users WHERE clerk_user_id = ?")
    .bind(clerkUserId)
    .first<{ id: number }>();
  if (!row) {
    const now = nowIso();
    await env.DB.prepare(
      "INSERT INTO users (clerk_user_id, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT (clerk_user_id) DO NOTHING",
    )
      .bind(clerkUserId, now, now)
      .run();
    row = await env.DB.prepare("SELECT id FROM users WHERE clerk_user_id = ?")
      .bind(clerkUserId)
      .first<{ id: number }>();
    if (!row) throw errors.internal();
    await env.DB.prepare(
      "INSERT INTO user_settings (user_id, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO NOTHING",
    )
      .bind(row.id, now, now)
      .run();
  }

  const adminIds = (env.ADMIN_CLERK_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return { id: row.id, clerkUserId, isAdmin: adminIds.includes(clerkUserId) };
}

export const requireUser: MiddlewareHandler<AppContext> = async (c, next) => {
  c.set("user", await resolveUser(c.env, c.req.header("Authorization")));
  await next();
};

export const requireUserOrSystem: MiddlewareHandler<OpsContext> = async (c, next) => {
  const header = c.req.header("Authorization");
  if (header === `Bearer ${c.env.CRON_SECRET}`) {
    c.set("user", null);
    await next();
    return;
  }
  c.set("user", await resolveUser(c.env, header));
  await next();
};

export const requireAdmin: MiddlewareHandler<AppContext> = async (c, next) => {
  if (!c.get("user").isAdmin) throw errors.adminRequired();
  await next();
};
