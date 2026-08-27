interface ReaderSession {
  tabId: number;
  autoplay: boolean;
  targetLanguage: string;
  rate: number;
  voiceName: string | null;
  playing: boolean;
}

const STATE_KEY = "filo:readerState";
const SETTINGS_KEY = "filo:readerSettings";
const DEFAULT_SETTINGS = { targetLanguage: "ja", rate: 1, voiceName: null as string | null };
let playToken = 0;

async function loadState(): Promise<ReaderSession | null> {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return (stored[STATE_KEY] as ReaderSession | undefined) ?? null;
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

async function playCurrentImpl(): Promise<void> {
  const token = ++playToken;
  const state = await loadState();
  if (!state) return;

  const extracted = await chrome.tabs.sendMessage(state.tabId, { type: "filoExtract" }).catch(() => null) as
    | { text: string; lang: string | null }
    | null;
  if (token !== playToken || !extracted?.text) return;

  const text = await translateBestEffort(extracted.text, extracted.lang, state.targetLanguage);
  if (token !== playToken) return;
  state.autoplay = false;
  state.playing = true;
  await saveState(state);
  chrome.tts.stop();
  chrome.tts.speak(text, {
    lang: state.targetLanguage || extracted.lang || undefined,
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
      });
    },
  });
}

function playCurrent(): Promise<void> {
  // Every start invalidates the previous extraction/translation through
  // playToken. Coalescing promises here can otherwise make a newly selected
  // page wait for, and then accidentally keep, the previous page's playback.
  return playCurrentImpl();
}

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
    }).then((settings) => sendResponse({ ok: true, data: settings }));
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
        playing: false,
      };
      await saveSettings({ targetLanguage: state.targetLanguage, rate: state.rate, voiceName: state.voiceName });
      await saveState(state);
      await playCurrent();
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
        await saveSettings({ targetLanguage: state.targetLanguage, rate: state.rate, voiceName: state.voiceName });
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
