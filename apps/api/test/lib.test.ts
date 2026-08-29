import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeCursor, encodeCursor } from "../src/lib/cursor";
import { discoverFeed } from "../src/lib/discovery";
import { dedupeKeyFor, discoverFeedUrlsInHtml, parseFeed } from "../src/lib/feed";
import { canonicalizeFeedUrl, canonicalizeUrl, safeFetch } from "../src/lib/net";
import { buildOpml, parseOpml } from "../src/lib/opml";
import { htmlToText, normalizeTagName, previewFrom } from "../src/lib/util";

describe("cursor", () => {
  it("round-trips and detects tampering", async () => {
    const cursor = await encodeCursor("secret", "published_at_desc", { ts: "2026-05-10T22:00:00Z", id: 42, r: 0 });
    const decoded = await decodeCursor("secret", "published_at_desc", cursor);
    expect(decoded).toEqual({ ts: "2026-05-10T22:00:00Z", id: 42, r: 0 });
    await expect(decodeCursor("secret", "fetched_at_desc", cursor)).rejects.toMatchObject({ code: "invalid_cursor" });
    await expect(decodeCursor("other", "published_at_desc", cursor)).rejects.toMatchObject({ code: "invalid_cursor" });
    await expect(decodeCursor("secret", "published_at_desc", `${cursor}x`)).rejects.toMatchObject({ code: "invalid_cursor" });
  });

  it("supports the null published_at tail", async () => {
    const cursor = await encodeCursor("secret", "published_at_desc", { ts: null, id: 7, r: 1 });
    expect(await decodeCursor("secret", "published_at_desc", cursor)).toEqual({ ts: null, id: 7, r: 1 });
  });

  it("binds pagination cursors to the selected read order", async () => {
    const cursor = await encodeCursor("secret", "published_at_desc", { ts: "2026-05-10T22:00:00Z", id: 42, r: 1 }, "read_first");
    await expect(decodeCursor("secret", "published_at_desc", cursor, "read_first")).resolves.toEqual({
      ts: "2026-05-10T22:00:00Z",
      id: 42,
      r: 1,
    });
    await expect(decodeCursor("secret", "published_at_desc", cursor, "unread_first")).rejects.toMatchObject({ code: "invalid_cursor" });
  });

  it("supports a cursor without read-state ordering", async () => {
    const cursor = await encodeCursor("secret", "published_at_desc", { ts: "2026-05-10T22:00:00Z", id: 42, r: 0 }, "none");
    await expect(decodeCursor("secret", "published_at_desc", cursor, "none")).resolves.toEqual({
      ts: "2026-05-10T22:00:00Z",
      id: 42,
      r: 0,
    });
  });
});

describe("feed parsing", () => {
  it("parses RSS 2.0", () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
        <title>Example</title><link>https://example.com</link><description>desc</description>
        <atom:link rel="self" type="application/rss+xml" href="https://example.com/feed/" />
        <item><title>Post 1</title><link>https://example.com/1</link><guid>g1</guid>
          <pubDate>Mon, 11 May 2026 10:00:00 GMT</pubDate><description>summary</description></item>
      </channel></rss>`);
    expect(feed?.title).toBe("Example");
    expect(feed?.items).toHaveLength(1);
    expect(feed?.items[0]?.guid).toBe("g1");
    expect(feed?.items[0]?.publishedAt).toBe("2026-05-11T10:00:00.000Z");
    expect(feed?.selfUrl).toBe("https://example.com/feed/");
  });

  it("parses Atom", () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Atom Feed</title>
        <link rel="alternate" href="https://example.com"/>
        <entry><id>tag:1</id><title>Entry</title>
          <link rel="alternate" href="https://example.com/e1"/>
          <updated>2026-05-11T10:00:00Z</updated>
          <content type="html">&lt;p&gt;hello&lt;/p&gt;</content></entry>
      </feed>`);
    expect(feed?.title).toBe("Atom Feed");
    expect(feed?.items[0]?.url).toBe("https://example.com/e1");
    expect(feed?.items[0]?.guid).toBe("tag:1");
  });

  it("builds dedupe keys with guid > url > hash priority", async () => {
    const base = { title: "T", author: null, summary: null, contentHtml: null, publishedAt: null };
    expect(await dedupeKeyFor({ ...base, guid: "g", url: "u" })).toBe("guid:g");
    expect(await dedupeKeyFor({ ...base, guid: null, url: "https://x/1" })).toBe("url:https://x/1");
    const hashed = await dedupeKeyFor({ ...base, guid: null, url: null });
    expect(hashed).toMatch(/^hash:[0-9a-f]{64}$/);
  });

  it("discovers feed links in HTML", () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" href="/feed.xml">
      <link rel="stylesheet" href="/style.css">
    </head></html>`;
    expect(discoverFeedUrlsInHtml(html, "https://example.com/page")).toEqual(["https://example.com/feed.xml"]);
  });
});

describe("feed discovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses a same-origin RSS self URL without stripping its trailing slash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          `<?xml version="1.0"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
            <title>Example</title><link>https://example.com/blog</link>
            <atom:link rel="self" type="application/rss+xml" href="https://example.com/blog/feed/" />
            <item><title>Post</title><link>https://example.com/blog/post</link></item>
          </channel></rss>`,
          { headers: { "Content-Type": "application/rss+xml" } },
        ),
      ),
    );

    const discovered = await discoverFeed("https://example.com/blog/feed");

    expect(discovered.feedUrl).toBe("https://example.com/blog/feed/");
  });

  it("recovers a feed link from an HTML error page", async () => {
    const feedXml = `<?xml version="1.0"?><rss version="2.0"><channel>
      <title>Recovered feed</title><link>https://example.com</link>
      <item><title>Entry</title></item>
    </channel></rss>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          url === "https://example.com/feed.xml"
            ? new Response(feedXml, { headers: { "Content-Type": "application/rss+xml" } })
            : new Response(
                '<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>',
                { status: 404, headers: { "Content-Type": "text/html" } },
              ),
        ),
      ),
    );

    const discovered = await discoverFeed("https://example.com/old/feed/");

    expect(discovered.feedUrl).toBe("https://example.com/feed.xml");
    expect(discovered.parsed.title).toBe("Recovered feed");
  });

  it("keeps the fetched URL when the self link points at a non-feed page", async () => {
    // agenda-note.com pattern: the Atom feed's rel="self" names the HTML homepage
    const feedXml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <title>Example</title>
      <link rel="self" href="https://example.com/"/>
      <entry><id>tag:1</id><title>Entry</title></entry>
    </feed>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          url === "https://example.com/RSS.rdf"
            ? new Response(feedXml, { headers: { "Content-Type": "application/xml" } })
            : new Response("<html><body>home</body></html>", { headers: { "Content-Type": "text/html" } }),
        ),
      ),
    );

    const discovered = await discoverFeed("https://example.com/RSS.rdf");

    expect(discovered.feedUrl).toBe("https://example.com/RSS.rdf");
  });

  it("follows a self link that itself serves a feed", async () => {
    const feedAt = (self: string) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <title>Example</title>
      <link rel="self" href="${self}"/>
      <entry><id>tag:1</id><title>Entry</title></entry>
    </feed>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(feedAt("https://example.com/atom.xml"), { headers: { "Content-Type": "application/xml" } }),
        ),
      ),
    );

    const discovered = await discoverFeed("https://example.com/feed");

    expect(discovered.feedUrl).toBe("https://example.com/atom.xml");
  });
});

describe("safeFetch redirects", () => {
  afterEach(() => vi.unstubAllGlobals());

  const redirect = (status: number, location: string) =>
    new Response(null, { status, headers: { Location: location } });

  it("reports a permanent move with the final URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(redirect(301, "https://new.example.com/feed"))
        .mockResolvedValueOnce(new Response("ok")),
    );
    const result = await safeFetch("https://old.example.com/feed");
    expect(result.response.ok).toBe(true);
    expect(result.finalUrl).toBe("https://new.example.com/feed");
    expect(result.permanentRedirect).toBe(true);
  });

  it("does not treat a chain containing a temporary redirect as a move", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(redirect(301, "https://cdn.example.com/feed"))
        .mockResolvedValueOnce(redirect(302, "https://origin.example.com/feed"))
        .mockResolvedValueOnce(new Response("ok")),
    );
    const result = await safeFetch("https://old.example.com/feed");
    expect(result.finalUrl).toBe("https://origin.example.com/feed");
    expect(result.permanentRedirect).toBe(false);
  });

  it("reports no move for a direct response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));
    const result = await safeFetch("https://example.com/feed");
    expect(result.finalUrl).toBe("https://example.com/feed");
    expect(result.permanentRedirect).toBe(false);
  });

  it("retries a transient transport failure", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", fetch);

    const result = await safeFetch("https://example.com/feed", { retryDelayMs: 0 });

    expect(result.response.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry blocked URLs", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(safeFetch("http://localhost/feed", { retryDelayMs: 0 })).rejects.toMatchObject({
      code: "feed_unreachable",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("canonicalizeUrl", () => {
  it("strips tracking params, lowercases host, removes trailing slash", () => {
    expect(canonicalizeUrl("https://Example.com:443/Path/?utm_source=x&a=1&fbclid=y")).toBe(
      "https://example.com/Path?a=1"
    );
  });

  it("preserves trailing slashes for feed endpoints", () => {
    expect(canonicalizeFeedUrl("https://Example.com:443/Path/?utm_source=x&a=1&fbclid=y")).toBe(
      "https://example.com/Path/?a=1"
    );
  });
});

describe("opml", () => {
  it("parses folders as tags and round-trips through export", () => {
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/><body>
      <outline text="Tech">
        <outline type="rss" text="Blog A" xmlUrl="https://a.example/feed" htmlUrl="https://a.example"/>
      </outline>
      <outline type="rss" text="Blog B" xmlUrl="https://b.example/feed"/>
    </body></opml>`;
    const { outlines, total } = parseOpml(xml);
    expect(total).toBe(2);
    expect(outlines[0]).toEqual({ feedUrl: "https://a.example/feed", siteUrl: "https://a.example", title: "Blog A", tagNames: ["Tech"] });
    expect(outlines[1]?.tagNames).toEqual([]);
    expect(outlines[1]?.siteUrl).toBeNull();

    const exported = buildOpml([
      { title: "Blog A", feedUrl: "https://a.example/feed", siteUrl: "https://a.example", tagNames: ["Tech"] },
      { title: "Blog <B>", feedUrl: "https://b.example/feed", siteUrl: null, tagNames: [] },
    ]);
    expect(exported).toContain('text="Tech"');
    expect(exported).toContain("Blog &lt;B&gt;");
    const reparsed = parseOpml(exported);
    expect(reparsed.total).toBe(2);
    expect(reparsed.outlines[0]?.tagNames).toEqual(["Tech"]);
  });
});

describe("util", () => {
  it("converts html to text", () => {
    expect(htmlToText("<p>Hello <b>world</b></p><script>alert(1)</script>")).toBe("Hello world");
  });
  it("preserves meaningful img alt text", () => {
    expect(htmlToText('<p>See <img src="x.png" alt="chart showing growth"> below</p>')).toBe(
      "See chart showing growth below"
    );
  });
  it("discards short or empty img alt text", () => {
    expect(htmlToText('<p>A<img alt="">B<img alt="ico">C<img src="x.png">D</p>')).toBe("A B C D");
  });
  it("normalizes tag names", () => {
    expect(normalizeTagName(" ＡＩ ")).toBe("ai");
  });
  it("builds preview text", () => {
    expect(previewFrom("  hello\n world  ")).toBe("hello world");
    expect(previewFrom("x".repeat(300))?.length).toBe(201);
    expect(previewFrom("")).toBeNull();
  });
});
