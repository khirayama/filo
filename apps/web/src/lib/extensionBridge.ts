const WEB_SOURCE = "filo-web";
const EXTENSION_SOURCE = "filo-extension";
const EXTENSION_ERROR = "拡張機能を操作できませんでした。";

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function detectReadingExtension(timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", onMessage);
      resolve(available);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data?.source === EXTENSION_SOURCE && event.data?.type === "ready") finish(true);
    };
    window.addEventListener("message", onMessage);
    const timeoutId = window.setTimeout(() => finish(false), timeoutMs);
    window.postMessage({ source: WEB_SOURCE, type: "ping" }, "*");
  });
}

export function launchReadingExtension(
  article: { id: number; url: string; title?: string | null },
  options: { autoplay: boolean; targetLanguage: string },
  timeoutMs = 3000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = requestId();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", onMessage);
      if (error) reject(error);
      else resolve();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (data?.source !== EXTENSION_SOURCE || data?.type !== "startResult" || data?.requestId !== id) return;
      finish(data.ok === true ? undefined : new Error(EXTENSION_ERROR));
    };
    window.addEventListener("message", onMessage);
    const timeoutId = window.setTimeout(() => finish(new Error(EXTENSION_ERROR)), timeoutMs);
    window.postMessage({
      source: WEB_SOURCE,
      type: "startArticle",
      requestId: id,
      articleId: article.id,
      url: article.url,
      title: article.title ?? "",
      autoplay: options.autoplay,
      targetLanguage: options.targetLanguage,
    }, "*");
  });
}
