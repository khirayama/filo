import {
  getProgress,
  speakChunks,
  stopSpeaking,
  type TtsProgress,
  type TtsSettings,
  updateSettings,
} from "./tts";
import type { TtsControlMessage, TtsProgressMessage, TtsSource } from "./ttsMessages";

let playSequence = 0;
let currentSource: TtsSource | null = null;

chrome.runtime.sendMessage({ type: "offscreenReady" }).catch(() => {});

function notifyProgress(progress: TtsProgress): void {
  chrome.runtime.sendMessage({ type: "ttsProgress", ...progress, source: currentSource } satisfies TtsProgressMessage).catch(() => {});
}

chrome.runtime.onMessage.addListener((message: TtsControlMessage & { target?: string }, _sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  if (message.type === "ttsPlay") {
    const sequence = ++playSequence;
    currentSource = message.source;
    speakChunks(message.chunks, message.lang, message.settings as TtsSettings, notifyProgress)
      .finally(() => {
        if (sequence === playSequence) {
          currentSource = null;
          chrome.runtime.sendMessage({ type: "ttsFinished" }).catch(() => {});
        }
      });
    sendResponse({ ok: true });
  } else if (message.type === "ttsStop") {
    playSequence++;
    stopSpeaking();
    currentSource = null;
    sendResponse({ ok: true });
  } else if (message.type === "ttsUpdateSettings") {
    updateSettings(message.settings as TtsSettings);
    sendResponse({ ok: true });
  } else if (message.type === "ttsGetState") {
    sendResponse({ ...getProgress(), source: currentSource });
  }
  return true;
});
