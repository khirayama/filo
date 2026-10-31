import { api, ExtensionApiError } from "./api";
import { speech, type SpeakOptions } from "./speech";
import { normalizeLanguage, translate } from "../../web/src/lib/messages";
import {
  baseLanguage,
  currentSessionItem,
  completedPageArticleId,
  saveSessionPage,
  sessionPageItem,
  pageKey,
  articleUrlKey,
  EMPTY_READER_STATE,
  READER_SETTINGS_KEY,
  READER_STATE_KEY,
  type CapturedText,
  type CaptureKind,
  type ReaderCommand,
  type ReaderItem,
  type ReaderPlayback,
  type ReaderSession,
  type ReaderSettings,
  type ReaderState,
} from "./reader";

const uiLanguage = normalizeLanguage(chrome.i18n.getUILanguage());

// ---------------------------------------------------------------------------
// State. The reading session and playback live in storage.session so the popup
// can render them and they survive service-worker restarts within a browser
// session. Updates are serialized so concurrent commands never lose writes.

let stateQueue: Promise<unknown> = Promise.resolve();

async function readState(): Promise<ReaderState> {
  const stored = (await chrome.storage.session.get(READER_STATE_KEY))[READER_STATE_KEY] as ReaderState | undefined;
  return stored ?? EMPTY_READER_STATE;
}

function updateState(update: (state: ReaderState) => ReaderState): Promise<ReaderState> {
  const next = stateQueue.then(async () => {
    const state = update(await readState());
    await chrome.storage.session.set({ [READER_STATE_KEY]: state });
    return state;
  });
  stateQueue = next.catch(() => undefined);
  return next;
}

async function loadSettings(): Promise<ReaderSettings> {
  const value = (await chrome.storage.local.get(READER_SETTINGS_KEY))[READER_SETTINGS_KEY] as Partial<ReaderSettings> | undefined;
  return {
    targetLanguage: typeof value?.targetLanguage === "string" && value.targetLanguage ? value.targetLanguage : uiLanguage,
    rate: typeof value?.rate === "number" && Number.isFinite(value.rate) ? clampRate(value.rate) : 1,
    voiceName: typeof value?.voiceName === "string" ? value.voiceName : null,
  };
}

async function saveSettings(patch: Partial<ReaderSettings>): Promise<ReaderSettings> {
  const next = { ...await loadSettings(), ...patch };
  next.rate = clampRate(next.rate);
  await chrome.storage.local.set({ [READER_SETTINGS_KEY]: next });
  return next;
}

function clampRate(value: number): number {
  return Math.min(3, Math.max(0.75, value));
}

// A new background cannot receive speech events for utterances a previous one
// started, so any playback recorded in state is stale at startup.
speech.stop();
void updateState((state) => ({ ...state, playback: null }));

// ---------------------------------------------------------------------------
// Page access.

async function injectReader(tabId: number): Promise<void> {
  // The bundle guards re-injection, so this only (re)defines the reader when
  // the page does not have it yet.
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

async function captureInPage(tabId: number, kind: CaptureKind): Promise<CapturedText | null> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (captureKind: CaptureKind) => globalThis.__filoReader?.capture(captureKind) ?? null,
    args: [kind],
  });
  return (result?.result as CapturedText | null | undefined) ?? null;
}

async function translateInPage(tabId: number, text: string, source: string, target: string): Promise<string | null> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (value: string, from: string, to: string) => globalThis.__filoReader?.translate(value, from, to) ?? null,
      args: [text, source, target],
    });
    return typeof result?.result === "string" && result.result.trim() ? result.result : null;
  } catch {
    return null;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// The displayed text first, Readability second (both in the page), then the
// server's stored extraction for reading-list articles.
async function captureText(tabId: number, kind: CaptureKind, articleId: number | null): Promise<CapturedText | null> {
  try {
    await injectReader(tabId);
  } catch {
    throw new Error("このページは読み上げできません。");
  }
  const captured = await captureInPage(tabId, kind);
  if (captured || kind === "selection") return captured;
  // Pages that render after `load` get one more chance.
  await delay(800);
  const retried = await captureInPage(tabId, kind);
  if (retried || articleId === null) return retried;
  return api.fetchArticleText(articleId).catch(() => null);
}

// The page's declared language is unreliable (templates, or a page the
// browser has translated), so detect it from the text that will be read.
async function detectLanguage(captured: CapturedText): Promise<string | null> {
  try {
    const result = await chrome.i18n.detectLanguage(captured.text.slice(0, 3000));
    const top = result.languages[0];
    if (result.isReliable && top && top.language !== "und") return baseLanguage(top.language);
  } catch {
    // Fall back to the page's declaration.
  }
  return baseLanguage(captured.lang);
}

// Resolves true once the tab has loaded (or after the timeout), false if the
// tab was closed meanwhile.
async function waitForTabComplete(tabId: number, timeoutMs = 30_000): Promise<boolean> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return false;
  if (tab.status === "complete" && tab.url && tab.url !== "about:blank") return true;
  return new Promise<boolean>((resolve) => {
    const finish = (open: boolean) => {
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      resolve(open);
    };
    const onUpdated = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish(true);
    };
    const onRemoved = (removedTabId: number) => {
      if (removedTabId === tabId) finish(false);
    };
    const timeoutId = setTimeout(() => finish(true), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

// ---------------------------------------------------------------------------
// Speech.

class TtsPlaybackError extends Error {
  constructor(message: string, readonly started: boolean) {
    super(message);
  }
}

class PlaybackCancelled extends Error {}

const TTS_START_TIMEOUT_MS = 15_000;
let playToken = 0;
let playbackTabId: number | null = null;
let playbackPage: { url: string; kind: CaptureKind; savedArticleId: number | null; article?: ReaderItem } | null = null;

function splitText(text: string, maxLength = 1000): string[] {
  const chunks: string[] = [];
  let rest = text.replace(/\s+/g, " ").trim();
  while (rest.length > maxLength) {
    const slice = rest.slice(0, maxLength);
    const split = Math.max(...["。", "！", "？", ".", "!", "?", " "].map((mark) => slice.lastIndexOf(mark)));
    const at = split > maxLength * 0.4 ? split + 1 : maxLength;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function voiceFor(preferred: string | null, lang: string | null): Promise<string | undefined> {
  if (!preferred) return undefined;
  const voices = await speech.getVoices();
  const selected = voices.find((voice) => voice.name === preferred);
  if (!selected) return undefined;
  if (lang && selected.lang && baseLanguage(selected.lang) !== baseLanguage(lang)) return undefined;
  return selected.name;
}

// Resolves on the utterance's `end` event. A provider that accepts the request
// but never starts or never finishes must not leave playback stuck.
function speakChunk(text: string, options: SpeakOptions, token: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let started = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(endTimeoutId);
      clearTimeout(startTimeoutId);
      if (error) reject(error);
      else resolve();
    };
    const rate = options.rate && options.rate > 0 ? options.rate : 1;
    const endTimeoutId = setTimeout(
      () => finish(new TtsPlaybackError("読み上げ音声から応答がありませんでした。", started)),
      Math.max(60_000, Math.min(300_000, 60_000 + (text.length * 120) / rate)),
    );
    const startTimeoutId = setTimeout(() => {
      void speech.isSpeaking().then((speaking) => {
        if (speaking) started = true;
        else finish(new TtsPlaybackError("音声エンジンが発話を開始しませんでした。読み上げ音声の設定やOSの音声出力を確認してください。", false));
      }, () => finish(new TtsPlaybackError("音声エンジンの状態を確認できませんでした。", false)));
    }, TTS_START_TIMEOUT_MS);

    speech.speak(text, options, (event) => {
      if (settled) return;
      if (token !== playToken) finish(new PlaybackCancelled());
      else if (event.type === "start") {
        started = true;
        clearTimeout(startTimeoutId);
      } else if (event.type === "end") {
        finish();
      } else {
        finish(new TtsPlaybackError(event.message || "読み上げ音声でエラーが発生しました。", started));
      }
    });
  });
}

interface SpeechPart {
  text: string;
  lang: string | null;
  original?: { text: string; lang: string | null };
}

// Speaks one part, degrading step by step when speech never starts: first the
// chosen voice is dropped, then a translated part falls back to its original.
// Each degradation sticks for the rest of the playback.
async function speakPart(
  part: SpeechPart,
  settings: ReaderSettings,
  fallback: { automaticVoice: boolean; originalLanguage: boolean },
  token: number,
): Promise<void> {
  const useOriginal = fallback.originalLanguage && part.original;
  const text = useOriginal ? part.original!.text : part.text;
  const lang = (useOriginal ? part.original!.lang : part.lang) ?? settings.targetLanguage;
  const attempt = async (automaticVoice: boolean, value: string, language: string) => {
    const voiceName = automaticVoice ? undefined : await voiceFor(settings.voiceName, language);
    await speakChunk(value, { lang: language, rate: settings.rate, voiceName }, token);
  };
  const neverStarted = (cause: unknown) => cause instanceof TtsPlaybackError && !cause.started && token === playToken;

  try {
    await attempt(fallback.automaticVoice, text, lang);
    return;
  } catch (cause) {
    if (!neverStarted(cause)) throw cause;
    if (!fallback.automaticVoice && settings.voiceName) {
      fallback.automaticVoice = true;
      speech.stop();
      try {
        await attempt(true, text, lang);
        return;
      } catch (automaticCause) {
        if (!neverStarted(automaticCause)) throw automaticCause;
      }
    }
    if (useOriginal || !part.original) throw cause;
  }
  fallback.originalLanguage = true;
  speech.stop();
  await attempt(fallback.automaticVoice, part.original.text, part.original.lang ?? settings.targetLanguage);
}

// Speaks the text chunk by chunk, translating the next chunk in the page
// while the current one is spoken.
async function speak(
  tabId: number,
  captured: CapturedText,
  source: string | null,
  settings: ReaderSettings,
  token: number,
  onUntranslated: () => void,
): Promise<void> {
  const target = baseLanguage(settings.targetLanguage);
  const translating = Boolean(source && target && source !== target);
  const chunks = splitText(captured.text);
  const prepare = async (chunk: string): Promise<SpeechPart> => {
    if (!translating) return { text: chunk, lang: source };
    const translated = await translateInPage(tabId, chunk, source!, target!);
    if (translated === null) {
      onUntranslated();
      return { text: chunk, lang: source };
    }
    return { text: translated, lang: target, original: { text: chunk, lang: source } };
  };
  const fallback = { automaticVoice: false, originalLanguage: false };
  let next = prepare(chunks[0]);
  for (let index = 0; index < chunks.length; index += 1) {
    const part = await next;
    if (index + 1 < chunks.length) next = prepare(chunks[index + 1]);
    if (token !== playToken) throw new PlaybackCancelled();
    await speakPart(part, settings, fallback, token);
  }
}

// MV3 stops an idle background after 30 s, and a long utterance emits no
// events until it ends. Calling an extension API keeps the worker alive meanwhile.
let keepAliveId: ReturnType<typeof setInterval> | undefined;
function keepAlive(active: boolean): void {
  if (active && keepAliveId === undefined) keepAliveId = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  if (!active && keepAliveId !== undefined) {
    clearInterval(keepAliveId);
    keepAliveId = undefined;
  }
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function setPlayback(token: number, playback: ReaderPlayback | null, error: string | null = null): Promise<unknown> {
  if (token !== playToken) return Promise.resolve();
  return updateState((state) => ({ ...state, playback, error }));
}

async function markRead(articleId: number): Promise<void> {
  await updateState((state) => state.session ? {
    ...state,
    session: {
      ...state.session,
      items: state.session.items.map((item) => item.articleId === articleId ? { ...item, isRead: true } : item),
    },
  } : state);
  await api.markRead(articleId).catch(() => undefined);
}

// Reads the page (or its selection). Finishing the reading-browser article
// marks it read; a selection or an unsaved page does not.
async function play(tabId: number, kind: CaptureKind, fallbackText?: CapturedText, knownArticle?: ReaderItem): Promise<void> {
  const token = ++playToken;
  playbackTabId = tabId;
  speech.stop();
  keepAlive(true);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (token !== playToken) return;
  if (!tab) {
    await setPlayback(token, null, "読み上げできるページがありません。");
    if (token === playToken) playbackTabId = null;
    keepAlive(false);
    return;
  }
  playbackPage = tab.url ? { url: tab.url, kind, savedArticleId: null, article: knownArticle } : null;
  let [state, settings] = await Promise.all([readState(), loadSettings()]);
  if (token !== playToken) return;
  if (state.session?.tabId === tabId && !state.session.pageUrl && tab.url && tab.status === "complete") {
    state = await registerSessionPage(tabId, tab.url);
  }
  const sessionItem = state.session?.tabId === tabId && tab.url
    ? sessionPageItem(state.session, tab.url) ?? { articleId: 0, url: tab.url, title: tab.title || tab.url, feedTitle: "", isRead: false }
    : knownArticle && tab.url && articleUrlKey(knownArticle.url) === articleUrlKey(tab.url) ? knownArticle : null;
  const articleId = kind === "page" && sessionItem && sessionItem.articleId > 0 ? sessionItem.articleId : null;
  const playback: ReaderPlayback = {
    tabId,
    title: tab.title || sessionItem?.title || tab.url || "",
    kind,
    status: "preparing",
    untranslated: false,
  };
  await setPlayback(token, playback);
  try {
    const captured = await captureText(tabId, kind, articleId).catch((cause) => {
      if (fallbackText) return fallbackText;
      throw cause;
    }) ?? fallbackText ?? null;
    if (token !== playToken) return;
    if (!captured?.text) {
      throw new Error(kind === "selection"
        ? "選択範囲がありません。読み上げる文章を選択してください。"
        : "このページから読み上げる文章を取得できませんでした。");
    }
    const source = await detectLanguage(captured);
    await setPlayback(token, { ...playback, status: "playing" });
    await speak(tabId, captured, source, settings, token, () => {
      if (playback.untranslated) return;
      playback.untranslated = true;
      void setPlayback(token, { ...playback, status: "playing" });
    });
    if (token !== playToken) return;
    await setPlayback(token, null);
    // The current page may have been saved while it was being read.
    const currentState = await readState();
    const currentItem = currentState.session?.tabId === tabId ? sessionPageItem(currentState.session, tab.url) : null;
    const completedArticleId = completedPageArticleId(kind, sessionItem, currentItem, playbackPage?.savedArticleId ?? null);
    if (completedArticleId !== null) await markRead(completedArticleId);
  } catch (cause) {
    if (token !== playToken || cause instanceof PlaybackCancelled) return;
    await setPlayback(token, null, errorText(cause));
  } finally {
    if (token === playToken) { playbackTabId = null; playbackPage = null; keepAlive(false); }
  }
}

async function stop(): Promise<void> {
  playToken += 1;
  playbackTabId = null;
  playbackPage = null;
  speech.stop();
  keepAlive(false);
  await updateState((state) => ({ ...state, playback: null }));
}

// ---------------------------------------------------------------------------
// Reading browser navigation (mirrors the iOS / Android reading session).

async function openInSession(previous: ReaderSession | null, items: ReaderItem[], index: number): Promise<void> {
  const item = items[index];
  if (!item) return;
  const { playback } = await readState();
  if (previous && playback?.tabId === previous.tabId) await stop();
  // Leaving an article moves it to read, like the apps' previous / next.
  const oldTab = previous ? await chrome.tabs.get(previous.tabId).catch(() => null) : null;
  const leaving = previous && oldTab?.url ? sessionPageItem(previous, oldTab.url) : null;
  let nextItems = items;
  if (leaving && leaving.articleId !== item.articleId && leaving.articleId > 0 && !leaving.isRead) {
    nextItems = items.map((entry) => entry.articleId === leaving.articleId ? { ...entry, isRead: true } : entry);
    void api.markRead(leaving.articleId).catch(() => undefined);
  }
  let tabId: number | undefined;
  if (previous) {
    tabId = await chrome.tabs.update(previous.tabId, { url: item.url, active: true }).then((tab) => tab?.id, () => undefined);
  }
  tabId ??= (await chrome.tabs.create({ url: item.url, active: true })).id;
  if (tabId === undefined) throw new Error("記事を開けませんでした。");
  const sessionTabId = tabId;
  await updateState((state) => ({ ...state, error: null, session: { tabId: sessionTabId, items: nextItems, index } }));
  const currentTab = await chrome.tabs.get(sessionTabId).catch(() => null);
  if (currentTab?.status === "complete" && currentTab.url) await registerSessionPage(sessionTabId, currentTab.url);
}

async function move(delta: 1 | -1): Promise<void> {
  const { session } = await readState();
  if (session) await openInSession(session, session.items, session.index + delta);
}

async function select(articleId: number): Promise<void> {
  const { session } = await readState();
  const index = session?.items.findIndex((item) => item.articleId === articleId) ?? -1;
  if (session && index >= 0) {
    await openInSession(session, session.items, index);
    return;
  }
  // Not in the current snapshot (or no session yet): continue with the latest list.
  const items = await api.listReadingList();
  const nextIndex = items.findIndex((item) => item.articleId === articleId);
  if (nextIndex < 0) throw new Error("記事を開けませんでした。");
  await openInSession(session, items, nextIndex);
}

async function savedPage(command: Extract<ReaderCommand, { type: "savedPage" }>): Promise<void> {
  const tab = await chrome.tabs.get(command.tabId).catch(() => null);
  if (tab?.url !== command.pageUrl) return;
  if (playbackTabId === command.tabId && playbackPage?.kind === "page" && pageKey(playbackPage.url) === pageKey(command.pageUrl)) {
    playbackPage.savedArticleId = command.articleId;
  }
  await updateState((state) => saveSessionPage(state, command));
}

async function registerSessionPage(tabId: number, url: string): Promise<ReaderState> {
  return updateState((state) => {
    const session = state.session;
    const item = currentSessionItem(session);
    if (!session || session.tabId !== tabId || session.pageUrl || !item) return state;
    return { ...state, session: { ...session, pageUrl: url, pageArticles: { [pageKey(url)]: item.articleId } } };
  });
}

async function startFromWeb(command: Extract<ReaderCommand, { type: "startFromWeb" }>): Promise<void> {
  if (!/^https?:\/\//i.test(command.url)) throw new Error("読み上げできるページがありません。");
  if (command.targetLanguage) await saveSettings({ targetLanguage: command.targetLanguage });
  // The extension needs the same account and complete list to navigate and
  // update read state. Never silently degrade to an unauthenticated one-item session.
  let items: ReaderItem[];
  try {
    items = await api.listReadingList();
  } catch (cause) {
    if (cause instanceof ExtensionApiError && cause.status === 401) throw new Error("拡張機能にサインインしてください。");
    throw cause;
  }
  const index = items.findIndex((item) => item.articleId === command.articleId);
  if (index < 0) throw new Error("拡張機能で同じアカウントにサインインし、記事がリーディングリストにあることを確認してください。");
  await stop();
  const tab = await chrome.tabs.create({ url: items[index].url, active: true });
  if (tab.id === undefined) throw new Error("記事を開けませんでした。");
  const tabId = tab.id;
  await updateState(() => ({ session: { tabId, items, index }, playback: null, error: null }));
  const currentTab = await chrome.tabs.get(tabId).catch(() => null);
  if (currentTab?.status === "complete" && currentTab.url) await registerSessionPage(tabId, currentTab.url);
  if (command.autoplay) {
    void waitForTabComplete(tabId).then((open) => open ? play(tabId, "page") : undefined);
  }
}

async function applySettings(patch: Partial<ReaderSettings>): Promise<void> {
  await saveSettings(patch);
  // Like the apps, a settings change while speaking restarts with the new voice.
  const { playback } = await readState();
  if (playback) {
    const current = playbackPage;
    const article = current?.savedArticleId ? {
      articleId: current.savedArticleId, url: current.url, title: playback.title, feedTitle: "", isRead: false,
    } : current?.article;
    void play(playback.tabId, playback.kind, undefined, article);
  }
}

// ---------------------------------------------------------------------------
// Events.

chrome.tabs.onRemoved.addListener((tabId) => {
  void readState().then(async (state) => {
    if (state.playback?.tabId === tabId) await stop();
    if (state.session?.tabId === tabId) await updateState((current) => ({ ...current, session: null }));
  });
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === "loading" || change.url) {
    if (playbackTabId === tabId) void stop();
  } else if (change.status === "complete" && tab.url) {
    void registerSessionPage(tabId, tab.url);
  }
});

const SELECTION_MENU_ID = "filo-read-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: SELECTION_MENU_ID,
      title: translate("選択範囲を読み上げ", uiLanguage),
      contexts: ["selection"],
    }, () => void chrome.runtime.lastError);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== SELECTION_MENU_ID || tab?.id === undefined) return;
  const fallback = info.selectionText ? { text: info.selectionText, lang: null } : undefined;
  void play(tab.id, "selection", fallback);
});

function run(command: ReaderCommand): Promise<void> {
  switch (command.type) {
    case "play":
      // Playback runs on; its progress and errors are reported through state.
      void play(command.tabId, command.kind, undefined, command.article);
      return Promise.resolve();
    case "stop":
      return stop();
    case "move":
      return move(command.delta);
    case "select":
      return select(command.articleId);
    case "savedPage":
      return savedPage(command);
    case "setSettings":
      return applySettings(command.settings);
    case "startFromWeb":
      return startFromWeb(command);
  }
}

chrome.runtime.onMessage.addListener((message: ReaderCommand, _sender, sendResponse) => {
  run(message).then(
    () => sendResponse({ ok: true }),
    (cause: unknown) => sendResponse({ ok: false, error: errorText(cause) }),
  );
  return true;
});
