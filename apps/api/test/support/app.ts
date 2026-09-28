import { Hono } from "hono";
import type { Env, JobMessage } from "../../src/env";
import type { AppContext } from "../../src/lib/auth";
import { ApiError } from "../../src/lib/errors";
import { articleRoutes } from "../../src/routes/articles";
import { subscriptionRoutes } from "../../src/routes/subscriptions";
import type { TestD1 } from "./d1";

export interface TestUser {
  id: number;
}

export const noopJobs = {
  send: async () => {},
  sendBatch: async () => {},
} as unknown as Queue<JobMessage>;

export function createUser(t: TestD1, name: string): TestUser {
  const [row] = t.rows<{ id: number }>(
    "INSERT INTO users (auth_user_id, email) VALUES (?, ?) RETURNING id",
    `auth-${name}`,
    `${name}@example.com`,
  );
  t.exec("INSERT INTO user_settings (user_id) VALUES (?)", row!.id);
  t.exec("INSERT INTO user_unread_counts (user_id, reading_list_count) VALUES (?, 0)", row!.id);
  return { id: row!.id };
}

export function createFeed(t: TestD1, url: string): number {
  const [row] = t.rows<{ id: number }>(
    "INSERT INTO feeds (feed_url, title) VALUES (?, ?) RETURNING id",
    url,
    url,
  );
  return row!.id;
}

export interface ArticleInput {
  publishedAt?: string | null;
  fetchedAt?: string;
}

let articleSeq = 0;

// Inserts like the feed worker does, so the insert trigger runs.
export function addArticles(t: TestD1, feedId: number, inputs: ArticleInput[]): number[] {
  return inputs.map((input) => {
    articleSeq += 1;
    const [row] = t.rows<{ id: number }>(
      `INSERT INTO articles (feed_id, dedupe_key, title, published_at, fetched_at)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
      feedId,
      `key-${articleSeq}`,
      `Article ${articleSeq}`,
      input.publishedAt === undefined ? null : input.publishedAt,
      input.fetchedAt ?? "2026-09-01T00:00:00.000Z",
    );
    return row!.id;
  });
}

// Mounts the real routes behind a stub that authenticates as `user`.
export function createClient(t: TestD1, user: TestUser) {
  const app = new Hono<AppContext>();
  app.use("*", async (c, next) => {
    c.set("user", { id: user.id, authUserId: `auth-${user.id}`, isAdmin: false });
    await next();
  });
  app.route("/articles", articleRoutes);
  app.route("/subscriptions", subscriptionRoutes);
  app.onError((error, c) => {
    if (error instanceof ApiError) return c.json({ error: { code: error.code } }, error.status as 400);
    throw error;
  });

  const env = { DB: t.db, JOBS: noopJobs, CURSOR_SECRET: "test-cursor-secret" } as unknown as Env;

  return async <T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const response = await app.request(
      path,
      {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
    return { status: response.status, body: (await response.json()) as T };
  };
}
