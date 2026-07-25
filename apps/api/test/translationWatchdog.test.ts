import { describe, it, expect } from "vitest";
import { watchdogDecision } from "../src/jobs/translationWatchdogPolicy";

describe("watchdogDecision", () => {
  const NOW = Date.parse("2026-07-23T12:00:00.000Z");
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

  it("sleeps when there is no pending work", () => {
    expect(watchdogDecision({ pending: 0, lastUpdatedAt: iso(1_000_000) }, NOW)).toEqual({
      kick: false,
      reschedule: false,
    });
  });

  it("keeps watching without kicking while a drain is making progress", () => {
    // A row was touched 30s ago: the drain is alive, just pacing itself.
    expect(watchdogDecision({ pending: 500, lastUpdatedAt: iso(30_000) }, NOW)).toEqual({
      kick: false,
      reschedule: true,
    });
  });

  it("kicks a drain when work remains but nothing has moved past the stall window", () => {
    // No row touched for 5 minutes with work pending: the drain chain is dead.
    expect(watchdogDecision({ pending: 500, lastUpdatedAt: iso(300_000) }, NOW)).toEqual({
      kick: true,
      reschedule: true,
    });
  });

  it("kicks a drain when pending work has never been touched", () => {
    expect(watchdogDecision({ pending: 500, lastUpdatedAt: null }, NOW)).toEqual({
      kick: true,
      reschedule: true,
    });
  });

  it("treats the boundary as not-yet-stalled", () => {
    // Exactly at the 180s threshold is still considered healthy (strictly >).
    expect(watchdogDecision({ pending: 1, lastUpdatedAt: iso(180_000) }, NOW)).toEqual({
      kick: false,
      reschedule: true,
    });
  });
});
