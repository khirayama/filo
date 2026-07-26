import { toIso } from "./util";

// A single fixed cooldown fits no feed well: it holds back a news site that
// publishes every few minutes while pressing a monthly blog far too often.
// Derive the cooldown from the feed's own publishing cadence instead.

// Even the fastest feed is not worth fetching more than once an hour: articles
// are read in sessions, not watched live, and the poll costs a request per feed.
export const MIN_INTERVAL_MINUTES = 60;
// A dormant feed still gets looked at once a day, so a feed that wakes up after
// months of silence is picked up within a day rather than being effectively dropped.
export const MAX_INTERVAL_MINUTES = 60 * 24;
// Enough samples to smooth out a single irregular gap, few enough that a feed
// that recently changed rhythm is followed within a day or two.
export const CADENCE_SAMPLE_SIZE = 20;
const MIN_SAMPLES = 4;

/**
 * Cooldown until the next fetch, in minutes.
 *
 * `publishedAtDesc` holds the feed's most recent `published_at` values. When
 * too few carry a usable date the cadence is unknown and `fallbackMinutes` is
 * returned unchanged, so feeds without dates keep their fixed behaviour.
 */
export function refreshIntervalMinutes(
  publishedAtDesc: (string | null)[],
  fallbackMinutes: number,
  nowMs = Date.now()
): number {
  const times = publishedAtDesc
    .map((value) => Date.parse(toIso(value) ?? ""))
    .filter((ms) => Number.isFinite(ms) && ms <= nowMs)
    .sort((a, b) => b - a)
    .slice(0, CADENCE_SAMPLE_SIZE);
  const latest = times.at(0);
  if (times.length < MIN_SAMPLES || latest === undefined) return fallbackMinutes;

  const gaps: number[] = [];
  let previous = latest;
  for (const time of times.slice(1)) {
    gaps.push((previous - time) / 60_000);
    previous = time;
  }
  gaps.sort((a, b) => a - b);

  // A feed that has gone quiet must not keep being polled at its old rate.
  // Once it has been silent for longer than its cadence, back off in step with
  // the silence — this is also what keeps a bursty feed (ten posts every
  // morning, median gap ~1m) from being polled every 15 minutes all day.
  const silentMinutes = (nowMs - latest) / 60_000;
  const interval = Math.max(median(gaps), silentMinutes / 2);

  return Math.round(Math.min(Math.max(interval, MIN_INTERVAL_MINUTES), MAX_INTERVAL_MINUTES));
}

function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted.at(middle) ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted.at(middle - 1) ?? upper) + upper) / 2;
}
