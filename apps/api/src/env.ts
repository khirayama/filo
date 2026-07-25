import type { TranslationWatchdog } from "./jobs/translationWatchdog";

export interface Env {
  DB: D1Database;
  JOBS: Queue<JobMessage>;
  TRANSLATE_JOBS: Queue<TranslateJobMessage>;
  // Safety-net Durable Object that restarts a stalled translation drain.
  TRANSLATION_WATCHDOG: DurableObjectNamespace<TranslationWatchdog>;
  CLERK_SECRET_KEY: string;
  CURSOR_SECRET: string;
  ADMIN_CLERK_USER_IDS: string;
  LM_STUDIO_API_KEY?: string;
  LM_STUDIO_API_URL?: string;
  TRANSLATION_MODEL?: string;
  // Provider token budget per minute; batch pacing is computed from it.
  TRANSLATION_TOKENS_PER_MINUTE?: string;
  // Minimum milliseconds between successive translation requests.
  TRANSLATION_PACING_MS?: string;
  CRON_SECRET: string;
}

export type JobMessage =
  | { jobType: "fetch_feed"; feedId: number; reason: "initial" | "refresh" | "retry_initial"; attempt: number }
  | { jobType: "extract_content"; articleId: number }
  | { jobType: "opml_import"; opmlJobId: number; attempt: number }
  | { jobType: "account_deletion"; deletionJobId: number; attempt: number };

// The translate queue carries a single message type: "drain pending rows".
// All translation state lives in article_listing_translations, so duplicate
// drain messages are harmless — a drain with no pending work exits after one
// query.
export type TranslateJobMessage = { jobType: "translate_drain" };
