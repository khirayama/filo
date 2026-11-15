import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { runFetchFeed } from "../src/jobs/fetchFeed";
import { createFeed } from "./support/app";
import { createTestD1, type TestD1 } from "./support/d1";

function rss(channelLink: string, items: string): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>${channelLink}${items}</channel></rss>`;
}

describe("URLs stored by a feed fetch", () => {
  let t: TestD1;
  let feedId: number;

  async function fetchWith(xml: string) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml, { status: 200 })));
    await runFetchFeed({ DB: t.db } as unknown as Env, feedId, "refresh");
  }

  function siteUrl(): string | null {
    return t.rows<{ site_url: string | null }>("SELECT site_url FROM feeds WHERE id = ?", feedId)[0]!.site_url;
  }

  function articleUrls(): Array<string | null> {
    return t
      .rows<{ canonical_url: string | null }>("SELECT canonical_url FROM articles WHERE feed_id = ? ORDER BY guid", feedId)
      .map((row) => row.canonical_url);
  }

  beforeEach(() => {
    t = createTestD1();
    feedId = createFeed(t, "https://example.com/blog/feed.xml");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps the stored site URL when the feed has no usable link", async () => {
    t.exec("UPDATE feeds SET site_url = 'https://example.com/blog' WHERE id = ?", feedId);
    await fetchWith(rss("", ""));
    expect(siteUrl()).toBe("https://example.com/blog");

    await fetchWith(rss("<link>javascript:alert(1)</link>", ""));
    expect(siteUrl()).toBe("https://example.com/blog");
  });

  it("stores the site URL as published, resolved against the feed", async () => {
    await fetchWith(rss("<link>http://example.com/blog/?lang=ja</link>", ""));
    expect(siteUrl()).toBe("http://example.com/blog/?lang=ja");

    await fetchWith(rss("<link>/home/</link>", ""));
    expect(siteUrl()).toBe("https://example.com/home/");
  });

  it("resolves relative article links and drops non-web ones", async () => {
    await fetchWith(rss("<link>https://example.com</link>", `
      <item><title>A</title><link>posts/a</link><guid>a</guid></item>
      <item><title>B</title><link>javascript:alert(1)</link><guid>b</guid></item>`));
    expect(articleUrls()).toEqual(["https://example.com/blog/posts/a", null]);
  });
});
