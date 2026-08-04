import { backgroundApi } from "./backgroundApi";

interface SessionItem {
  articleId: number | null;
  article: {
    title: string;
    sourceLanguage: string | null;
    canonicalUrl: string | null;
  };
}

interface ReaderSession {
  items: SessionItem[];
  index: number;
  readingTabId: number | null;
  temporary: boolean;
  autoplay: boolean;
  targetLanguage: string;
  rate: number;
  voiceName: string | null;
  playing: boolean;
  positionPercent: number;
}

const STATE_KEY = "filo:readerSession";
let playToken = 0;
let lastProgressPublishedAt = 0;

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

async function loadState(): Promise<ReaderSession | null> {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return (stored[STATE_KEY] as ReaderSession | undefined) ?? null;
}

async function saveState(state: ReaderSession): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: state });
  const item = currentItem(state);
  if (item?.articleId == null) return;
  await publishState(state);
  await backgroundApi.updatePlaybackState({
    currentArticleId: item.articleId,
    contentLanguage: state.targetLanguage || item.article.sourceLanguage || null,
    positionPercent: state.positionPercent,
  }).catch(() => undefined);
}

async function publishToWeb(event: unknown): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => tab.id == null ? Promise.resolve() :
    chrome.tabs.sendMessage(tab.id, { type: "filoWebEvent", event }).catch(() => undefined)));
}

async function publishState(state: ReaderSession): Promise<void> {
  const item = state.items[state.index] ?? null;
  await publishToWeb({
    type: "playbackState",
    currentArticleId: item?.articleId ?? null,
    contentLanguage: state.targetLanguage || item?.article.sourceLanguage || null,
    positionPercent: state.positionPercent,
  });
}

function currentItem(state: ReaderSession): SessionItem | null {
  return state.items[state.index] ?? null;
}

function popupState(state: ReaderSession | null) {
  if (!state) return null;
  const item = currentItem(state);
  return {
    currentArticleId: item?.articleId ?? null,
    index: state.index,
    count: state.items.length,
    title: item?.article.title ?? "",
    playing: state.playing,
    rate: state.rate,
    voiceName: state.voiceName,
    targetLanguage: state.targetLanguage,
    positionPercent: state.positionPercent,
    canPrevious: state.index > 0,
    canNext: state.index + 1 < state.items.length,
  };
}

async function openCurrent(state: ReaderSession): Promise<void> {
  const item = currentItem(state);
  const url = item?.article.canonicalUrl;
  if (!url) return;
  state.playing = false;
  state.positionPercent = 0;
  playToken += 1;
  chrome.tts.stop();
  if (state.temporary) {
    const autoplay = state.autoplay;
    state.autoplay = false;
    await saveState(state);
    if (autoplay) await playCurrent();
    return;
  }
  if (state.readingTabId == null) {
    const tab = await chrome.tabs.create({ url, active: true });
    state.readingTabId = tab.id ?? null;
  } else {
    try {
      await chrome.tabs.update(state.readingTabId, { url, active: true });
    } catch {
      const tab = await chrome.tabs.create({ url, active: true });
      state.readingTabId = tab.id ?? null;
    }
  }
  await saveState(state);
}

async function markCurrentRead(state: ReaderSession): Promise<void> {
  const item = currentItem(state);
  if (!item || item.articleId == null) return;
  await Promise.all([
    backgroundApi.setArticleRead(item.articleId).catch(() => undefined),
    publishToWeb({ type: "articleRead", articleId: item.articleId }),
  ]);
}

async function move(delta: number, markRead = true): Promise<void> {
  const state = await loadState();
  if (!state) return;
  const next = state.index + delta;
  if (next < 0 || next >= state.items.length) {
    state.playing = false;
    state.positionPercent = delta > 0 ? 1 : state.positionPercent;
    playToken += 1;
    chrome.tts.stop();
    await saveState(state);
    return;
  }
  if (markRead) await markCurrentRead(state);
  state.index = next;
  await openCurrent(state);
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

async function playCurrent(): Promise<void> {
  const state = await loadState();
  const item = state && currentItem(state);
  if (!state || !item || state.readingTabId == null) return;
  const extracted = await chrome.tabs.sendMessage(state.readingTabId, { type: "filoExtract" }).catch(() => null) as
    | { text: string; lang: string | null }
    | null;
  if (!extracted?.text) return;
  const text = await translateBestEffort(
    extracted.text,
    extracted.lang ?? item.article.sourceLanguage,
    state.targetLanguage,
  );
  const token = ++playToken;
  state.playing = true;
  state.positionPercent = 0;
  await saveState(state);
  chrome.tts.stop();
  chrome.tts.speak(text, {
    lang: state.targetLanguage || extracted.lang || item.article.sourceLanguage || undefined,
    rate: state.rate,
    voiceName: state.voiceName ?? undefined,
    enqueue: false,
    onEvent: (event) => {
      if (token !== playToken) return;
      void (async () => {
        const latest = await loadState();
        if (!latest) return;
        if (event.type === "word" || event.type === "sentence") {
          if (Date.now() - lastProgressPublishedAt < 10_000) return;
          lastProgressPublishedAt = Date.now();
          latest.positionPercent = Math.min(1, (event.charIndex ?? 0) / Math.max(1, text.length));
          await saveState(latest);
        } else if (event.type === "end") {
          latest.playing = false;
          latest.positionPercent = 1;
          await saveState(latest);
          await markCurrentRead(latest);
          await move(1, false);
        } else if (event.type === "error" || event.type === "cancelled" || event.type === "interrupted") {
          latest.playing = false;
          await saveState(latest);
        }
      })();
    },
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "filoStart") {
    void (async () => {
      const items = (message.session?.items as SessionItem[]).filter((item) => item.article.canonicalUrl);
      const requestedId = typeof message.articleId === "number" ? message.articleId : null;
      const currentId = requestedId ?? message.session?.playbackState?.currentArticleId as number | null;
      const index = Math.max(0, items.findIndex((item) => item.articleId === currentId));
      const previous = await loadState();
      const state: ReaderSession = {
        items,
        index,
        readingTabId: previous?.readingTabId ?? null,
        temporary: false,
        autoplay: message.autoplay === true,
        targetLanguage: String(message.targetLanguage || ""),
        rate: previous?.rate ?? 1,
        voiceName: previous?.voiceName ?? null,
        playing: false,
        positionPercent: 0,
      };
      await openCurrent(state);
      sendResponse({ ok: true, data: popupState(state) });
    })().catch((error: unknown) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    return true;
  }
  if (message?.type === "filoStartPage") {
    void (async () => {
      const page = message.page as { tabId?: number; url?: string; title?: string } | undefined;
      if (!page || typeof page.tabId !== "number" || !/^https?:\/\//i.test(String(page.url ?? ""))) {
        throw new Error("読み上げできるページがありません。");
      }
      const previous = await loadState();
      const state: ReaderSession = {
        items: [{
          articleId: null,
          article: {
            title: String(page.title || page.url),
            sourceLanguage: null,
            canonicalUrl: String(page.url),
          },
        }],
        index: 0,
        readingTabId: page.tabId,
        temporary: true,
        autoplay: message.autoplay === true,
        targetLanguage: String(message.targetLanguage || ""),
        rate: previous?.rate ?? 1,
        voiceName: previous?.voiceName ?? null,
        playing: false,
        positionPercent: 0,
      };
      await openCurrent(state);
      sendResponse({ ok: true, data: popupState(await loadState()) });
    })().catch((error: unknown) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    return true;
  }
  if (message?.type === "filoPageReady") {
    void (async () => {
      const state = await loadState();
      if (!state || sender.tab?.id !== state.readingTabId) return;
      if (!state.temporary) await publishState(state);
      if (state.autoplay) await playCurrent();
    })();
    return false;
  }
  if (message?.type === "filoControl") {
    void (async () => {
      const state = await loadState();
      if (!state) {
        sendResponse({ ok: false, error: "再生中のセッションがありません。" });
        return;
      }
      if (message.action === "play") await playCurrent();
      if (message.action === "pause") {
        playToken += 1;
        chrome.tts.stop();
        state.playing = false;
        await saveState(state);
      }
      if (message.action === "next") await move(1);
      if (message.action === "previous") await move(-1);
      if (message.action === "settings") {
        if (typeof message.rate === "number") state.rate = Math.min(3, Math.max(0.75, message.rate));
        if (typeof message.voiceName === "string" || message.voiceName === null) state.voiceName = message.voiceName;
        if (typeof message.targetLanguage === "string") state.targetLanguage = message.targetLanguage;
        await saveState(state);
        if (state.playing) await playCurrent();
      }
      sendResponse({ ok: true, data: popupState(await loadState()) });
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
  if (message?.type === "filoGetReaderState") {
    void loadState()
      .then((state) => sendResponse({ ok: true, data: popupState(state) }))
      .catch((error: unknown) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    return true;
  }
  return false;
});
