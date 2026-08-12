export interface Env {
  DB: D1Database;
  JOBS: Queue<JobMessage>;
  APP_ENV: "development" | "production";
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
  CLERK_JWT_PUBLIC_KEY?: string;
  CURSOR_SECRET: string;
  CURSOR_SIGNING_KEY?: string;
  ADMIN_CLERK_USER_IDS: string;
  CRON_SECRET: string;
  CORS_ALLOWED_ORIGINS: string;
}

export type JobMessage =
  | { jobType: "fetch_feed"; feedId: number; reason: "initial" | "refresh" | "retry_initial"; attempt: number }
  | { jobType: "extract_content"; articleId: number }
  | { jobType: "opml_import"; opmlJobId: number; attempt: number }
  | { jobType: "account_deletion"; deletionJobId: number; attempt: number };
