import { strict as assert } from "node:assert";
import { test } from "node:test";
import { safeHttpUrl } from "../src/lib/url.ts";

test("allows only http(s) external URLs", () => {
  assert.equal(safeHttpUrl("https://example.com/article"), "https://example.com/article");
  assert.equal(safeHttpUrl("http://example.com/article"), "http://example.com/article");
  for (const value of ["javascript:alert(1)", "data:text/html,hello", "file:///etc/passwd", "mailto:a@example.com", "/relative"]) {
    assert.equal(safeHttpUrl(value), null);
  }
});
