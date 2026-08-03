import { Readability } from "@mozilla/readability";

const WEB_SOURCE = "filo-web";
const EXTENSION_SOURCE = "filo-extension";

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== WEB_SOURCE) return;
  if (event.data.type === "ping") {
    window.postMessage({ source: EXTENSION_SOURCE, type: "ready" }, "*");
  } else if (event.data.type === "start") {
    const requestId = event.data.requestId;
    try {
      chrome.runtime.sendMessage({
        type: "filoStart",
        session: event.data.session,
        autoplay: event.data.autoplay,
        targetLanguage: event.data.targetLanguage,
      }).then((response) => {
        window.postMessage({
          source: EXTENSION_SOURCE,
          type: "startResult",
          requestId,
          ok: response?.ok === true,
          error: response?.error,
        }, "*");
      }).catch((error: unknown) => {
        window.postMessage({
          source: EXTENSION_SOURCE,
          type: "startResult",
          requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }, "*");
      });
    } catch (error) {
      window.postMessage({
        source: EXTENSION_SOURCE,
        type: "startResult",
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, "*");
    }
  }
});

function extract() {
  // 短い誤抽出を避ける一方、記事の取りこぼしを増やさない設定にする。
  const article = new Readability(document.cloneNode(true) as Document, { charThreshold: 100 }).parse();
  const text = article?.textContent?.trim() ?? "";
  return text.length >= 100
    ? { text, lang: article?.lang ?? document.documentElement.lang ?? null }
    : null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "filoExtract") {
    sendResponse(extract());
    return false;
  }
  if (message?.type === "filoWebEvent") {
    window.postMessage({ source: EXTENSION_SOURCE, type: "event", event: message.event }, "*");
    return false;
  }
  return false;
});

chrome.runtime.sendMessage({ type: "filoPageReady" }).catch(() => undefined);
