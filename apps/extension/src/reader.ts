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
  pageUrl?: string;
  pageArticles?: Record<string, number>;
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
  | { type: "play"; tabId: number; kind: CaptureKind; article?: ReaderItem }
  | { type: "stop" }
  | { type: "move"; delta: 1 | -1 }
  | { type: "select"; articleId: number }
  | { type: "savedPage"; tabId: number; pageUrl: string; articleId: number; title: string; url: string }
  | { type: "setSettings"; settings: Partial<ReaderSettings> }
  | { type: "startFromWeb"; articleId?: number; url: string; title: string; autoplay: boolean; targetLanguage?: string };

export function currentSessionItem(session: ReaderSession | null): ReaderItem | null {
  return session?.items[session.index] ?? null;
}

export function pageKey(url: string): string { return url.split("#", 1)[0]; }

// Match the API's article URL normalization when identifying an already saved page.
export function articleUrlKey(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.protocol = "https:";
    if (url.port === "443") url.port = "";
    const retained = [...url.searchParams].filter(([key]) => !/^(utm_|fbclid$|gclid$|yclid$|mc_cid$|mc_eid$)/i.test(key));
    url.search = "";
    for (const [key, parameter] of retained) url.searchParams.append(key, parameter);
    url.hash = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch { return null; }
}

export function sessionPageItem(session: ReaderSession | null, url: string | undefined): ReaderItem | null {
  if (!session || !url) return null;
  const id = session.pageArticles?.[pageKey(url)] ?? session.items.find((item) => pageKey(item.url) === pageKey(url))?.articleId;
  if (id === undefined) return null;
  return session.items.find((item) => item.articleId === id) ?? {
    articleId: id, url, title: "", feedTitle: "", isRead: false,
  };
}

export function saveSessionPage(state: ReaderState, command: Extract<ReaderCommand, { type: "savedPage" }>): ReaderState {
  const session = state.session;
  const item = currentSessionItem(session);
  if (!session || session.tabId !== command.tabId || !item) return state;
  const pageArticles = { ...session.pageArticles, [pageKey(command.pageUrl)]: command.articleId };
  if (pageKey(command.pageUrl) !== pageKey(session.pageUrl ?? item.url)) {
    return { ...state, session: { ...session, pageArticles } };
  }
  const existing = session.items.find((entry) => entry.articleId === command.articleId);
  const items = session.items.map((entry, index) => index === session.index
    ? { ...entry, articleId: command.articleId, title: command.title, isRead: existing?.isRead ?? entry.isRead }
    : entry);
  return { ...state, session: { ...session, items, pageArticles } };
}

export function completedPageArticleId(kind: CaptureKind, original: ReaderItem | null, current: ReaderItem | null, savedArticleId: number | null = null): number | null {
  if (kind !== "page") return null;
  if (!original) return savedArticleId;
  const item = original.articleId > 0 ? original : current?.url === original.url ? current : null;
  return item && item.articleId > 0 ? (item.isRead ? null : item.articleId) : savedArticleId;
}

export function baseLanguage(value: string | null | undefined): string | null {
  return value ? value.split("-")[0].toLowerCase() : null;
}
