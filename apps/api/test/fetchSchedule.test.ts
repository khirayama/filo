import { describe, expect, it } from "vitest";
import {
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  refreshIntervalMinutes,
} from "../src/lib/fetchSchedule";

const NOW = Date.parse("2026-07-26T12:00:00Z");

// newest-first published_at values, `gapMinutes` apart, ending `agoMinutes` ago
function cadence(count: number, gapMinutes: number, agoMinutes = 0): string[] {
  return Array.from({ length: count }, (_, i) =>
    new Date(NOW - (agoMinutes + i * gapMinutes) * 60_000).toISOString()
  );
}

describe("refreshIntervalMinutes", () => {
  it("falls back when the cadence is unknown", () => {
    expect(refreshIntervalMinutes([], 60, NOW)).toBe(60);
    expect(refreshIntervalMinutes([null, null], 120, NOW)).toBe(120);
    // three samples give only two gaps — not enough to trust a median
    expect(refreshIntervalMinutes(cadence(3, 180), 60, NOW)).toBe(60);
  });

  it("follows the feed's publishing cadence", () => {
    expect(refreshIntervalMinutes(cadence(10, 180), 60, NOW)).toBe(180);
    expect(refreshIntervalMinutes(cadence(10, 60 * 8), 60, NOW)).toBe(60 * 8);
  });

  it("clamps to the polling bounds", () => {
    // a feed publishing every few minutes is still fetched at most hourly
    expect(refreshIntervalMinutes(cadence(10, 2), 60, NOW)).toBe(MIN_INTERVAL_MINUTES);
    // a weekly feed is still looked at daily
    expect(refreshIntervalMinutes(cadence(10, 60 * 24 * 7), 60, NOW)).toBe(MAX_INTERVAL_MINUTES);
  });

  it("ignores a single irregular gap", () => {
    const times = cadence(10, 180);
    times.splice(3, 0, new Date(NOW - 60 * 60_000 * 10.5).toISOString());
    expect(refreshIntervalMinutes(times, 60, NOW)).toBe(180);
  });

  it("backs off as a feed goes quiet", () => {
    // hourly cadence, but nothing published for eight hours
    expect(refreshIntervalMinutes(cadence(10, 60, 480), 60, NOW)).toBe(240);
    // three days of silence reaches the cap
    expect(refreshIntervalMinutes(cadence(10, 60, 60 * 24 * 3), 60, NOW)).toBe(MAX_INTERVAL_MINUTES);
  });

  it("backs off a bursty feed through the day", () => {
    // ten posts one minute apart each morning: at 12:00 the last was 8h ago
    expect(refreshIntervalMinutes(cadence(10, 1, 480), 60, NOW)).toBe(240);
  });

  it("ignores future timestamps and accepts D1 datetime text", () => {
    const future = new Date(NOW + 60 * 60_000 * 24).toISOString();
    expect(refreshIntervalMinutes([future, ...cadence(10, 180)], 60, NOW)).toBe(180);
    const d1Text = cadence(10, 180).map((iso) => iso.replace("T", " ").replace(".000Z", ""));
    expect(refreshIntervalMinutes(d1Text, 60, NOW)).toBe(180);
  });
});
