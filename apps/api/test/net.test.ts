import { afterEach, describe, expect, it, vi } from "vitest";
import { safeFetch, withDefaultScheme } from "../src/lib/net";

describe("safeFetch URL policy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    "localhost", "localhost.", "feed.localhost", "host.local", "host.internal",
    "metadata.google.internal", "127.0.0.1", "127.1", "2130706433", "0x7f000001",
    "0.0.0.0", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.0.1",
    "169.254.169.254", "100.64.0.1", "100.127.255.254", "198.18.0.1", "198.19.0.1",
    "192.0.2.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255",
    "[::]", "[::1]", "[0:0:0:0:0:ffff:127.0.0.1]", "[::ffff:169.254.169.254]",
    "[::ffff:a00:1]", "[::127.0.0.1]", "[fc00::1]", "[fdff::1]",
    "[fe80::1]", "[fe90::1]", "[fea0::1]", "[febf::1]", "[fec0::1]", "[ff02::1]",
    "[64:ff9b::a9fe:a9fe]", "[2001:db8::1]",
  ])("rejects non-public literal or local hostname %s before fetching", async (host) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(safeFetch(`http://${host}/feed`)).rejects.toMatchObject({ code: "feed_unreachable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["https://example.com/feed", "https://8.8.8.8/feed", "https://[2606:4700:4700::1111]/feed"])(
    "allows a public destination %s", async (url) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));
      expect((await safeFetch(url)).response.ok).toBe(true);
    },
  );

  it.each(["file:///etc/passwd", "ftp://example.com/feed", "invalid", "https://user:password@example.com/feed"])(
    "rejects unsupported or credential-bearing URL %s", async (url) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expect(safeFetch(url)).rejects.toMatchObject({ code: "validation_error" });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["http://[::ffff:127.0.0.1]/secret", "http://169.254.169.254/metadata", "http://[fe90::1]/feed"])(
    "blocks a redirect to %s without retrying or fetching it", async (location) => {
      const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: location } }));
      vi.stubGlobal("fetch", fetch);

      await expect(safeFetch("https://example.com/feed")).rejects.toMatchObject({ code: "feed_unreachable" });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
});

describe("withDefaultScheme", () => {
  it.each([
    ["example.com", "https://example.com"],
    ["  example.com/feed.xml\n", "https://example.com/feed.xml"],
    ["http://example.com", "http://example.com"],
    ["HTTPS://example.com", "HTTPS://example.com"],
  ])("normalizes %s", (input, expected) => {
    expect(withDefaultScheme(input)).toBe(expected);
  });
});
