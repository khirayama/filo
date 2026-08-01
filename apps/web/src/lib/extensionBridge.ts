import type { ReadingSession } from "../api/types";

const SOURCE = "filo-web";
const EXTENSION = "filo-extension";

export type ExtensionEvent =
  | { type: "articleRead"; articleId: number }
  | { type: "playbackState"; currentArticleId: number | null; contentLanguage: string | null; positionPercent: number };

export async function detectReadingExtension(timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source === window && event.data?.source === EXTENSION && event.data?.type === "ready") finish(true);
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ source: SOURCE, type: "ping" }, "*");
    window.setTimeout(() => finish(false), timeoutMs);
  });
}

export function launchReadingExtension(
  session: ReadingSession,
  options: { autoplay: boolean; targetLanguage: string },
  timeoutMs = 3_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    let done = false;
    const finish = (error?: string) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timeout);
      if (error) reject(new Error(error));
      else resolve();
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== window
        || event.data?.source !== EXTENSION
        || event.data?.type !== "startResult"
        || event.data?.requestId !== requestId
      ) return;
      finish(event.data.ok ? undefined : (event.data.error ?? "拡張機能を起動できませんでした。"));
    };
    const timeout = window.setTimeout(
      () => finish("拡張機能から応答がありません。ページを再読み込みしてください。"),
      timeoutMs,
    );
    window.addEventListener("message", onMessage);
    window.postMessage({
      source: SOURCE,
      type: "start",
      requestId,
      session,
      autoplay: options.autoplay,
      targetLanguage: options.targetLanguage,
      appUrl: new URL("/articles?readingList=1", window.location.origin).toString(),
    }, "*");
  });
}

export function subscribeExtensionEvents(listener: (event: ExtensionEvent) => void): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window || event.data?.source !== EXTENSION || event.data?.type !== "event") return;
    listener(event.data.event as ExtensionEvent);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
