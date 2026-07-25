import type { TtsProgress, TtsSettings } from "./tts";

export interface TtsSource {
  title: string;
  url: string | null;
}

export interface TtsPlayMessage {
  type: "ttsPlay";
  chunks: string[];
  lang: string | null;
  settings: TtsSettings;
  source: TtsSource;
}

export interface QueuePlayMessage {
  type: "queuePlay";
  settings: TtsSettings;
  // When set, playback starts from the queue item with this URL (used by the
  // auto-play setting to read the just-added current page first).
  startUrl?: string | null;
}

export interface TtsStopMessage {
  type: "ttsStop";
}

export interface TtsUpdateSettingsMessage {
  type: "ttsUpdateSettings";
  settings: TtsSettings;
}

export interface TtsGetStateMessage {
  type: "ttsGetState";
}

export interface TtsProgressMessage extends TtsProgress {
  type: "ttsProgress";
  source: TtsSource | null;
}

export interface TtsStateMessage extends TtsProgress {
  source: TtsSource | null;
}

export interface TtsFinishedMessage {
  type: "ttsFinished";
}

export interface OffscreenReadyMessage {
  type: "offscreenReady";
}

export type TtsControlMessage =
  | TtsPlayMessage
  | TtsStopMessage
  | TtsUpdateSettingsMessage
  | TtsGetStateMessage;
