import { createClerkClient } from "@clerk/chrome-extension/background";
import { markArticleRead, patchPlaybackState, removeFromQueue } from "./api";

// background(service worker)からサーバー playback-queue を更新するための薄いラッパー。
// トークン取得に失敗した場合は黙ってスキップする(ローカル再生は継続できる)。

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
const SYNC_HOST = import.meta.env.VITE_CLERK_SYNC_HOST as string | undefined;

async function getToken(): Promise<string | null> {
  try {
    const clerk = await createClerkClient({ publishableKey: PUBLISHABLE_KEY, syncHost: SYNC_HOST });
    return (await clerk.session?.getToken()) ?? null;
  } catch {
    return null;
  }
}

// 読み上げ開始: 既読化 + 再生中記事としてサーバーへ保存
export async function notifyPlaybackStarted(articleId: number): Promise<void> {
  const token = await getToken();
  if (!token) return;
  await markArticleRead(token, articleId);
  await patchPlaybackState(token, { currentArticleId: articleId, positionPercent: 0 });
}

export async function notifyPlaybackProgress(fraction: number): Promise<void> {
  const token = await getToken();
  if (!token) return;
  await patchPlaybackState(token, { positionPercent: Math.min(Math.max(fraction, 0), 1) });
}

// 1件読み上げ完了: サーバーキューから削除(server 側で再生位置もリセットされる)
export async function notifyPlaybackFinished(articleId: number): Promise<void> {
  const token = await getToken();
  if (!token) return;
  await removeFromQueue(token, articleId);
}

export async function notifyPlaybackStopped(fraction: number): Promise<void> {
  const token = await getToken();
  if (!token) return;
  await patchPlaybackState(token, { positionPercent: Math.min(Math.max(fraction, 0), 1) });
}
