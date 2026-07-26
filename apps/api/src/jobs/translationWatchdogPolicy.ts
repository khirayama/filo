// Watchdog policy and client helper, kept free of any `cloudflare:workers`
// imports so it can be unit-tested and imported by request routes under plain
// vitest (the Durable Object shell itself lives in translationWatchdog.ts and
// is only imported by the worker entry module).
import type { Env } from "../env";

// How often the watchdog wakes to check on the drain.
export const TICK_MS = 60_000;
// Longest a healthy drain stays quiet between row updates: it commits per batch
// (tens of seconds) and re-enqueues its continuation with a small pacing delay.
// If pending work remains but nothing has been touched for longer than this,
// the single self-re-enqueuing drain message was lost (an uncaught crash, or a
// local `wrangler dev` restart clearing the in-memory queue) and the chain is
// dead. Kept comfortably above the drain's no-progress backoff (~60s) so a
// drain that is merely pacing itself is never mistaken for a dead one.
const STALL_MS = 180_000;

export interface WatchdogState {
  pending: number;
  lastUpdatedAt: string | null;
}

// kick: enqueue a fresh drain now. reschedule: keep the alarm ticking.
export function watchdogDecision(state: WatchdogState, now: number): { kick: boolean; reschedule: boolean } {
  if (state.pending <= 0) {
    // No work left; let the watchdog sleep until the next arm().
    return { kick: false, reschedule: false };
  }
  const lastMs = state.lastUpdatedAt ? Date.parse(state.lastUpdatedAt) : 0;
  const quietMs = now - (Number.isFinite(lastMs) ? lastMs : 0);
  return { kick: quietMs > STALL_MS, reschedule: true };
}

// Arm the single watchdog instance. Safe and cheap to call whenever a drain is
// kicked; the persisted alarm then keeps watching across process restarts.
// A namespace call only — no `cloudflare:workers` import — so routes can use it
// without pulling the Durable Object runtime into plain-vitest test loads.
export function armTranslationWatchdog(env: Env): Promise<void> {
  const id = env.TRANSLATION_WATCHDOG.idFromName("translation-watchdog");
  return env.TRANSLATION_WATCHDOG.get(id).arm();
}
