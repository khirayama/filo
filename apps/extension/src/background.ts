import { createExtensionApi } from "./api";
import { getToken } from "./auth";

type ExtractionMode = "article" | "display";
type SessionExtractionMode = ExtractionMode | "selection";

interface ReaderSession {
  tabId: number;
  articleId?: number;
  autoplay: boolean;
  targetLanguage: string;
  rate: number;
  voiceName: string | null;
  extractionMode: SessionExtractionMode;
  selectionText?: string;
  selectionLang?: string | null;
  playing: boolean;
}

const STATE_KEY = "filo:readerState";
const SETTINGS_KEY = "filo:readerSettings";
const DEFAULT_SETTINGS = {
  targetLanguage: "ja",
  rate: 1,
  voiceName: null as string | null,
  extractionMode: "article" as ExtractionMode,
};
let playToken = 0;
const readerApi = createExtensionApi(getToken);

interface ExtractedPage {
  text: string;
  lang: string | null;
}

function normalizeSelection(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSettingsExtractionMode(value: unknown): ExtractionMode {
  return value === "display" ? "display" : "article";
}

function normalizeSessionExtractionMode(value: unknown): SessionExtractionMode {
  return value === "display" || value === "selection" ? value : "article";
}

async function loadState(): Promise<ReaderSession | null> {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = stored[STATE_KEY] as ReaderSession | undefined;
  return state ? {
    ...state,
    extractionMode: normalizeSessionExtractionMode(state.extractionMode),
    selectionText: typeof state.selectionText === "string" ? state.selectionText : undefined,
    selectionLang: typeof state.selectionLang === "string" ? state.selectionLang : null,
  } : null;
}

async function loadSettings(): Promise<typeof DEFAULT_SETTINGS> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const value = stored[SETTINGS_KEY] as Partial<typeof DEFAULT_SETTINGS> | undefined;
  return {
    targetLanguage: typeof value?.targetLanguage === "string" && value.targetLanguage
      ? value.targetLanguage
      : DEFAULT_SETTINGS.targetLanguage,
    rate: typeof value?.rate === "number" && Number.isFinite(value.rate)
      ? Math.min(3, Math.max(0.75, value.rate))
      : DEFAULT_SETTINGS.rate,
    voiceName: typeof value?.voiceName === "string" || value?.voiceName === null
      ? value.voiceName
      : DEFAULT_SETTINGS.voiceName,
    extractionMode: normalizeSettingsExtractionMode(value?.extractionMode),
  };
}

async function saveSettings(settings: Partial<typeof DEFAULT_SETTINGS>): Promise<typeof DEFAULT_SETTINGS> {
  const next = await loadSettings();
  if (settings.targetLanguage !== undefined) next.targetLanguage = settings.targetLanguage;
  if (settings.rate !== undefined) next.rate = Math.min(3, Math.max(0.75, settings.rate));
  if (settings.voiceName !== undefined) next.voiceName = settings.voiceName;
  if (settings.extractionMode !== undefined) next.extractionMode = normalizeSettingsExtractionMode(settings.extractionMode);
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

async function saveState(state: ReaderSession): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

async function extractPage(tabId: number, extractionMode: ExtractionMode): Promise<ExtractedPage | null> {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "filoExtract", mode: extractionMode }) as ExtractedPage | null;
  } catch {
    // A manifest content script is not added retroactively to tabs that were
    // already open when an unpacked extension was installed or reloaded.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return await chrome.tabs.sendMessage(tabId, { type: "filoExtract", mode: extractionMode }) as ExtractedPage | null;
  }
}

async function extractSelection(tabId: number): Promise<ExtractedPage | null> {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "filoGetSelection" }) as ExtractedPage | null;
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return await chrome.tabs.sendMessage(tabId, { type: "filoGetSelection" }) as ExtractedPage | null;
  }
}

function splitText(text: string, maxLength = 3000): string[] {
  const chunks: string[] = [];
  let rest = text.replace(/\s+/g, " ").trim();
  while (rest.length > maxLength) {
    const slice = rest.slice(0, maxLength);
    const split = Math.max(slice.lastIndexOf("。"), slice.lastIndexOf("."), slice.lastIndexOf(" "));
    const at = split > maxLength * 0.4 ? split + 1 : maxLength;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function translateBestEffort(text: string, source: string | null, target: string): Promise<string> {
  if (!source || source.split("-")[0] === target.split("-")[0]) return text;
  const api = (globalThis as unknown as {
    Translator?: { create(pair: { sourceLanguage: string; targetLanguage: string }): Promise<{ translate(value: string): Promise<string> }> };
  }).Translator;
  if (!api) return text;
  try {
    const translator = await api.create({ sourceLanguage: source, targetLanguage: target });
    const translated: string[] = [];
    for (const chunk of splitText(text)) translated.push(await translator.translate(chunk));
    return translated.join("\n\n");
  } catch {
    return text;
  }
}

async function startSelection(tabId: number, selectionText: string, selectionLang: string | null = null): Promise<void> {
  const text = normalizeSelection(selectionText);
  if (!text) throw new Error("選択範囲がありません。読み上げる文章を選択してください。");

  const previous = await loadState();
  const settings = await loadSettings();
  await saveState({
    tabId,
    autoplay: false,
    targetLanguage: settings.targetLanguage,
    rate: previous?.rate ?? settings.rate,
    voiceName: previous?.voiceName ?? settings.voiceName,
    extractionMode: "selection",
    selectionText: text,
    selectionLang,
    playing: false,
  });
  await playCurrent();
}

async function playCurrentImpl(): Promise<void> {
  const token = ++playToken;
  const state = await loadState();
  if (!state) return;

  let text: string;
  let lang: string | null = null;
  if (state.extractionMode === "selection") {
    text = normalizeSelection(state.selectionText ?? "");
    lang = state.selectionLang ?? null;
  } else {
    let extracted: ExtractedPage | null;
    try {
      extracted = await extractPage(state.tabId, state.extractionMode);
    } catch {
      throw new Error("ページ本文を読み込めませんでした。ページを再読み込みしてからもう一度お試しください。");
    }
    if (!extracted?.text) throw new Error("このページから読み上げる文章を取得できませんでした。");

    // Display mode intentionally trusts the text currently visible in the
    // page. This avoids translating an already browser-translated page again.
    text = state.extractionMode === "display"
      ? extracted.text
      : await translateBestEffort(extracted.text, extracted.lang, state.targetLanguage);
    lang = extracted.lang;
  }
  if (token !== playToken) return;
  if (!text) throw new Error("このページから読み上げる文章を取得できませんでした。");
  state.autoplay = false;
  state.playing = true;
  await saveState(state);
  chrome.tts.stop();
  try {
    await new Promise<void>((resolve, reject) => {
      chrome.tts.speak(text, {
        lang: state.extractionMode === "selection"
          ? lang || state.targetLanguage || undefined
          : state.targetLanguage || lang || undefined,
        rate: state.rate,
        voiceName: state.voiceName ?? undefined,
        enqueue: false,
        onEvent: (event) => {
          if (token !== playToken) return;
          if (event.type !== "end" && event.type !== "error" && event.type !== "cancelled" && event.type !== "interrupted") return;
          void loadState().then(async (latest) => {
            if (!latest) return;
            latest.playing = false;
            await saveState(latest);
            if (event.type === "end" && latest.articleId !== undefined) {
              await readerApi.setArticleRead(latest.articleId, true).catch(() => undefined);
            }
          });
        },
      }, () => {
        const message = chrome.runtime.lastError?.message;
        if (message) reject(new Error(message));
        else resolve();
      });
    });
  } catch {
    state.playing = false;
    await saveState(state);
    throw new Error("音声の再生を開始できませんでした。読み上げ音声の設定を確認してください。");
  }
}

function playCurrent(): Promise<void> {
  // Every start invalidates the previous extraction/translation through
  // playToken. Coalescing promises here can otherwise make a newly selected
  // page wait for, and then accidentally keep, the previous page's playback.
  return playCurrentImpl();
}

const SELECTION_MENU_ID = "filo-read-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: SELECTION_MENU_ID,
      title: "選択範囲を読み上げ",
      contexts: ["selection"],
    }, () => {
      void chrome.runtime.lastError;
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== SELECTION_MENU_ID || tab?.id == null || !/^https?:\/\//i.test(tab.url ?? "")) return;
  void (async () => {
    const fallbackText = typeof info.selectionText === "string" ? info.selectionText : "";
    let selection = null;
    try {
      selection = await extractSelection(tab.id!);
    } catch {
      // The context menu still provides the selected text on pages where the
      // content script cannot be injected.
    }
    await startSelection(tab.id!, selection?.text ?? fallbackText, selection?.lang ?? null);
  })().catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "filoGetSettings") {
    void loadSettings().then((settings) => sendResponse({ ok: true, data: settings }));
    return true;
  }

  if (message?.type === "filoGetState") {
    void loadState().then((state) => sendResponse({ ok: true, data: state }));
    return true;
  }

  if (message?.type === "filoSetSettings") {
    void saveSettings({
      targetLanguage: typeof message.targetLanguage === "string" ? message.targetLanguage : undefined,
      rate: typeof message.rate === "number" ? Math.min(3, Math.max(0.75, message.rate)) : undefined,
      voiceName: typeof message.voiceName === "string" || message.voiceName === null ? message.voiceName : undefined,
      extractionMode: message.extractionMode === "display" || message.extractionMode === "article"
        ? message.extractionMode
        : undefined,
    }).then((settings) => sendResponse({ ok: true, data: settings }));
    return true;
  }

  if (message?.type === "filoGetSelection") {
    void (async () => {
      if (typeof message.tabId !== "number") throw new Error("選択範囲を取得できませんでした。");
      return await extractSelection(message.tabId);
    })().then((selection) => sendResponse({ ok: true, data: selection })).catch((error: unknown) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    return true;
  }

  if (message?.type === "filoStartPage") {
    void (async () => {
      const page = message.page as { tabId?: number; url?: string } | undefined;
      if (!page || typeof page.tabId !== "number" || !/^https?:\/\//i.test(String(page.url ?? ""))) {
        throw new Error("読み上げできるページがありません。");
      }
      const previous = await loadState();
      const settings = await loadSettings();
      const state: ReaderSession = {
        tabId: page.tabId,
        autoplay: true,
        targetLanguage: String(message.targetLanguage || settings.targetLanguage),
        rate: previous?.rate ?? settings.rate,
        voiceName: previous?.voiceName ?? settings.voiceName,
        extractionMode: normalizeSettingsExtractionMode(message.extractionMode ?? settings.extractionMode),
        playing: false,
      };
      await saveSettings({
        targetLanguage: state.targetLanguage,
        rate: state.rate,
        voiceName: state.voiceName,
        extractionMode: normalizeSettingsExtractionMode(state.extractionMode),
      });
      await saveState(state);
      await playCurrent();
      sendResponse({ ok: true, data: await loadSettings() });
    })().catch((error: unknown) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    return true;
  }

  if (message?.type === "filoStartArticleFromWeb") {
    void (async () => {
      const url = typeof message.url === "string" ? message.url : "";
      if (!/^https?:\/\//i.test(url)) throw new Error("読み上げできるページがありません。");
      const tab = await chrome.tabs.create({ url, active: true });
      if (typeof tab.id !== "number") throw new Error("読み上げできるページがありません。");

      const previous = await loadState();
      const settings = await loadSettings();
      const state: ReaderSession = {
        tabId: tab.id,
        articleId: typeof message.articleId === "number" && Number.isInteger(message.articleId)
          ? message.articleId
          : undefined,
        autoplay: message.autoplay === true,
        targetLanguage: typeof message.targetLanguage === "string" && message.targetLanguage
          ? message.targetLanguage
          : settings.targetLanguage,
        rate: previous?.rate ?? settings.rate,
        voiceName: previous?.voiceName ?? settings.voiceName,
        extractionMode: normalizeSettingsExtractionMode(previous?.extractionMode ?? settings.extractionMode),
        playing: false,
      };
      await saveSettings({
        targetLanguage: state.targetLanguage,
        rate: state.rate,
        voiceName: state.voiceName,
        extractionMode: normalizeSettingsExtractionMode(state.extractionMode),
      });
      await saveState(state);
      sendResponse({ ok: true, data: { tabId: tab.id } });
    })().catch((error: unknown) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    return true;
  }

  if (message?.type === "filoStartSelection") {
    void (async () => {
      const page = message.page as { tabId?: number; url?: string } | undefined;
      if (!page || typeof page.tabId !== "number" || !/^https?:\/\//i.test(String(page.url ?? ""))) {
        throw new Error("読み上げできるページがありません。");
      }
      await startSelection(
        page.tabId,
        typeof message.selectionText === "string" ? message.selectionText : "",
        typeof message.selectionLang === "string" ? message.selectionLang : null,
      );
      sendResponse({ ok: true, data: await loadSettings() });
    })().catch((error: unknown) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    return true;
  }

  if (message?.type === "filoPageReady") {
    void loadState().then((state) => {
      if (!state?.autoplay || sender.tab?.id !== state.tabId) return;
      void playCurrent();
    });
    return false;
  }

  if (message?.type === "filoControl") {
    void (async () => {
      const state = await loadState();
      if (!state) throw new Error("再生中のセッションがありません。");
      if (message.action === "play") await playCurrent();
      if (message.action === "pause") {
        playToken += 1;
        chrome.tts.stop();
        state.autoplay = false;
        state.playing = false;
        await saveState(state);
      }
      if (message.action === "settings") {
        if (typeof message.rate === "number") state.rate = Math.min(3, Math.max(0.75, message.rate));
        if (typeof message.voiceName === "string" || message.voiceName === null) state.voiceName = message.voiceName;
        if (typeof message.targetLanguage === "string") state.targetLanguage = message.targetLanguage;
        if (message.extractionMode === "display" || message.extractionMode === "article") state.extractionMode = message.extractionMode;
        await saveSettings({
          targetLanguage: state.targetLanguage,
          rate: state.rate,
          voiceName: state.voiceName,
          extractionMode: normalizeSettingsExtractionMode(state.extractionMode),
        });
        if (state.playing) {
          state.playing = false;
          await saveState(state);
          chrome.tts.stop();
          await playCurrent();
        } else {
          await saveState(state);
        }
      }
      sendResponse({ ok: true, data: await loadSettings() });
    })().catch((error: unknown) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    return true;
  }

  if (message?.type === "filoGetVoices") {
    chrome.tts.getVoices((voices) => sendResponse({
      ok: true,
      data: voices.map((voice) => ({ name: voice.voiceName, lang: voice.lang })),
    }));
    return true;
  }

  return false;
});
