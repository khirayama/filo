import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { countPendingTranslations } from "../lib/translate";
import { TICK_MS, watchdogDecision } from "./translationWatchdogPolicy";

// A single, always-on safety net for the translation drain. The drain normally
// keeps itself alive by re-enqueuing one continuation message, but that single
// thread breaks on an uncaught crash or a local queue restart, stranding the
// backlog with nothing to restart it. This Durable Object holds a persisted
// alarm that periodically checks for pending work and, if the drain has gone
// quiet, kicks a new one. Because the alarm is persisted, the backlog resumes
// on its own after a process restart.
export class TranslationWatchdog extends DurableObject<Env> {
  // Idempotent "start watching". Callers arm it whenever translation work is
  // kicked; it sets the recurring alarm only if one is not already pending, so
  // repeated calls are cheap.
  async arm(): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null) {
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    }
  }

  async alarm(): Promise<void> {
    const pending = await countPendingTranslations(this.env);
    const row = pending > 0
      ? await this.env.DB.prepare(
          "SELECT MAX(updated_at) AS last FROM article_listing_translations",
        ).first<{ last: string | null }>()
      : null;
    const { kick, reschedule } = watchdogDecision(
      { pending, lastUpdatedAt: row?.last ?? null },
      Date.now(),
    );
    if (kick) {
      console.log(`[watchdog] pending=${pending} but drain is quiet → kicking a drain`);
      await this.env.TRANSLATE_JOBS.send({ jobType: "translate_drain" });
    }
    if (reschedule) {
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    }
  }
}
