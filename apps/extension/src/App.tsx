import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth, useUser } from "@clerk/chrome-extension";
import { createExtensionApi, type ReadingArticle, type ReadingSession } from "./api";
import { WEB_APP_URL, webAppPath } from "./config";

interface PopupReaderState {
  currentArticleId: number | null;
  index: number;
  count: number;
  title: string;
  playing: boolean;
  rate: number;
  voiceName: string | null;
  targetLanguage: string;
  positionPercent: number;
  canPrevious: boolean;
  canNext: boolean;
}

interface Voice {
  name: string;
  lang?: string;
}

interface CurrentPage {
  tabId: number;
  url: string;
  title: string;
}

async function send<T>(message: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as { ok?: boolean; error?: string; data?: T } | undefined;
  if (!response?.ok) throw new Error(response?.error ?? "拡張機能を操作できませんでした。");
  return response.data as T;
}

function openWeb(path: string): void {
  void chrome.tabs.create({ url: webAppPath(path), active: true });
}

export function App() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const api = useMemo(() => createExtensionApi(() => getToken()), [getToken]);
  const [articles, setArticles] = useState<ReadingArticle[]>([]);
  const [reader, setReader] = useState<PopupReaderState | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<{ url: string; title: string } | null>(null);

  const getCurrentPage = useCallback(async (): Promise<CurrentPage | null> => {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];
    if (tab?.id == null || !tab.url || !/^https?:\/\//i.test(tab.url)) {
      return null;
    }
    return { tabId: tab.id, url: tab.url, title: tab.title ?? "" };
  }, []);

  const loadCurrentPage = useCallback(async () => {
    setCurrentPage(await getCurrentPage());
  }, [getCurrentPage]);

  useEffect(() => {
    const refresh = () => void loadCurrentPage().catch(() => undefined);
    const onUpdated = (_tabId: number, changeInfo: { status?: string; url?: string }) => {
      if (changeInfo.status === "complete" || changeInfo.url) refresh();
    };
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(refresh);
    return () => {
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.windows.onFocusChanged.removeListener(refresh);
    };
  }, [loadCurrentPage]);

  const loadReader = useCallback(async () => {
    const [nextReader, nextVoices] = await Promise.all([
      send<PopupReaderState | null>({ type: "filoGetReaderState" }),
      send<Voice[]>({ type: "filoGetVoices" }),
    ]);
    setReader(nextReader);
    setVoices(nextVoices);
  }, []);

  const loadAll = useCallback(async () => {
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [nextArticles] = await Promise.all([api.listReadingArticles(), loadReader(), loadCurrentPage()]);
      setArticles(nextArticles);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [api, isSignedIn, loadCurrentPage, loadReader]);

  useEffect(() => {
    document.title = "Filo Reader";
  }, []);

  useEffect(() => {
    if (isLoaded) void loadAll();
  }, [isLoaded, loadAll]);

  useEffect(() => {
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes["filo:readerSession"]) void loadReader().catch(() => undefined);
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, [loadReader]);

  const start = async (autoplay: boolean, articleId?: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const [session, language] = await Promise.all([api.startReadingSession(), api.getLanguage()]);
      const currentId = articleId ?? session.playbackState?.currentArticleId ?? null;
      if (currentId === null) throw new Error("未読の記事がありません。");
      const started = await send<PopupReaderState>({
        type: "filoStart",
        session: session as ReadingSession,
        articleId: currentId,
        autoplay,
        targetLanguage: language,
      });
      setReader(started);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const startCurrentPage = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const [page, language] = await Promise.all([getCurrentPage(), api.getLanguage()]);
      setCurrentPage(page);
      if (!page) throw new Error("読み上げできるページがありません。");
      setReader(await send<PopupReaderState>({
        type: "filoStartPage",
        page,
        autoplay: true,
        targetLanguage: language,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const control = async (action: string, settings: Record<string, unknown> = {}) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setReader(await send<PopupReaderState | null>({ type: "filoControl", action, ...settings }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (articleId: number) => {
    setError(null);
    try {
      await api.removeFromReadingList(articleId);
      setArticles((current) => current.filter((article) => article.id !== articleId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const removeReadArticles = async () => {
    if (!window.confirm("既読の記事をリーディングリストから削除しますか？")) return;
    setBusy(true);
    setError(null);
    try {
      await api.removeReadArticlesFromReadingList();
      setArticles(await api.listReadingArticles());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const addCurrentPage = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const page = await getCurrentPage();
      setCurrentPage(page);
      if (!page) throw new Error("追加できるページがありません。");
      await api.importArticle({ url: page.url, title: page.title });
      setArticles(await api.listReadingArticles());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!isLoaded) return <main className="empty-view">ログイン状態を確認しています…</main>;

  if (!isSignedIn) {
    return (
      <main className="empty-view">
        <h1>Filo</h1>
        <p>Webアプリへログインすると、リーディングリストと再生状態がExtensionにも同期されます。</p>
        {error ? <p className="error-message">{error}</p> : null}
        <button className="primary-action" onClick={() => openWeb("/sign-in")}>Webアプリでログイン</button>
        <small>ログイン後にポップアップを開き直してください。</small>
      </main>
    );
  }

  const filteredVoices = voices.filter((voice) => !reader?.targetLanguage || voice.lang?.startsWith(reader.targetLanguage));

  return (
    <main className="popup-shell">
      <section className="top">
        <div className="brand">
          <span>Filo</span>
          <small title={user?.primaryEmailAddress?.emailAddress}>{user?.primaryEmailAddress?.emailAddress ?? "ログイン済み"}</small>
          <button className="link-button" onClick={() => openWeb("/articles?readingList=1")}>Webを開く</button>
        </div>
        <div className="player-card">
          <div className="player-card-header">
            <span className="now-playing-label">
              <span className={`play-indicator${reader?.playing ? " active" : ""}`} aria-hidden="true" />
              {reader?.playing ? "再生中" : "待機中"}
            </span>
            <span className="queue-count">{reader ? `${reader.index + 1} / ${reader.count}` : `${articles.length}件`}</span>
          </div>
          <div className="player-main">
            <div className="player-art" aria-hidden="true">♪</div>
            <div className="player-copy">
              <span className="now-playing-title">{reader?.title || "再生する記事を選択してください"}</span>
              <small>{reader ? "Filo Reader" : "再生待ち"}</small>
            </div>
          </div>
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${(reader?.positionPercent ?? 0) * 100}%` }} /></div>
          <div className="player-progress-meta">
            <span>{Math.round((reader?.positionPercent ?? 0) * 100)}%</span>
            <span>{reader?.playing ? "再生中" : "停止中"}</span>
          </div>
        </div>
      </section>

      <section className="controls" aria-label="再生操作">
        <button className="transport" title="前の記事" aria-label="前の記事" disabled={busy || !reader?.canPrevious} onClick={() => void control("previous")}>⏮</button>
        <button className="transport primary" title={reader?.playing ? "一時停止" : "読み上げ開始"} aria-label={reader?.playing ? "一時停止" : "読み上げ開始"} disabled={busy || !reader} onClick={() => void control(reader?.playing ? "pause" : "play")}>
          {reader?.playing ? "⏸" : "▶"}
        </button>
        <button className="transport" title="次の記事" aria-label="次の記事" disabled={busy || !reader?.canNext} onClick={() => void control("next")}>⏭</button>
      </section>

      <section className="settings" aria-label="読み上げ設定">
        <div className="setting-row">
          <label htmlFor="language">言語</label>
          <select id="language" value={reader?.targetLanguage ?? "ja"} disabled={!reader || busy} onChange={(event) => void control("settings", { targetLanguage: event.target.value })}>
            {['ja', 'en', 'zh', 'ko', 'es'].map((language) => <option value={language} key={language}>{language}</option>)}
          </select>
          <label htmlFor="rate">速度</label>
          <select id="rate" value={reader?.rate ?? 1} disabled={!reader || busy} onChange={(event) => void control("settings", { rate: Number(event.target.value) })}>
            {[0.75, 1, 1.25, 1.5, 2, 3].map((rate) => <option value={rate} key={rate}>{rate}x</option>)}
          </select>
        </div>
        <div className="setting-row">
          <label htmlFor="voice">声</label>
          <select id="voice" value={reader?.voiceName ?? ""} disabled={!reader || busy} onChange={(event) => void control("settings", { voiceName: event.target.value || null })}>
            <option value="">自動</option>
            {filteredVoices.map((voice) => <option value={voice.name} key={voice.name}>{voice.name}</option>)}
          </select>
        </div>
      </section>

      <section className="list-heading">
        <button disabled={busy || !currentPage} onClick={() => void addCurrentPage()}>
          {currentPage ? "このページを追加" : "追加できるページなし"}
        </button>
        <button className="primary" disabled={busy || !currentPage} onClick={() => void startCurrentPage()}>
          {currentPage ? "このページを読み上げ" : "読み上げできるページなし"}
        </button>
        <button disabled={busy || articles.length === 0} onClick={() => void start(false)}>閲覧開始</button>
        <button className="primary" disabled={busy || articles.length === 0} onClick={() => void start(true)}>読み上げ開始</button>
        <button disabled={busy || !articles.some((article) => article.userState.isRead)} onClick={() => void removeReadArticles()}>既読記事を削除</button>
        <button className="link-button" disabled={loading} onClick={() => void loadAll()}>更新</button>
      </section>

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="status-message">読み込み中…</p> : articles.length === 0 ? (
        <p className="status-message">リーディングリストに記事がありません。</p>
      ) : (
        <ul className="queue-list">
          {articles.map((article) => (
            <li className={`queue-item${reader?.currentArticleId === article.id ? " playing" : ""}`} key={article.id}>
              <button className="article-open" disabled={busy || !article.canonicalUrl} onClick={() => void start(false, article.id)}>
                <span className="queue-item-title">{article.title}</span>
                <span className="article-meta">{article.userState.isRead ? "既読" : "未読"} · {article.feed.title}</span>
              </button>
              <button className="article-play" title="この記事から読み上げ" disabled={busy || !article.canonicalUrl} onClick={() => void start(true, article.id)}>▶</button>
              <button className="queue-item-remove" title="リーディングリストから削除" onClick={() => void remove(article.id)}>×</button>
            </li>
          ))}
        </ul>
      )}
      <footer>{new URL(WEB_APP_URL).host}</footer>
    </main>
  );
}
