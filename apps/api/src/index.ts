import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, JobMessage } from "./env";
import { runAccountDeletion } from "./jobs/accountDeletion";
import { runFetchFeed } from "./jobs/fetchFeed";
import { runOpmlImport } from "./jobs/opmlImport";
import { requireAdmin, requireUser, requireUserOrSystem, type AppContext, type OpsContext } from "./lib/auth";
import { ApiError } from "./lib/errors";
import { nowIso } from "./lib/util";
import { accountRoutes } from "./routes/account";
import { adminRoutes } from "./routes/admin";
import { articleRoutes } from "./routes/articles";
import { opmlRoutes } from "./routes/opml";
import { settingsRoutes } from "./routes/settings";
import { statusRoutes } from "./routes/status";
import { subscriptionRoutes } from "./routes/subscriptions";
import { tagRoutes } from "./routes/tags";

const app = new Hono<{ Bindings: Env; Variables: { requestId: string } }>();

const DEV_ALLOWED_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
const ALLOWED_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const ALLOWED_HEADERS = ["Authorization", "Content-Type", "X-Request-Id"];

function resolveCorsOrigin(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  if (DEV_ALLOWED_ORIGINS.has(origin)) return origin;
  return undefined;
}

app.use(
  "*",
  cors({
    origin: resolveCorsOrigin,
    allowHeaders: ALLOWED_HEADERS,
    allowMethods: ALLOWED_METHODS,
    exposeHeaders: ["X-Request-Id"],
  }),
);

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

app.get("/api/v1/health", (c) => c.json({ data: { status: "ok", time: nowIso() } }));

// account deletion-status accepts a deletionToken without a Clerk session
app.route("/api/v1/account", accountRoutes);

// Core routes — require user auth
const authed = new Hono<AppContext>();
authed.use("*", requireUser);
authed.route("/settings", settingsRoutes);
authed.route("/subscriptions", subscriptionRoutes);
authed.route("/tags", tagRoutes);
authed.route("/articles", articleRoutes);
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

  // Feed refresh is user-triggered only; cron handles recovery jobs, never content fetching.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        // retry recoverable account deletion jobs (max 5 attempts)
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
