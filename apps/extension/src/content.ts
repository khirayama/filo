import { Readability } from "@mozilla/readability";
import { WEB_APP_URL } from "./config";

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extract() {
  const article = new Readability(document.cloneNode(true) as Document).parse();
  const text = article?.textContent?.trim() ?? "";
  if (!text) {
    console.warn("[Filo Reader] Readabilityから本文を取得できませんでした");
    return null;
  }

  const title = article?.title?.trim() || document.title.trim();
  const articleText = title && !text.startsWith(title) ? `${title}\n\n${text}` : text;
  console.info("[Filo Reader] 抽出本文", articleText);
  return {
    text: articleText,
    lang: article?.lang || document.documentElement.lang || null,
  };
}

function selectedText(): { text: string; lang: string | null } | null {
  const text = normalize(window.getSelection()?.toString() ?? "");
  return text ? { text, lang: document.documentElement.lang || null } : null;
}

const WEB_SOURCE = "filo-web";
const EXTENSION_SOURCE = "filo-extension";
const WEB_APP_ORIGIN = new URL(WEB_APP_URL).origin;

// Web のリーディングリストから現在の拡張機能へ記事を引き渡す。
// Web ページとは postMessage、バックグラウンドとは runtime message に分け、
// 拡張機能の認証情報や設定をページへ公開しない。
window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== WEB_APP_ORIGIN || event.data?.source !== WEB_SOURCE) return;
  if (event.data.type === "ping") {
    window.postMessage({ source: EXTENSION_SOURCE, type: "ready" }, "*");
    return;
  }
  if (event.data.type !== "startArticle") return;

  const requestId = typeof event.data.requestId === "string" ? event.data.requestId : "";
  void chrome.runtime.sendMessage({
    type: "filoStartArticleFromWeb",
    requestId,
    articleId: typeof event.data.articleId === "number" ? event.data.articleId : undefined,
    url: typeof event.data.url === "string" ? event.data.url : "",
    title: typeof event.data.title === "string" ? event.data.title : "",
    autoplay: event.data.autoplay === true,
    targetLanguage: typeof event.data.targetLanguage === "string" ? event.data.targetLanguage : undefined,
  }).then((response: { ok?: boolean } | undefined) => {
    window.postMessage({
      source: EXTENSION_SOURCE,
      type: "startResult",
      requestId,
      ok: response?.ok === true,
    }, "*");
  }).catch(() => {
    window.postMessage({
      source: EXTENSION_SOURCE,
      type: "startResult",
      requestId,
      ok: false,
    }, "*");
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "filoGetSelection") {
    sendResponse(selectedText());
    return false;
  }
  if (message?.type !== "filoExtract") return false;
  try {
    sendResponse(extract());
  } catch {
    sendResponse(null);
  }
  return false;
});
