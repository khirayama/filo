#!/usr/bin/env npx tsx
// Re-fetches favicon URLs for all feeds by parsing each site's HTML for <link rel="icon">.
// Usage: npx tsx scripts/refetch-favicons.ts
//   --dry-run   Show what would change without writing to DB
//   --remote    Run against remote D1 (default: local)

import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const remote = args.includes("--remote");
const dbFlag = remote ? "--remote" : "--local";

function d1(sql: string): string {
  return execSync(
    `npx wrangler d1 execute filo-db ${dbFlag} --command ${JSON.stringify(sql)} --json`,
    { cwd: import.meta.dirname + "/..", encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
  );
}

interface FeedRow {
  id: number;
  feed_url: string;
  site_url: string | null;
  favicon_url: string | null;
}

function discoverFaviconInHtml(html: string, baseUrl: string): string | null {
  const head = html.slice(0, 200_000);
  const linkTags = head.match(/<link\b[^>]*>/gi) ?? [];
  let best: { url: string; size: number } | null = null;
  for (const tag of linkTags) {
    if (!/rel\s*=\s*["']?[^"'>]*(icon|shortcut icon)/i.test(tag)) continue;
    if (/rel\s*=\s*["']?apple-touch-icon/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const value = href?.[2] ?? href?.[3] ?? href?.[4];
    if (!value) continue;
    try {
      const url = new URL(value, baseUrl).toString();
      const sizeMatch = tag.match(/sizes\s*=\s*["']?(\d+)/i);
      const size = sizeMatch ? Number(sizeMatch[1]) : 0;
      if (!best || (size > 0 && size <= 64 && (best.size === 0 || size > best.size))) {
        best = { url, size };
      }
    } catch {
      // skip
    }
  }
  return best?.url ?? null;
}

async function discoverFavicon(siteUrl: string | null, feedUrl: string): Promise<string | null> {
  const base = siteUrl ?? feedUrl;
  try {
    const res = await fetch(base, {
      headers: { Accept: "text/html", "User-Agent": "FiloBot/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const html = await res.text();
      const found = discoverFaviconInHtml(html, base);
      if (found) return found;
    }
  } catch {
    // fall through
  }
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}/favicon.ico`;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`Fetching feed list (${remote ? "remote" : "local"})...`);
  const raw = d1("SELECT id, feed_url, site_url, favicon_url FROM feeds ORDER BY id");
  const parsed = JSON.parse(raw);
  const feeds: FeedRow[] = parsed[0]?.results ?? [];
  console.log(`Found ${feeds.length} feeds`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const feed of feeds) {
    const label = `[${feed.id}] ${feed.site_url ?? feed.feed_url}`;
    try {
      const newUrl = await discoverFavicon(feed.site_url, feed.feed_url);
      if (!newUrl || newUrl === feed.favicon_url) {
        skipped++;
        continue;
      }
      console.log(`${label}: ${feed.favicon_url ?? "(null)"} → ${newUrl}`);
      if (!dryRun) {
        d1(`UPDATE feeds SET favicon_url = '${newUrl.replace(/'/g, "''")}' WHERE id = ${feed.id}`);
      }
      updated++;
    } catch (e) {
      console.error(`${label}: FAILED - ${e}`);
      failed++;
    }
  }

  console.log(`\nDone${dryRun ? " (dry run)" : ""}: ${updated} updated, ${skipped} unchanged, ${failed} failed`);
}

main();
