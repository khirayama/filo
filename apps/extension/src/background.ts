import { createExtensionApi } from "./api";
import { refreshToken } from "./auth";

type SessionExtractionMode = "article" | "selection";

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
  playbackOwner?: string;
  playing: boolean;
}

const STATE_KEY = "filo:readerState";
const SETTINGS_KEY = "filo:readerSettings";
const DEFAULT_SETTINGS = {
  targetLanguage: "ja",
  rate: 1,
  voiceName: null as string | null,
};
let playToken = 0;
const playbackOwner = `${Date.now()}-${Math.random()}`;
const readerApi = createExtensionApi(refreshToken);

interface ExtractedPage {
  text: string;
  lang: string | null;
}

interface PreparedSpeech {
  text: string;
  lang: string | null;
}

function normalizeSelection(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSessionExtractionMode(value: unknown): SessionExtractionMode {
  return value === "selection" ? "selection" : "article";
}

async function loadState(): Promise<ReaderSession | null> {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = stored[STATE_KEY] as ReaderSession | undefined;
  return state ? {
    ...state,
    extractionMode: normalizeSessionExtractionMode(state.extractionMode),
    selectionText: typeof state.selectionText === "string" ? state.selectionText : undefined,
    selectionLang: typeof state.selectionLang === "string" ? state.selectionLang : null,
    playbackOwner: typeof state.playbackOwner === "string" ? state.playbackOwner : undefined,
  } : null;
}

async function loadVisibleState(): Promise<ReaderSession | null> {
  const state = await loadState();
  if (!state?.playing || state.playbackOwner === playbackOwner) return state;

  // MV3 may stop this worker while a persisted reader state still says
  // `playing`. The old worker's TTS callbacks cannot update storage afterward,
  // so reconcile the UI with Chrome's actual speech status when it is reopened.
  let speaking: boolean;
  try {
    speaking = await chrome.tts.isSpeaking();
  } catch {
    return state;
  }
  if (!speaking) {
    state.playing = false;
    state.playbackOwner = undefined;
    await saveState(state);
    console.info("[Filo Reader] 古い再生状態をクリアしました");
  }
  return state;
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
  };
}

async function saveSettings(settings: Partial<typeof DEFAULT_SETTINGS>): Promise<typeof DEFAULT_SETTINGS> {
  const next = await loadSettings();
  if (settings.targetLanguage !== undefined) next.targetLanguage = settings.targetLanguage;
  if (settings.rate !== undefined) next.rate = Math.min(3, Math.max(0.75, settings.rate));
  if (settings.voiceName !== undefined) next.voiceName = settings.voiceName;
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

async function saveState(state: ReaderSession): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

function logPageConsole(
  tabId: number,
  level: "info" | "warn" | "error",
  message: string,
  details?: unknown,
): void {
  void chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (logLevel, logMessage, logDetails) => {
      const output = logLevel === "error" ? console.error : logLevel === "warn" ? console.warn : console.info;
      const label = `[Filo Reader] ${logMessage}`;
      if (logDetails == null) output(label);
      else output(label, logDetails);
    },
    args: [level, message, details ?? null],
  }).catch(() => undefined);
}

async function extractPage(tabId: number): Promise<ExtractedPage | null> {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "filoExtract" }) as ExtractedPage | null;
  } catch {
    // A manifest content script is not added retroactively to tabs that were
    // already open when an unpacked extension was installed or reloaded.
    console.info("[Filo Reader] 現在のタブに本文抽出スクリプトを読み込みます");
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    logPageConsole(tabId, "info", "本文抽出スクリプトを読み込みました");
    return await chrome.tabs.sendMessage(tabId, { type: "filoExtract" }) as ExtractedPage | null;
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
    const split = Math.max(
      slice.lastIndexOf("。"),
      slice.lastIndexOf("！"),
      slice.lastIndexOf("？"),
      slice.lastIndexOf("."),
      slice.lastIndexOf("!"),
      slice.lastIndexOf("?"),
      slice.lastIndexOf(" "),
    );
    const at = split > maxLength * 0.4 ? split + 1 : maxLength;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function* prepareSpeechChunks(
  text: string,
  source: string | null,
  target: string,
): AsyncGenerator<PreparedSpeech> {
  const chunks = splitText(text, 2000);
  const sourceLanguage = source?.split("-")[0] ?? null;
  const targetLanguage = target.split("-")[0];
  if (!sourceLanguage || sourceLanguage === targetLanguage) {
    for (const chunk of chunks) yield { text: chunk, lang: source || target || null };
    return;
  }

  const api = (globalThis as unknown as {
    Translator?: { create(pair: { sourceLanguage: string; targetLanguage: string }): Promise<{ translate(value: string): Promise<string> }> };
  }).Translator;
  if (!api) {
    for (const chunk of chunks) yield { text: chunk, lang: source };
    return;
  }

  const translatorStartedAt = Date.now();
  let translator: { translate(value: string): Promise<string> };
  try {
    translator = await api.create({ sourceLanguage, targetLanguage });
    console.info("[Filo Reader] 翻訳の準備ができました", { durationMs: Date.now() - translatorStartedAt });
  } catch (cause) {
    console.warn("[Filo Reader] 翻訳を使えないため原文を読み上げます", cause);
    for (const chunk of chunks) yield { text: chunk, lang: source };
    return;
  }

  for (const chunk of chunks) {
    try {
      yield { text: await translator.translate(chunk), lang: target };
    } catch (cause) {
      console.warn("[Filo Reader] 一部の翻訳に失敗したため原文を読み上げます", cause);
      // Keep playback moving with the original text if a specific chunk fails.
      yield { text: chunk, lang: source };
    }
  }
}

function getVoices(): Promise<chrome.tts.TtsVoice[]> {
  return new Promise((resolve) => chrome.tts.getVoices(resolve));
}

async function resolveVoiceName(preferred: string | null, lang: string | null): Promise<string | undefined> {
  if (!preferred) return undefined;
  const voices = await getVoices();
  const selected = voices.find((voice) => voice.voiceName === preferred);
  if (!selected) return undefined;
  if (lang && selected.lang && selected.lang.split("-")[0] !== lang.split("-")[0]) return undefined;
  return selected.voiceName;
}

function ttsErrorMessage(event: chrome.tts.TtsEvent): string {
  if (event.type === "error" && event.errorMessage) return event.errorMessage;
  if (event.type === "cancelled") return "発話がキャンセルされました。";
  if (event.type === "interrupted") return "発話が中断されました。";
  return "読み上げ音声でエラーが発生しました。";
}

const REQUIRED_TTS_EVENTS = ["start", "end", "error"];
const TTS_START_TIMEOUT_MS = 15_000;

class TtsPlaybackError extends Error {
  constructor(message: string, readonly started: boolean) {
    super(message);
    this.name = "TtsPlaybackError";
  }
}

function logSpeechProblem(
  tabId: number,
  options: chrome.tts.TtsOptions,
  message: string,
  details: Record<string, string | number | boolean | null>,
  started: boolean,
): void {
  if (options.voiceName && !started) {
    const fallbackMessage = `選択した音声が開始しないため、自動音声で再試行します (${options.voiceName})`;
    console.warn(`[Filo Reader] ${fallbackMessage}`, details);
    logPageConsole(tabId, "warn", fallbackMessage, details);
    return;
  }
  console.error(`[Filo Reader] ${message}`, details);
  logPageConsole(tabId, "error", message, details);
}

function speakChunk(
  text: string,
  options: chrome.tts.TtsOptions,
  token: number,
  tabId: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let started = false;
    const requestedAt = Date.now();
    // A provider that accepts the request but never emits a terminal event
    // must not leave the extension stuck in the playing state forever.
    const rate = typeof options.rate === "number" && options.rate > 0 ? options.rate : 1;
    const timeoutMs = Math.max(60_000, Math.min(300_000, 60_000 + (text.length * 120) / rate));
    const timeoutId = setTimeout(() => {
      logSpeechProblem(tabId, options, "音声エンジンから応答がありません", { textLength: text.length, started, timeoutMs }, started);
      finish(new TtsPlaybackError("読み上げ音声から応答がありませんでした。", started));
    }, timeoutMs);
    const startTimeoutId = setTimeout(() => {
      const details = {
        textLength: text.length,
        lang: options.lang ?? null,
        voiceName: options.voiceName ?? "auto",
        timeoutMs: TTS_START_TIMEOUT_MS,
      };
      logSpeechProblem(tabId, options, "音声エンジンが発話を開始しません", details, false);
      finish(new TtsPlaybackError("音声エンジンが発話を開始しませんでした。読み上げ音声の設定やOSの音声出力を確認してください。", false));
    }, TTS_START_TIMEOUT_MS);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      clearTimeout(startTimeoutId);
      if (error) reject(error);
      else resolve();
    };

    chrome.tts.speak(text, {
      ...options,
      requiredEventTypes: REQUIRED_TTS_EVENTS,
      onEvent: (event) => {
        // A provider may report `interrupted` after the start timeout already
        // settled this request and automatic-voice fallback has begun.
        if (settled) return;
        if (token !== playToken) {
          finish(new TtsPlaybackError("読み上げが中断されました。", started));
          return;
        }
        if (event.type === "start") {
          started = true;
          clearTimeout(startTimeoutId);
          console.info("[Filo Reader] 発話を開始しました", {
            waitMs: Date.now() - requestedAt,
            lang: options.lang ?? null,
            voiceName: options.voiceName ?? "auto",
          });
          logPageConsole(tabId, "info", "発話を開始しました", {
            waitMs: Date.now() - requestedAt,
            lang: options.lang ?? null,
          });
        } else if (event.type === "end") {
          console.info("[Filo Reader] 発話が終わりました");
          logPageConsole(tabId, "info", "発話が終わりました");
          finish();
        }
        else if (event.type === "error" || event.type === "cancelled" || event.type === "interrupted") {
          logSpeechProblem(tabId, options, "発話に失敗しました", { event: event.type, message: event.errorMessage ?? null, started }, started);
          finish(new TtsPlaybackError(ttsErrorMessage(event), started));
        }
      },
    }, () => {
      const message = chrome.runtime.lastError?.message;
      if (message) {
        logSpeechProblem(tabId, options, "音声の要求に失敗しました", { message, started }, started);
        finish(new TtsPlaybackError(message, started));
      } else {
        console.info("[Filo Reader] 音声の要求を受け付けました", { textLength: text.length });
        logPageConsole(tabId, "info", "音声の要求を受け付けました", { textLength: text.length });
      }
      // A successful callback only means that the request was accepted. The
      // promise intentionally remains pending until the terminal TTS event.
    });
  });
}

async function speakText(text: string, state: ReaderSession, lang: string | null, token: number, tabId: number): Promise<void> {
  const speechLanguage = lang || state.targetLanguage || undefined;
  let voiceName = await resolveVoiceName(state.voiceName, speechLanguage || null);
  const chunks = splitText(text, 2400);
  let index = 0;
  while (index < chunks.length) {
    if (token !== playToken) throw new Error("読み上げが中断されました。");
    try {
      await speakChunk(chunks[index], {
        lang: speechLanguage,
        rate: state.rate,
        voiceName,
        enqueue: index > 0,
      }, token, tabId);
      index += 1;
    } catch (cause) {
      // A voice can remain listed while its OS/provider backend is broken.
      // If this chunk never started, retry only this chunk without that voice.
      if (voiceName && token === playToken
        && cause instanceof TtsPlaybackError && !cause.started) {
        voiceName = undefined;
        chrome.tts.stop();
        continue;
      }
      throw cause;
    }
  }
}

async function speakPreparedChunks(
  chunks: AsyncGenerator<PreparedSpeech>,
  state: ReaderSession,
  token: number,
  tabId: number,
): Promise<void> {
  let next = chunks.next();
  let index = 0;
  let useAutomaticVoice = false;
  while (true) {
    const current = await next;
    if (current.done) return;
    // Ask for translation of the next piece while Chrome is speaking this one.
    next = chunks.next();
    if (token !== playToken) throw new Error("読み上げが中断されました。");
    const speechLanguage = current.value.lang || state.targetLanguage || undefined;
    const voiceName = useAutomaticVoice
      ? undefined
      : await resolveVoiceName(state.voiceName, speechLanguage || null);
    try {
      await speakChunk(current.value.text, {
        lang: speechLanguage,
        rate: state.rate,
        voiceName,
        enqueue: index > 0,
      }, token, tabId);
    } catch (cause) {
      if (voiceName && token === playToken
        && cause instanceof TtsPlaybackError && !cause.started) {
        useAutomaticVoice = true;
        chrome.tts.stop();
        await speakChunk(current.value.text, {
          lang: speechLanguage,
          rate: state.rate,
          voiceName: undefined,
          enqueue: false,
        }, token, tabId);
      } else {
        throw cause;
      }
    }
    index += 1;
  }
}

async function startSelection(tabId: number, selectionText: string, selectionLang: string | null = null): Promise<void> {
  const text = normalizeSelection(selectionText);
  if (!text) throw new Error("選択範囲がありません。読み上げる文章を選択してください。");

  const settings = await loadSettings();
  await saveState({
    tabId,
    autoplay: false,
    targetLanguage: settings.targetLanguage,
    rate: settings.rate,
    voiceName: settings.voiceName,
    extractionMode: "selection",
    selectionText: text,
    selectionLang,
    playing: false,
  });
  logPageConsole(tabId, "info", "選択範囲の読み上げ操作を受信しました", { textLength: text.length });
  await playCurrent();
}

async function playCurrentImpl(): Promise<void> {
  const token = ++playToken;
  const pipelineStartedAt = Date.now();
  console.info("[Filo Reader] 読み上げを開始します");
  const state = await loadState();
  if (!state) return;
  logPageConsole(state.tabId, "info", "読み上げ処理を開始します");

  let text: string;
  let lang: string | null = null;
  let speechChunks: AsyncGenerator<PreparedSpeech> | null = null;
  const extractionStartedAt = Date.now();
  if (state.extractionMode === "selection") {
    text = normalizeSelection(state.selectionText ?? "");
    lang = state.selectionLang ?? null;
    logPageConsole(state.tabId, "info", "選択範囲を読み上げます", { textLength: text.length, lang });
  } else {
    console.info("[Filo Reader] 本文を抽出します");
    logPageConsole(state.tabId, "info", "本文を抽出中です");
    let extracted: ExtractedPage | null;
    try {
      extracted = await extractPage(state.tabId);
    } catch (cause) {
      console.error("[Filo Reader] ページから本文を取得できません", cause);
      logPageConsole(state.tabId, "error", "ページから本文を取得できません", cause instanceof Error ? cause.message : String(cause));
      throw new Error("ページ本文を読み込めませんでした。ページを再読み込みしてからもう一度お試しください。");
    }
    if (!extracted?.text) {
      console.warn("[Filo Reader] 本文が見つかりません");
      logPageConsole(state.tabId, "warn", "本文が見つかりませんでした");
      throw new Error("このページから読み上げる文章を取得できませんでした。");
    }
    console.info("[Filo Reader] 本文を抽出しました", {
      durationMs: Date.now() - extractionStartedAt,
      textLength: extracted.text.length,
      lang: extracted.lang,
    });
    logPageConsole(state.tabId, "info", "本文を抽出しました", {
      durationMs: Date.now() - extractionStartedAt,
      textLength: extracted.text.length,
      lang: extracted.lang,
    });

    text = extracted.text;
    speechChunks = prepareSpeechChunks(extracted.text, extracted.lang, state.targetLanguage);
    lang = extracted.lang;
  }
  if (token !== playToken) return;
  if (!text) throw new Error("このページから読み上げる文章を取得できませんでした。");
  console.info("[Filo Reader] 音声を再生します", { textLength: text.length, lang });
  logPageConsole(state.tabId, "info", "読み上げを開始します", { textLength: text.length, lang });
  state.autoplay = false;
  state.playing = true;
  state.playbackOwner = playbackOwner;
  await saveState(state);
  chrome.tts.stop();
  try {
    if (speechChunks) await speakPreparedChunks(speechChunks, state, token, state.tabId);
    else await speakText(text, state, lang, token, state.tabId);
    if (token !== playToken) return;
    const latest = await loadState();
    if (!latest || token !== playToken) return;
    latest.playing = false;
    latest.playbackOwner = undefined;
    await saveState(latest);
    if (latest.articleId !== undefined) {
      await readerApi.setArticleRead(latest.articleId, true).catch(() => undefined);
    }
    console.info("[Filo Reader] 読み上げが完了しました", { durationMs: Date.now() - pipelineStartedAt });
    logPageConsole(state.tabId, "info", "読み上げが完了しました", { durationMs: Date.now() - pipelineStartedAt });
  } catch (cause) {
    if (token !== playToken) return;
    state.playing = false;
    state.playbackOwner = undefined;
    await saveState(state);
    const detail = cause instanceof Error ? cause.message : String(cause);
    console.error("[Filo Reader] 読み上げに失敗しました", { message: detail, textLength: text.length, lang });
    logPageConsole(state.tabId, "error", "読み上げに失敗しました", { message: detail, textLength: text.length, lang });
    throw new Error(`音声の再生に失敗しました。${detail}`);
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
  void chrome.storage.local.remove("filo:readerDiagnostics").catch(() => undefined);
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "filoGetSettings") {
    void loadSettings().then((settings) => sendResponse({ ok: true, data: settings }));
    return true;
  }

  if (message?.type === "filoGetState") {
    void loadVisibleState().then((state) => sendResponse({ ok: true, data: state }));
    return true;
  }

  if (message?.type === "filoSetSettings") {
    void saveSettings({
      targetLanguage: typeof message.targetLanguage === "string" ? message.targetLanguage : undefined,
      rate: typeof message.rate === "number" ? Math.min(3, Math.max(0.75, message.rate)) : undefined,
      voiceName: typeof message.voiceName === "string" || message.voiceName === null ? message.voiceName : undefined,
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
    console.info("[Filo Reader] 現在のページの読み上げ要求を受信しました");
    void (async () => {
      const page = message.page as { tabId?: number; url?: string } | undefined;
      if (!page || typeof page.tabId !== "number" || !/^https?:\/\//i.test(String(page.url ?? ""))) {
        throw new Error("読み上げできるページがありません。");
      }
      logPageConsole(page.tabId, "info", "読み上げボタンをクリックしました");
      const settings = await loadSettings();
      const state: ReaderSession = {
        tabId: page.tabId,
        autoplay: true,
        targetLanguage: String(message.targetLanguage || settings.targetLanguage),
        rate: settings.rate,
        voiceName: settings.voiceName,
        extractionMode: "article",
        playing: false,
      };
      await saveSettings({
        targetLanguage: state.targetLanguage,
        rate: state.rate,
        voiceName: state.voiceName,
      });
      await saveState(state);
      await playCurrent();
      sendResponse({ ok: true, data: await loadSettings() });
    })().catch((error: unknown) => {
      console.error("[Filo Reader] 現在のページの読み上げ開始に失敗しました", error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return true;
  }

  if (message?.type === "filoStartArticleFromWeb") {
    console.info("[Filo Reader] Webアプリから記事の読み上げ要求を受信しました");
    void (async () => {
      const url = typeof message.url === "string" ? message.url : "";
      if (!/^https?:\/\//i.test(url)) throw new Error("読み上げできるページがありません。");
      const tab = await chrome.tabs.create({ url, active: true });
      if (typeof tab.id !== "number") throw new Error("読み上げできるページがありません。");

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
        rate: settings.rate,
        voiceName: settings.voiceName,
        extractionMode: "article",
        playing: false,
      };
      await saveSettings({
        targetLanguage: state.targetLanguage,
        rate: state.rate,
        voiceName: state.voiceName,
      });
      await saveState(state);
      // Start only after the session is stored. The content script's one-shot
      // page-ready message can arrive before this point on fast-loading tabs.
      if (state.autoplay) void playCurrent().catch((error: unknown) => {
        console.error("[Filo Reader] Web記事の読み上げ開始に失敗しました", error);
      });
      sendResponse({ ok: true, data: { tabId: tab.id } });
    })().catch((error: unknown) => {
      console.error("[Filo Reader] Web記事を開けませんでした", error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return true;
  }

  if (message?.type === "filoStartSelection") {
    console.info("[Filo Reader] 選択範囲の読み上げ要求を受信しました");
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
    })().catch((error: unknown) => {
      console.error("[Filo Reader] 選択範囲の読み上げ開始に失敗しました", error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return true;
  }

  if (message?.type === "filoControl") {
    console.info("[Filo Reader] 再生操作を受信しました", { action: message.action });
    void (async () => {
      const state = await loadState();
      if (!state) throw new Error("再生中のセッションがありません。");
      if (message.action === "play") await playCurrent();
      if (message.action === "pause") {
        logPageConsole(state.tabId, "info", "読み上げ停止ボタンをクリックしました");
        playToken += 1;
        chrome.tts.stop();
        state.autoplay = false;
        state.playing = false;
        state.playbackOwner = undefined;
        await saveState(state);
      }
      if (message.action === "settings") {
        if (typeof message.rate === "number") state.rate = Math.min(3, Math.max(0.75, message.rate));
        if (typeof message.voiceName === "string" || message.voiceName === null) state.voiceName = message.voiceName;
        if (typeof message.targetLanguage === "string") state.targetLanguage = message.targetLanguage;
        await saveSettings({
          targetLanguage: state.targetLanguage,
          rate: state.rate,
          voiceName: state.voiceName,
        });
        if (state.playing) {
          playToken += 1;
          state.playing = false;
          state.playbackOwner = undefined;
          await saveState(state);
          chrome.tts.stop();
          await playCurrent();
        } else {
          await saveState(state);
        }
      }
      sendResponse({ ok: true, data: await loadSettings() });
    })().catch((error: unknown) => {
      console.error("[Filo Reader] 再生操作に失敗しました", { action: message.action, error });
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
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
