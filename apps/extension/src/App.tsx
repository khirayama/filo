import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@clerk/chrome-extension";
import type { TtsProgress, TtsSettings } from "./tts";
import type { TtsProgressMessage, TtsSource, TtsStateMessage } from "./ttsMessages";
import { cleanTextForSpeech, splitIntoChunks } from "./ttsTextPrep";
import {
  lookupArticleByUrl,
  addToQueue,
  removeFromQueue,
  getPlaybackQueue,
  fetchSpeechText,
} from "./api";
import {
  LOCAL_QUEUE_KEY,
  addToLocalQueue,
  loadLocalQueue,
  normalizeUrlForCompare,
  removeFromLocalQueue,
  saveLocalQueue,
  type LocalQueueItem,
} from "./queueStorage";
import {
  DEFAULT_SETTINGS,
  PITCH_RANGE,
  RATE_RANGE,
  clamp,
  loadAutoPlay,
  loadStoredSettings,
  saveAutoPlay,
  saveStoredSettings,
} from "./ttsSettings";
import { getSortedVoices, pickDefaultVoice } from "./voices";

const WEB_APP_URL = (import.meta.env.VITE_WEB_APP_URL as string | undefined) ?? "http://localhost:5173";

export function App() {
  const { isSignedIn, isLoaded, getToken, signOut } = useAuth();

  const [status, setStatus] = useState("抽出中…");
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [queue, setQueue] = useState<LocalQueueItem[]>([]);

  const [progress, setProgress] = useState<TtsProgress>({
    state: "idle", chunkIndex: 0, totalChunks: 0, fraction: 0,
  });
  const [playingSource, setPlayingSource] = useState<TtsSource | null>(null);

  const [settings, setSettingsState] = useState<TtsSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [autoPlay, setAutoPlay] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const updateSettings = useCallback((patch: Partial<TtsSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      saveStoredSettings(next).catch(() => {});
      chrome.runtime.sendMessage({ type: "ttsUpdateSettings", settings: next }).catch(() => {});
      return next;
    });
  }, []);

  useEffect(() => {
    loadStoredSettings().then(setSettingsState).catch(() => {});
    loadAutoPlay().then(setAutoPlay).catch(() => {});
  }, []);

  const toggleAutoPlay = useCallback((value: boolean) => {
    setAutoPlay(value);
    saveAutoPlay(value).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (message: { type: string } & TtsProgressMessage) => {
      if (message.type === "ttsProgress") {
        setProgress(message);
        setPlayingSource(message.source);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  useEffect(() => {
    loadLocalQueue().then(setQueue).catch(() => {});
    const handler = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === "local" && changes[LOCAL_QUEUE_KEY]) {
        setQueue(Array.isArray(changes[LOCAL_QUEUE_KEY].newValue) ? changes[LOCAL_QUEUE_KEY].newValue as LocalQueueItem[] : []);
      }
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }, []);

  useEffect(() => {
    (async () => {
      const state = await chrome.runtime.sendMessage({ type: "ttsGetState" }).catch(() => null) as TtsStateMessage | null;
      if (state) {
        setProgress(state);
        setPlayingSource(state.source);
      }

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
          setStatus("");
          return;
        }
        setPageUrl(tab.url);

        const response = await chrome.tabs.sendMessage(tab.id, { type: "extract" });
        if (response?.title && response?.text) {
          const bodyChunks = splitIntoChunks(cleanTextForSpeech(response.text));
          await addToLocalQueue({
            title: response.title,
            url: tab.url,
            lang: response.lang ?? null,
            chunks: [response.title, ...bodyChunks],
            createdAt: new Date().toISOString(),
          });
          setQueue(await loadLocalQueue());
          setStatus("");
          // 「開いたらすぐ読み上げ」: 追加した現在ページから再生を始める
          if (state?.state !== "playing" && (await loadAutoPlay())) {
            const stored = await loadStoredSettings();
            await chrome.runtime
              .sendMessage({ type: "queuePlay", settings: stored, startUrl: tab.url })
              .catch(() => {});
          }
        } else {
          setStatus("本文を抽出できませんでした。");
        }
      } catch {
        setStatus("このページはキューに追加できません。ページを再読み込みしてください。");
      }
    })();
  }, []);

  // Best-effort sync of the current page into the server-side queue.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !pageUrl) return;
    (async () => {
      const token = await getToken();
      if (!token) return;
      const lookup = await lookupArticleByUrl(token, pageUrl);
      if (!lookup) return;
      if (!lookup.inQueue) await addToQueue(token, lookup.id);
      // ローカル項目に articleId を付与し、background からのサーバー同期を有効にする
      const normalized = normalizeUrlForCompare(pageUrl);
      const items = await loadLocalQueue();
      const index = items.findIndex(
        (item) => item.articleId == null && normalizeUrlForCompare(item.url) === normalized,
      );
      if (index >= 0) {
        items[index] = { ...items[index], articleId: lookup.id };
        await saveLocalQueue(items);
        setQueue(items);
      }
    })().catch(() => {});
  }, [isLoaded, isSignedIn, pageUrl, getToken]);

  // サーバー共有キューの取り込み: 他端末(Web / iOS / Android)で追加された記事を
  // ローカルキューへ反映し、サーバー側で消えた項目を取り除く。
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    (async () => {
      const token = await getToken();
      if (!token) return;
      const data = await getPlaybackQueue(token);
      if (!data) return;

      const serverIds = new Set(data.items.map((item) => item.articleId));
      const byUrl = new Map(
        data.items
          .filter((item) => item.article.canonicalUrl)
          .map((item) => [normalizeUrlForCompare(item.article.canonicalUrl), item.articleId]),
      );

      let items = await loadLocalQueue();
      items = items.map((item) =>
        item.articleId == null
          ? { ...item, articleId: byUrl.get(normalizeUrlForCompare(item.url)) ?? null }
          : item,
      );
      items = items.filter((item) => item.articleId == null || serverIds.has(item.articleId));

      for (const serverItem of data.items) {
        if (items.some((item) => item.articleId === serverItem.articleId)) continue;
        const speech = await fetchSpeechText(token, serverItem.articleId);
        if (!speech || !speech.text.trim()) continue;
        const bodyChunks = splitIntoChunks(cleanTextForSpeech(speech.text));
        // `title` is the original; `translatedTitle` is set only when the
        // server decided the user needs it.
        const title = serverItem.article.translatedTitle ?? serverItem.article.title;
        items.push({
          articleId: serverItem.articleId,
          title,
          url: serverItem.article.canonicalUrl,
          lang: speech.lang,
          chunks: [title, ...bodyChunks],
          createdAt: serverItem.createdAt ?? new Date().toISOString(),
        });
      }

      // サーバーの並び順を優先し、サーバー未同期のローカル項目は末尾に置く
      const orderMap = new Map(data.items.map((item, index) => [item.articleId, index]));
      items.sort((a, b) => {
        const aOrder = a.articleId != null ? (orderMap.get(a.articleId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        const bOrder = b.articleId != null ? (orderMap.get(b.articleId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder;
      });

      await saveLocalQueue(items);
      setQueue(items);
    })().catch(() => {});
  }, [isLoaded, isSignedIn, getToken]);

  useEffect(() => {
    const update = () => setVoices(getSortedVoices());
    update();
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);

  useEffect(() => {
    if (voices.length > 0 && !voices.some((v) => v.voiceURI === settings.voiceURI)) {
      const def = pickDefaultVoice(voices);
      if (def) updateSettings({ voiceURI: def.voiceURI });
    }
  }, [voices, settings.voiceURI, updateSettings]);

  const play = useCallback(async () => {
    setStatus("");
    const response = await chrome.runtime.sendMessage({ type: "queuePlay", settings: settingsRef.current }).catch(() => null) as { ok: boolean } | null;
    if (!response?.ok) setStatus("読み上げを開始できませんでした。");
  }, []);

  const stop = useCallback(() => {
    chrome.runtime.sendMessage({ type: "ttsStop" }).catch(() => {});
  }, []);

  const removeItem = useCallback(async (target: LocalQueueItem) => {
    if (target.url != null) {
      await removeFromLocalQueue(target.url);
    } else {
      const items = await loadLocalQueue();
      await saveLocalQueue(items.filter((item) => item.articleId !== target.articleId || item.articleId == null));
    }
    setQueue(await loadLocalQueue());
    // Keep the server-side queue in sync, same best-effort policy as adding.
    if (!isLoaded || !isSignedIn) return;
    (async () => {
      const token = await getToken();
      if (!token) return;
      if (target.articleId != null) {
        await removeFromQueue(token, target.articleId);
        return;
      }
      if (!target.url) return;
      const lookup = await lookupArticleByUrl(token, target.url);
      if (lookup?.inQueue) await removeFromQueue(token, lookup.id);
    })().catch(() => {});
  }, [isLoaded, isSignedIn, getToken]);

  const openSignIn = useCallback(() => {
    chrome.tabs.create({ url: `${WEB_APP_URL}/sign-in` });
  }, []);

  const playingUrl = normalizeUrlForCompare(playingSource?.url ?? null);
  const isPlaying = progress.state === "playing";

  return (
    <>
      <div className="top">
        <div className="brand">
          <span>Filo Reader</span>
          {isLoaded && isSignedIn && (
            <button className="sign-out-btn" onClick={() => signOut()}>サインアウト</button>
          )}
        </div>
        {status && <p id="status" style={{ color: "#888", fontSize: 13, marginBottom: 8 }}>{status}</p>}
        {isPlaying && playingSource && (
          <div className="now-playing">
            <span className="now-playing-label">読み上げ中</span>
            <span className="now-playing-title">{playingSource.title}</span>
          </div>
        )}
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress.fraction * 100}%` }} />
        </div>
      </div>

      <div className="controls">
        <button
          className="primary"
          disabled={queue.length === 0}
          hidden={isPlaying}
          onClick={play}
        >
          再生
        </button>
        <button
          disabled={!isPlaying}
          onClick={stop}
        >
          停止
        </button>
        <span className="queue-count">{queue.length > 0 ? `キュー: ${queue.length}件` : "キューは空です"}</span>
      </div>

      {queue.length > 0 && (
        <ul className="queue-list">
          {queue.map((item) => {
            const isCurrent = isPlaying && playingUrl != null && normalizeUrlForCompare(item.url) === playingUrl;
            return (
              <li key={item.url ?? item.createdAt} className={isCurrent ? "queue-item playing" : "queue-item"}>
                <div className="queue-item-body">
                  <a className="queue-item-title" href={item.url ?? "#"} target="_blank" rel="noreferrer">
                    {item.title}
                  </a>
                  {item.url && (
                    <a className="queue-item-url" href={item.url} target="_blank" rel="noreferrer">
                      {item.url}
                    </a>
                  )}
                </div>
                <button
                  className="queue-item-remove"
                  title="キューから削除"
                  onClick={() => removeItem(item)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="settings">
        <div className="setting-row">
          <label>音声</label>
          <select
            value={settings.voiceURI ?? ""}
            onChange={(e) => updateSettings({ voiceURI: e.target.value || null })}
          >
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.localService ? v.name : `${v.name} (network)`}
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <label>速度</label>
          <input
            type="range"
            min={RATE_RANGE.min} max={RATE_RANGE.max} step="0.1"
            value={settings.rate}
            onChange={(e) => updateSettings({ rate: clamp(Number(e.target.value), RATE_RANGE.min, RATE_RANGE.max) })}
          />
          <span className="value">{settings.rate.toFixed(1)}</span>
        </div>
        <div className="setting-row">
          <label>ピッチ</label>
          <input
            type="range"
            min={PITCH_RANGE.min} max={PITCH_RANGE.max} step="0.1"
            value={settings.pitch}
            onChange={(e) => updateSettings({ pitch: clamp(Number(e.target.value), PITCH_RANGE.min, PITCH_RANGE.max) })}
          />
          <span className="value">{settings.pitch.toFixed(1)}</span>
        </div>
        <div className="setting-row">
          <label htmlFor="auto-play" style={{ width: "auto" }}>開いたらすぐ読み上げ</label>
          <input
            id="auto-play"
            type="checkbox"
            checked={autoPlay}
            onChange={(e) => toggleAutoPlay(e.target.checked)}
          />
        </div>
      </div>

      {!isSignedIn && (
        <div className="sign-in-prompt">
          <p style={{ margin: "0 0 4px" }}>
            キューを他の端末と同期するには: 1. Filo Web でサインイン → 2. このポップアップを開き直す
          </p>
          <button className="sign-in-link" onClick={openSignIn}>
            Filo Web を開いてサインイン
          </button>
        </div>
      )}
    </>
  );
}
