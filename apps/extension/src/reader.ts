// Shared contract between the service worker (owner of the reading session and
// speech), the popup (controls), and the page script (text capture and
// translation).

export type CaptureKind = "page" | "selection";

export interface CapturedText {
  text: string;
  lang: string | null;
}

export interface PageReader {
  capture(kind: CaptureKind): CapturedText | null;
  translate(text: string, source: string, target: string): Promise<string | null>;
}

export interface ReaderSettings {
  targetLanguage: string;
  rate: number;
  voiceName: string | null;
}

export interface ReaderItem {
  articleId: number;
  title: string;
  url: string;
  feedTitle: string;
  isRead: boolean;
}

// The reading browser: one tab that walks a reading-list snapshot, like the
// in-app browser on iOS / Android.
export interface ReaderSession {
  tabId: number;
  items: ReaderItem[];
  index: number;
}

export interface ReaderPlayback {
  tabId: number;
  title: string;
  kind: CaptureKind;
  status: "preparing" | "playing";
  // Set when the text is read in its original language although a translation
  // to the reading language was wanted.
  untranslated: boolean;
}

export interface ReaderState {
  session: ReaderSession | null;
  playback: ReaderPlayback | null;
  error: string | null;
}

export const READER_STATE_KEY = "filo:reader";
export const READER_SETTINGS_KEY = "filo:readerSettings";
export const READING_RATES = [0.75, 1, 1.25, 1.5, 2, 3] as const;
export const EMPTY_READER_STATE: ReaderState = { session: null, playback: null, error: null };

export type ReaderCommand =
  | { type: "play"; tabId: number; kind: CaptureKind }
  | { type: "stop" }
  | { type: "move"; delta: 1 | -1 }
  | { type: "select"; articleId: number }
  | { type: "setSettings"; settings: Partial<ReaderSettings> }
  | { type: "startFromWeb"; articleId?: number; url: string; title: string; autoplay: boolean; targetLanguage?: string };

export function currentSessionItem(session: ReaderSession | null): ReaderItem | null {
  return session?.items[session.index] ?? null;
}

export function baseLanguage(value: string | null | undefined): string | null {
  return value ? value.split("-")[0].toLowerCase() : null;
}
