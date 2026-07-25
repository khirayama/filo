export const LOCAL_QUEUE_KEY = "filo:localPlaybackQueue";

export interface LocalQueueItem {
  title: string;
  url: string | null;
  lang: string | null;
  chunks: string[];
  createdAt: string;
  // サーバー playback-queue 上の記事 id。サーバー未同期(未解決)の項目は null。
  articleId?: number | null;
}

export function normalizeUrlForCompare(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

export async function loadLocalQueue(): Promise<LocalQueueItem[]> {
  const stored = await chrome.storage.local.get(LOCAL_QUEUE_KEY);
  return Array.isArray(stored[LOCAL_QUEUE_KEY]) ? stored[LOCAL_QUEUE_KEY] as LocalQueueItem[] : [];
}

export async function saveLocalQueue(items: LocalQueueItem[]): Promise<void> {
  await chrome.storage.local.set({ [LOCAL_QUEUE_KEY]: items });
}

export async function addToLocalQueue(item: LocalQueueItem): Promise<boolean> {
  const normalized = normalizeUrlForCompare(item.url);
  if (!normalized) return false;
  const items = await loadLocalQueue();
  if (items.some((existing) => normalizeUrlForCompare(existing.url) === normalized)) return true;
  await saveLocalQueue([...items, item]);
  return true;
}

export async function removeFromLocalQueue(url: string | null): Promise<void> {
  const normalized = normalizeUrlForCompare(url);
  if (!normalized) return;
  const items = await loadLocalQueue();
  await saveLocalQueue(items.filter((item) => normalizeUrlForCompare(item.url) !== normalized));
}
