export interface Env {
  DB: D1Database;
  JOBS: Queue<JobMessage>;
  CLERK_SECRET_KEY: string;
  CURSOR_SECRET: string;
  ADMIN_CLERK_USER_IDS: string;
  CRON_SECRET: string;
}

export type JobMessage =
  | { jobType: "fetch_feed"; feedId: number; reason: "initial" | "refresh" | "retry_initial"; attempt: number }
  | { jobType: "extract_content"; articleId: number }
  | { jobType: "opml_import"; opmlJobId: number; attempt: number }
  | { jobType: "account_deletion"; deletionJobId: number; attempt: number };
