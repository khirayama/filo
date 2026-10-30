import { strict as assert } from "node:assert";
import { test } from "node:test";
import { launchReadingExtension } from "../src/lib/extensionBridge.ts";

test("extension authentication errors are shown to the web caller", async () => {
  const previous = globalThis.window;
  const listeners = new Set<(event: { source: unknown; data: unknown }) => void>();
  const fake = {
    setTimeout,
    clearTimeout,
    addEventListener: (_: string, listener: (event: { source: unknown; data: unknown }) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: { source: unknown; data: unknown }) => void) => listeners.delete(listener),
    postMessage: (message: { requestId: string }) => queueMicrotask(() => {
      for (const listener of listeners) listener({ source: fake, data: {
        source: "filo-extension", type: "startResult", requestId: message.requestId,
        ok: false, error: "拡張機能にログインしてください。",
      } });
    }),
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: fake });
  try {
    await assert.rejects(
      launchReadingExtension({ id: 1, url: "https://example.com" }, { autoplay: false, targetLanguage: "ja" }),
      /拡張機能にログインしてください/,
    );
    assert.equal(listeners.size, 0);
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previous });
  }
});
