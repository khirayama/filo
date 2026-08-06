import { describe, expect, it } from "vitest";
import { extractFromHtml, extractFromRssContent } from "../src/lib/extract";

describe("reading content extraction", () => {
  it("prefers complete RSS content without fetching the page", () => {
    const paragraph = "A useful article paragraph with enough text for speech. ".repeat(12);
    const result = extractFromRssContent(`<article><p>${paragraph}</p></article>`, null);
    expect(result?.text).toContain("useful article paragraph");
  });

  it("extracts the main article conservatively", () => {
    const paragraph = "Main article text that should remain available to the listener. ".repeat(8);
    const result = extractFromHtml(
      `<html><body><nav>menu</nav><article><h1>Title</h1><p>${paragraph}</p></article></body></html>`,
      "https://example.com/post",
      "Title",
    );
    expect(result?.text.startsWith("Title\n\n")).toBe(true);
    expect(result?.text).toContain("Title");
    expect(result?.text).toContain("Main article text");
  });

  it("keeps headings in speech order", () => {
    const paragraph = "Main article text that should remain available to the listener. ".repeat(8);
    const result = extractFromHtml(
      `<html><body><article><h2>Important section</h2><p>${paragraph}</p></article></body></html>`,
      "https://example.com/post",
      "Article title",
    );
    expect(result?.text).toContain("Article title\n\nImportant section\n\nMain article text");
  });

  it("respects publisher noarchive metadata", () => {
    const paragraph = "Private publisher content. ".repeat(30);
    expect(extractFromHtml(
      `<html><head><meta name="robots" content="noarchive"></head><body><article>${paragraph}</article></body></html>`,
      "https://example.com/private",
    )).toBeNull();
  });
});
