// The speech engine behind the reader. Chrome (and other Chromium browsers)
// provide chrome.tts, which is the first-party path. Firefox and Safari have no
// tts API, so they speak through the Web Speech API instead; it needs a window
// context, which their background page (not a service worker) provides.

export interface Voice {
  name: string;
  lang: string | null;
}

export interface SpeakOptions {
  lang: string;
  rate: number;
  voiceName?: string;
}

// `error` also covers an utterance that was cancelled or interrupted.
export type SpeechEvent = { type: "start" } | { type: "end" } | { type: "error"; message?: string };

export interface SpeechEngine {
  getVoices(): Promise<Voice[]>;
  speak(text: string, options: SpeakOptions, onEvent: (event: SpeechEvent) => void): void;
  stop(): void;
  isSpeaking(): Promise<boolean>;
}

const chromeTtsEngine: SpeechEngine = {
  async getVoices() {
    const voices = await chrome.tts.getVoices();
    return voices.flatMap((voice) => voice.voiceName ? [{ name: voice.voiceName, lang: voice.lang ?? null }] : []);
  },
  speak(text, options, onEvent) {
    chrome.tts.speak(text, {
      ...options,
      onEvent: (event) => {
        if (event.type === "start" || event.type === "end") onEvent({ type: event.type });
        else if (event.type === "error" || event.type === "cancelled" || event.type === "interrupted") {
          onEvent({ type: "error", message: event.errorMessage });
        }
      },
    }, () => {
      const message = chrome.runtime.lastError?.message;
      if (message) onEvent({ type: "error", message });
    });
  },
  stop() {
    chrome.tts.stop();
  },
  isSpeaking() {
    return chrome.tts.isSpeaking();
  },
};

// Voices load asynchronously; the first call may see an empty list.
function webSpeechVoices(): Promise<SpeechSynthesisVoice[]> {
  const voices = speechSynthesis.getVoices();
  if (voices.length > 0) return Promise.resolve(voices);
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeoutId);
      speechSynthesis.removeEventListener("voiceschanged", finish);
      resolve(speechSynthesis.getVoices());
    };
    const timeoutId = setTimeout(finish, 1000);
    speechSynthesis.addEventListener("voiceschanged", finish);
  });
}

// Engines drop events of an utterance that has been garbage collected, so keep
// each one referenced until it finishes.
const pendingUtterances = new Set<SpeechSynthesisUtterance>();
// Voices resolve asynchronously, so a stop() can land before the utterance is
// queued; the generation keeps such an utterance from starting afterwards.
let webSpeechGeneration = 0;

const webSpeechEngine: SpeechEngine = {
  async getVoices() {
    return (await webSpeechVoices()).map((voice) => ({ name: voice.name, lang: voice.lang || null }));
  },
  speak(text, options, onEvent) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options.lang;
    utterance.rate = options.rate;
    const release = () => pendingUtterances.delete(utterance);
    utterance.onstart = () => onEvent({ type: "start" });
    utterance.onend = () => {
      release();
      onEvent({ type: "end" });
    };
    utterance.onerror = (event) => {
      release();
      onEvent({ type: "error", message: event.error });
    };
    pendingUtterances.add(utterance);
    const generation = webSpeechGeneration;
    void webSpeechVoices().then((voices) => {
      if (generation !== webSpeechGeneration) {
        release();
        onEvent({ type: "error", message: "interrupted" });
        return;
      }
      utterance.voice = voices.find((voice) => voice.name === options.voiceName) ?? null;
      speechSynthesis.speak(utterance);
    });
  },
  stop() {
    webSpeechGeneration += 1;
    speechSynthesis.cancel();
  },
  async isSpeaking() {
    return speechSynthesis.speaking;
  },
};

export const speech: SpeechEngine = typeof chrome.tts?.speak === "function" ? chromeTtsEngine : webSpeechEngine;
