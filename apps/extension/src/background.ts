import type {
  TtsControlMessage,
  TtsFinishedMessage,
  TtsGetStateMessage,
  OffscreenReadyMessage,
  TtsProgressMessage,
  TtsSource,
  QueuePlayMessage,
} from "./ttsMessages";
import type { TtsProgress, TtsSettings } from "./tts";
import { loadLocalQueue, normalizeUrlForCompare, removeFromLocalQueue } from "./queueStorage";
import {
  notifyPlaybackFinished,
  notifyPlaybackProgress,
  notifyPlaybackStarted,
  notifyPlaybackStopped,
} from "./serverSync";

const OFFSCREEN_URL = "offscreen.html";
const IDLE_PROGRESS: TtsProgress = { state: "idle", chunkIndex: 0, totalChunks: 0, fraction: 0 };
// Queue playback state lives in session storage so it survives service worker restarts
// while the offscreen document keeps playing.
const PLAYBACK_STATE_KEY = "filo:queuePlayback";

interface QueuePlaybackState {
  settings: TtsSettings;
  currentUrl: string | null;
  currentArticleId: number | null;
}

// 再生位置のサーバー保存はおよそ10秒間隔に間引く(SPEC/API.md playback-queue/state)
const PROGRESS_SYNC_MS = 10_000;
let lastProgressSyncAt = 0;

let creatingOffscreen: Promise<void> | null = null;
let offscreenReady = false;
let offscreenReadyResolver: (() => void) | null = null;
let currentProgress: TtsProgress = IDLE_PROGRESS;
let currentSource: TtsSource | null = null;

async function getPlaybackState(): Promise<QueuePlaybackState | null> {
  const stored = await chrome.storage.session.get(PLAYBACK_STATE_KEY);
  return (stored[PLAYBACK_STATE_KEY] as QueuePlaybackState | undefined) ?? null;
}

async function setPlaybackState(state: QueuePlaybackState | null): Promise<void> {
  if (state) {
    await chrome.storage.session.set({ [PLAYBACK_STATE_KEY]: state });
  } else {
    await chrome.storage.session.remove(PLAYBACK_STATE_KEY);
  }
}

async function hasOffscreenDocument(): Promise<boolean> {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  if (!creatingOffscreen) {
    offscreenReady = false;
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Read queued articles aloud after their tabs are closed.",
    }).finally(() => {
      creatingOffscreen = null;
    });
  }
  await creatingOffscreen;
  if (offscreenReady) return;
  await new Promise<void>((resolve) => {
    offscreenReadyResolver = resolve;
    setTimeout(resolve, 1000);
  });
}

async function closeOffscreenDocument(): Promise<void> {
  if (creatingOffscreen) await creatingOffscreen;
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
  }
  offscreenReady = false;
  offscreenReadyResolver = null;
}

async function sendToOffscreen<T>(message: TtsControlMessage): Promise<T | null> {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ ...message, target: "offscreen" }) as Promise<T>;
}

function publishProgress(progress: TtsProgress, source: TtsSource | null): void {
  currentProgress = progress;
  currentSource = source;
  chrome.runtime.sendMessage({ type: "ttsProgress", ...progress, source }).catch(() => {});
}

async function playNextQueueItem(startUrl?: string | null): Promise<boolean> {
  const state = await getPlaybackState();
  if (!state) return false;
  const items = await loadLocalQueue();
  if (items.length === 0) return false;
  // Auto-play starts from the just-added current page; otherwise the queue
  // plays from the top.
  const normalizedStart = normalizeUrlForCompare(startUrl ?? null);
  const item = (normalizedStart
    ? items.find((candidate) => normalizeUrlForCompare(candidate.url) === normalizedStart)
    : undefined) ?? items[0];
  const articleId = item.articleId ?? null;
  await setPlaybackState({ ...state, currentUrl: item.url, currentArticleId: articleId });
  const source: TtsSource = { title: item.title, url: item.url };
  currentSource = source;
  await sendToOffscreen({
    type: "ttsPlay",
    chunks: item.chunks,
    lang: item.lang,
    settings: state.settings,
    source,
  });
  if (articleId != null) {
    lastProgressSyncAt = Date.now();
    notifyPlaybackStarted(articleId).catch(() => {});
  }
  return true;
}

async function stopPlayback(): Promise<void> {
  const state = await getPlaybackState();
  if (state?.currentArticleId != null) {
    notifyPlaybackStopped(currentProgress.fraction).catch(() => {});
  }
  await setPlaybackState(null);
  if (await hasOffscreenDocument()) {
    await sendToOffscreen({ type: "ttsStop" }).catch(() => {});
  }
  await closeOffscreenDocument();
  publishProgress(IDLE_PROGRESS, null);
}

chrome.runtime.onMessage.addListener((message: (TtsControlMessage | TtsFinishedMessage | TtsProgressMessage | OffscreenReadyMessage | QueuePlayMessage) & { target?: string }, sender, sendResponse) => {
  if (message.target === "offscreen") return false;

  if (sender.url === chrome.runtime.getURL(OFFSCREEN_URL)) {
    if (message.type === "offscreenReady") {
      offscreenReady = true;
      offscreenReadyResolver?.();
      offscreenReadyResolver = null;
      return false;
    }
    if (message.type === "ttsProgress") {
      currentProgress = {
        state: message.state,
        chunkIndex: message.chunkIndex,
        totalChunks: message.totalChunks,
        fraction: message.fraction,
      };
      if (message.source) currentSource = message.source;
      if (message.state === "playing" && Date.now() - lastProgressSyncAt >= PROGRESS_SYNC_MS) {
        lastProgressSyncAt = Date.now();
        (async () => {
          const state = await getPlaybackState();
          if (state?.currentArticleId != null) await notifyPlaybackProgress(message.fraction);
        })().catch(() => {});
      }
    }
    if (message.type === "ttsFinished") {
      (async () => {
        const state = await getPlaybackState();
        if (state) {
          if (state.currentUrl) await removeFromLocalQueue(state.currentUrl);
          if (state.currentArticleId != null) {
            await notifyPlaybackFinished(state.currentArticleId).catch(() => {});
          }
          if (await playNextQueueItem()) return;
          await setPlaybackState(null);
        }
        publishProgress(IDLE_PROGRESS, null);
        await closeOffscreenDocument();
      })().catch(() => {});
    }
    return false;
  }

  if (message.type === "queuePlay") {
    (async () => {
      await setPlaybackState({ settings: message.settings, currentUrl: null, currentArticleId: null });
      const ok = await playNextQueueItem(message.startUrl);
      if (!ok) await setPlaybackState(null);
      sendResponse({ ok });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "ttsStop") {
    stopPlayback()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "ttsUpdateSettings") {
    (async () => {
      const state = await getPlaybackState();
      if (state) await setPlaybackState({ ...state, settings: message.settings });
      if (await hasOffscreenDocument()) {
        await sendToOffscreen(message);
      }
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "ttsGetState") {
    hasOffscreenDocument()
      .then((exists) => exists ? sendToOffscreen(message as TtsGetStateMessage) : null)
      .then((response) => sendResponse(response ?? { ...currentProgress, source: currentSource }))
      .catch(() => sendResponse(null));
    return true;
  }

  return false;
});
