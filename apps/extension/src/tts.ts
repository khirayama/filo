export type TtsState = "idle" | "playing";

export interface TtsProgress {
  state: TtsState;
  chunkIndex: number;
  totalChunks: number;
  fraction: number;
}

export interface TtsSettings {
  rate: number;
  pitch: number;
  voiceURI: string | null;
}

let currentState: TtsState = "idle";
let chunks: string[] = [];
let chunkIndex = 0;
let settings: TtsSettings = { rate: 1.5, pitch: 1.0, voiceURI: null };
let progressCb: ((p: TtsProgress) => void) | null = null;
let cancelRequested = false;
let restartChunk = false;
// Bumped on every play/stop so a superseded speakChunks loop can tell it is
// stale and exit without touching shared state.
let generation = 0;

function makeProgress(): TtsProgress {
  return {
    state: currentState,
    chunkIndex,
    totalChunks: chunks.length,
    fraction: chunks.length > 0 ? chunkIndex / chunks.length : 0,
  };
}

function notify(): void {
  progressCb?.(makeProgress());
}

export function getProgress(): TtsProgress {
  return makeProgress();
}

export function updateSettings(s: TtsSettings): void {
  settings = s;
  if (currentState !== "playing") return;
  restartChunk = true;
  speechSynthesis.cancel();
}

function ensureVoicesReady(): Promise<void> {
  return new Promise((resolve) => {
    if (speechSynthesis.getVoices().length > 0) {
      resolve();
      return;
    }
    const onReady = () => resolve();
    speechSynthesis.addEventListener("voiceschanged", onReady, { once: true });
    setTimeout(onReady, 2000);
  });
}

async function speakOneChunk(text: string, lang: string | null, isStale: () => boolean): Promise<void> {
  speechSynthesis.cancel();
  await new Promise((r) => setTimeout(r, 100));
  if (isStale()) return;

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    if (settings.voiceURI) {
      const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === settings.voiceURI);
      if (voice) utterance.voice = voice;
    }
    if (lang) utterance.lang = lang === "ja" ? "ja-JP" : lang;
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;

    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();

    speechSynthesis.speak(utterance);
  });
}

export async function speakChunks(
  inputChunks: string[],
  lang: string | null,
  s: TtsSettings,
  onProgress?: (p: TtsProgress) => void,
): Promise<void> {
  const gen = ++generation;
  cancelRequested = true;
  speechSynthesis.cancel();

  if (inputChunks.length === 0) return;

  await ensureVoicesReady();
  if (gen !== generation) return;

  chunks = inputChunks;
  settings = s;
  chunkIndex = 0;
  cancelRequested = false;
  currentState = "playing";
  progressCb = onProgress ?? null;
  notify();

  const isStale = () => gen !== generation || cancelRequested;

  while (chunkIndex < chunks.length && !isStale()) {
    restartChunk = false;
    await speakOneChunk(chunks[chunkIndex], lang, isStale);
    if (gen !== generation) return;
    if (restartChunk) continue;
    if (!cancelRequested) {
      chunkIndex++;
      notify();
    }
  }

  if (gen !== generation) return;
  currentState = "idle";
  notify();
}

export function stopSpeaking(): void {
  generation++;
  cancelRequested = true;
  currentState = "idle";
  speechSynthesis.cancel();
  notify();
}
