import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, JobMessage } from "./env";
import { runAccountDeletion } from "./jobs/accountDeletion";
import { runFetchFeed } from "./jobs/fetchFeed";
import { runExtractContent } from "./jobs/extractContent";
import { runOpmlImport } from "./jobs/opmlImport";
import { requireAdmin, requireUser, requireUserOrSystem, type AppContext, type OpsContext } from "./lib/auth";
import { ApiError, errors } from "./lib/errors";
import { nowIso } from "./lib/util";
import { createBetterAuth } from "./betterAuth";
import { accountRoutes } from "./routes/account";
import { adminRoutes } from "./routes/admin";
import { articleRoutes } from "./routes/articles";
import { contentRoutes } from "./routes/content";
import { opmlRoutes } from "./routes/opml";
import { settingsRoutes } from "./routes/settings";
import { statusRoutes } from "./routes/status";
import { subscriptionRoutes } from "./routes/subscriptions";
import { tagRoutes } from "./routes/tags";

const app = new Hono<{ Bindings: Env; Variables: { requestId: string } }>();

const DEV_ALLOWED_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
const ALLOWED_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const ALLOWED_HEADERS = ["Authorization", "Content-Type", "X-Request-Id"];

function resolveCorsOrigin(origin: string | undefined, allowedOrigins: string): string | undefined {
  if (!origin) return undefined;
  const configuredOrigins = new Set(
    allowedOrigins
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (DEV_ALLOWED_ORIGINS.has(origin) || configuredOrigins.has(origin)) return origin;
  return undefined;
}

app.use(
  "*",
  cors({
    origin: (origin, c) => resolveCorsOrigin(origin, c.env.CORS_ALLOWED_ORIGINS ?? ""),
    allowHeaders: ALLOWED_HEADERS,
    allowMethods: ALLOWED_METHODS,
    credentials: true,
    exposeHeaders: ["X-Request-Id", "set-auth-token"],
  }),
);

// Production web sessions use SameSite=None so the supported Pages origin
// can call the API. CORS alone does not stop a browser from sending a
// credentialed cross-site mutation, so cookie-authenticated writes must also
// come from an explicitly trusted origin. Bearer clients do not rely on this
// browser CSRF boundary.
app.use("/api/v1/*", async (c, next) => {
  const safeMethod = c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS";
  const usesCookieSession = Boolean(c.req.header("Cookie")) && !c.req.header("Authorization");
  if (usesCookieSession && !safeMethod) {
    const origin = resolveCorsOrigin(c.req.header("Origin"), c.env.CORS_ALLOWED_ORIGINS ?? "");
    if (!origin) throw errors.forbidden();
  }
  await next();
});

app.use("*", async (c, next) => {
  const requestId = c.req.header("X-Request-Id") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  await next();
  c.res.headers.set("X-Request-Id", requestId);
  if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
});

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json({ error: { code: error.code, message: error.message } }, error.status as 400);
  }
  console.error("unhandled error:", error);
  return c.json({ error: { code: "internal_error", message: "Unexpected server error" } }, 500);
});

app.notFound((c) => c.json({ error: { code: "resource_not_found", message: "Resource not found" } }, 404));

app.get("/api/v1/health", (c) => c.json({ data: { status: "ok", environment: c.env.APP_ENV, time: nowIso() } }));

app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const auth = createBetterAuth(c.env);
  return auth.handler(c.req.raw);
});

// account deletion-status accepts a deletionToken without an active session
app.route("/api/v1/account", accountRoutes);

// Core routes — require user auth
const authed = new Hono<AppContext>();
authed.use("*", requireUser);
authed.route("/settings", settingsRoutes);
authed.route("/subscriptions", subscriptionRoutes);
authed.route("/tags", tagRoutes);
authed.route("/articles", articleRoutes);
authed.route("/articles", contentRoutes);
authed.route("/opml", opmlRoutes);

const admin = new Hono<AppContext>();
admin.use("*", requireUser, requireAdmin);
admin.route("/", adminRoutes);
authed.route("/admin", admin);

app.route("/api/v1", authed);

// Ops routes — accept user auth or system (cron) auth
const ops = new Hono<OpsContext>();
ops.use("*", requireUserOrSystem);
ops.route("/status", statusRoutes);
app.route("/api/v1", ops);

async function handleJob(env: Env, message: JobMessage): Promise<void> {
  switch (message.jobType) {
    case "extract_content":
      await runExtractContent(env, message.articleId);
      return;
    case "fetch_feed":
      await runFetchFeed(env, message.feedId, message.reason);
      return;
    case "opml_import":
      await runOpmlImport(env, message.opmlJobId);
      return;
    case "account_deletion":
      await runAccountDeletion(env, message.deletionJobId);
      return;
  }
}

export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await handleJob(env, message.body);
        message.ack();
      } catch (error) {
        console.error(`job ${message.body.jobType} failed:`, error);
        message.retry({ delaySeconds: 60 });
      }
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        // Refresh active feeds whose per-feed cooldown has elapsed. The
        // cooldown is calculated by runFetchFeed from each feed's cadence.
        const now = nowIso();
        const { results: dueFeeds } = await env.DB.prepare(
          `SELECT f.id
           FROM feeds f
           LEFT JOIN feed_fetch_states fs ON fs.feed_id = f.id
           WHERE f.status = 'active'
             AND (fs.next_fetch_after IS NULL OR fs.next_fetch_after <= ?)
           ORDER BY fs.next_fetch_after IS NOT NULL, fs.next_fetch_after
           LIMIT 200`,
        )
          .bind(now)
          .all<{ id: number }>();

        for (const feed of dueFeeds) {
          await env.JOBS.send({ jobType: "fetch_feed", feedId: feed.id, reason: "refresh", attempt: 1 });
        }

        // Retry recoverable account deletion jobs (max 5 attempts).
        const { results: failedDeletions } = await env.DB.prepare(
          "SELECT id FROM account_deletion_jobs WHERE status = 'failed' AND attempt_count < 5 LIMIT 10",
        ).all<{ id: number }>();
        for (const job of failedDeletions) {
          await env.JOBS.send({ jobType: "account_deletion", deletionJobId: job.id, attempt: 1 });
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env, JobMessage>;
