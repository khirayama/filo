import type { TtsSettings } from "./tts";

const STORAGE_KEY = "filo:ttsSettings";

export const DEFAULT_SETTINGS: TtsSettings = { rate: 1.5, pitch: 1.0, voiceURI: null };

export const RATE_RANGE = { min: 0.5, max: 4.0 } as const;
export const PITCH_RANGE = { min: 0.0, max: 2.0 } as const;

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function numberOrDefault(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function normalizeStoredSettings(raw: Partial<TtsSettings> | null | undefined): TtsSettings {
  return {
    rate: clamp(numberOrDefault(raw?.rate, DEFAULT_SETTINGS.rate), RATE_RANGE.min, RATE_RANGE.max),
    pitch: clamp(numberOrDefault(raw?.pitch, DEFAULT_SETTINGS.pitch), PITCH_RANGE.min, PITCH_RANGE.max),
    voiceURI: raw?.voiceURI ?? null,
  };
}

export async function loadStoredSettings(): Promise<TtsSettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeStoredSettings(stored[STORAGE_KEY] as Partial<TtsSettings> | undefined);
}

export async function saveStoredSettings(s: TtsSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: s });
}

// Popup-level preference, stored apart from TtsSettings because the speech
// engine never needs it: start reading the current page as soon as the popup
// has added it to the queue.
const AUTO_PLAY_KEY = "filo:autoPlay";

export async function loadAutoPlay(): Promise<boolean> {
  const stored = await chrome.storage.local.get(AUTO_PLAY_KEY);
  return stored[AUTO_PLAY_KEY] === true;
}

export async function saveAutoPlay(value: boolean): Promise<void> {
  await chrome.storage.local.set({ [AUTO_PLAY_KEY]: value });
}
