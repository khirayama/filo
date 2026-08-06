import { Readability } from "@mozilla/readability";

const WEB_SOURCE = "filo-web";
const EXTENSION_SOURCE = "filo-extension";

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== WEB_SOURCE) return;
  if (event.data.type === "ping") {
    window.postMessage({ source: EXTENSION_SOURCE, type: "ready" }, "*");
  }
});

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function articleText(article: { title?: string | null; content?: string | null; textContent?: string | null }): string {
  const lines: string[] = [];
  const title = normalize(article.title ?? "") || normalize(document.title);
  if (article.content) {
    const content = new DOMParser().parseFromString(article.content, "text/html").body;
    const blockTags = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "LI", "BLOCKQUOTE", "PRE", "FIGCAPTION", "DT", "DD"]);
    const visit = (node: Node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const element = child as HTMLElement;
        if (blockTags.has(element.tagName)) {
          const value = normalize(element.textContent ?? "");
          if (value) lines.push(value);
        } else {
          visit(element);
        }
      }
    };
    visit(content);
  }
  if (lines.length === 0) lines.push(...(article.textContent ?? "").split(/\n+/).map(normalize).filter(Boolean));
  const contentLines = title && lines[0] === title ? lines.slice(1) : lines;
  return [title, ...contentLines].filter(Boolean).join("\n\n");
}

function extract() {
  // 記事の HTML を意味ブロック単位で再構成し、heading の取りこぼしを避ける。
  const article = new Readability(document.cloneNode(true) as Document, { charThreshold: 100 }).parse();
  const text = article ? articleText(article) : "";
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
