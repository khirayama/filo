import { Readability } from "@mozilla/readability";
import { WEB_APP_URL } from "./config";
import type { CapturedText, CaptureKind, PageReader } from "./reader";

// This bundle is declared as a content script only for the Filo Web origin
// (the launch bridge) and is injected on demand into other pages when the user
// reads them. Both paths share one isolated world, so guard re-injection.
declare global {
  // eslint-disable-next-line no-var
  var __filoReader: PageReader | undefined;
}

const MIN_TEXT_LENGTH = 100;
const BLOCK_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "LI", "BLOCKQUOTE", "PRE", "FIGCAPTION", "DT", "DD"]);

function normalize(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function withTitle(title: string, lines: string[]): string {
  const body = lines[0] === title ? lines.slice(1) : lines;
  return [title, ...body].filter(Boolean).join("\n");
}

function pageLanguage(): string | null {
  return document.documentElement.lang || null;
}

// The rendered text of the page's main container. innerText follows what is
// on screen, so a page translated by the browser is read as displayed.
function displayedText(): string {
  const root = document.querySelector<HTMLElement>("article")
    ?? document.querySelector<HTMLElement>("main")
    ?? document.body;
  if (!root) return "";
  const lines: string[] = [];
  for (const line of root.innerText.split(/\n+/)) {
    const value = normalize(line);
    if (value && value !== lines[lines.length - 1]) lines.push(value);
  }
  return withTitle(normalize(document.title), lines);
}

// Same Readability settings and block walk as the iOS / Android reader.
function extractedText(): { text: string; lang: string | null } {
  const article = new Readability(document.cloneNode(true) as Document, { charThreshold: MIN_TEXT_LENGTH }).parse();
  if (!article) return { text: "", lang: null };
  const lines: string[] = [];
  const root = new DOMParser().parseFromString(article.content ?? "", "text/html").body;
  const visit = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (BLOCK_TAGS.has(child.tagName)) {
        const value = normalize(child.textContent);
        if (value) lines.push(value);
      } else {
        visit(child);
      }
    }
  };
  visit(root);
  if (lines.length === 0) lines.push(...(article.textContent ?? "").split(/\n+/).map(normalize).filter(Boolean));
  const title = normalize(article.title) || normalize(document.title);
  return { text: withTitle(title, lines), lang: article.lang || null };
}

function capturePage(): CapturedText | null {
  const displayed = displayedText();
  if (displayed.length >= MIN_TEXT_LENGTH) return { text: displayed, lang: pageLanguage() };
  try {
    const extracted = extractedText();
    if (extracted.text.length >= MIN_TEXT_LENGTH) return { text: extracted.text, lang: extracted.lang ?? pageLanguage() };
  } catch {
    // Readability can throw while the page is still mutating; the caller retries.
  }
  return null;
}

function captureSelection(): CapturedText | null {
  const text = normalize(window.getSelection()?.toString());
  return text ? { text, lang: pageLanguage() } : null;
}

interface TranslatorInstance { translate(value: string): Promise<string> }
interface TranslatorFactory {
  availability(pair: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(pair: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorInstance>;
}

// The Translator API exists only in window contexts, so translation runs here
// rather than in the service worker. A model that still needs downloading
// requires a user gesture on the page, which reading never has; report it as
// unavailable and let the caller read the original.
const translators = new Map<string, Promise<TranslatorInstance | null>>();

function translatorFor(source: string, target: string): Promise<TranslatorInstance | null> {
  const key = `${source}>${target}`;
  let translator = translators.get(key);
  if (!translator) {
    const api = (globalThis as { Translator?: TranslatorFactory }).Translator;
    translator = (async () => {
      if (!api) return null;
      const pair = { sourceLanguage: source, targetLanguage: target };
      if (await api.availability(pair) !== "available") return null;
      return api.create(pair);
    })().catch(() => null);
    translators.set(key, translator);
  }
  return translator;
}

const firstInjection = !globalThis.__filoReader;
globalThis.__filoReader ??= {
  capture(kind: CaptureKind) {
    return kind === "selection" ? captureSelection() : capturePage();
  },
  async translate(text: string, source: string, target: string) {
    const translator = await translatorFor(source, target);
    if (!translator) return null;
    try {
      return await translator.translate(text);
    } catch {
      return null;
    }
  },
};

const WEB_SOURCE = "filo-web";
const EXTENSION_SOURCE = "filo-extension";
const WEB_APP_ORIGIN = new URL(WEB_APP_URL).origin;

// The Web reading list hands an article to the extension. The page and the
// extension talk through postMessage only, so no extension credentials or
// settings are exposed to the page.
if (firstInjection && location.origin === WEB_APP_ORIGIN) {
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== WEB_APP_ORIGIN || event.data?.source !== WEB_SOURCE) return;
    if (event.data.type === "ping") {
      window.postMessage({ source: EXTENSION_SOURCE, type: "ready" }, WEB_APP_ORIGIN);
      return;
    }
    if (event.data.type !== "startArticle") return;

    const requestId = typeof event.data.requestId === "string" ? event.data.requestId : "";
    const reply = (ok: boolean) => window.postMessage({ source: EXTENSION_SOURCE, type: "startResult", requestId, ok }, WEB_APP_ORIGIN);
    chrome.runtime.sendMessage({
      type: "startFromWeb",
      articleId: typeof event.data.articleId === "number" ? event.data.articleId : undefined,
      url: typeof event.data.url === "string" ? event.data.url : "",
      title: typeof event.data.title === "string" ? event.data.title : "",
      autoplay: event.data.autoplay === true,
      targetLanguage: typeof event.data.targetLanguage === "string" ? event.data.targetLanguage : undefined,
    }).then((response: { ok?: boolean } | undefined) => reply(response?.ok === true), () => reply(false));
  });
}
