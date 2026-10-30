import { strict as assert } from "node:assert";
import { test } from "node:test";
import { articleShortcut } from "../src/lib/articleShortcuts.ts";

const key = (value: string, options: Partial<KeyboardEvent> = {}) => articleShortcut({
  key: value, repeat: false, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...options,
});

test("article shortcuts cover navigation, actions and scoped bulk operations", () => {
  for (const [input, expected] of [["j", "next"], ["ArrowDown", "next"], ["k", "previous"], ["ArrowUp", "previous"], ["Enter", "open"], ["o", "open"], ["v", "external"], ["m", "read"], ["s", "list"], ["b", "bookmark"], ["r", "refresh"]] as const) {
    assert.equal(key(input), expected);
  }
  assert.equal(key("A", { shiftKey: true }), "markAll");
  assert.equal(key("?", { shiftKey: true }), "help");
});

test("modified keys and repeated mutations do not trigger actions", () => {
  assert.equal(key("r", { ctrlKey: true }), null);
  assert.equal(key("m", { metaKey: true }), null);
  assert.equal(key("m", { repeat: true }), null);
  assert.equal(key("A", { shiftKey: true, repeat: true }), null);
  assert.equal(key("j", { repeat: true }), "next");
});
