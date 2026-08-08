import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth, useUser } from "@clerk/chrome-extension";
import { createExtensionApi, type ReadingArticle } from "./api";
import { webAppPath } from "./config";

interface PopupReaderState {
  rate: number;
  voiceName: string | null;
  targetLanguage: string;
}

interface ReaderSettings {
  targetLanguage: string;
  rate: number;
  voiceName: string | null;
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

function openArticle(url: string | null): void {
  if (url) void chrome.tabs.create({ url, active: true });
}

export function App() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const api = useMemo(() => createExtensionApi(() => getToken()), [getToken]);
  const [articles, setArticles] = useState<ReadingArticle[]>([]);
  const [reader, setReader] = useState<PopupReaderState | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [settings, setSettings] = useState<ReaderSettings>({ targetLanguage: "ja", rate: 1, voiceName: null });
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
    const [nextReader, nextVoices, nextSettings] = await Promise.all([
      send<PopupReaderState | null>({ type: "filoGetReaderState" }),
      send<Voice[]>({ type: "filoGetVoices" }),
      send<ReaderSettings>({ type: "filoGetSettings" }),
    ]);
    setReader(nextReader);
    setVoices(nextVoices);
    setSettings(nextSettings);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextArticles] = await Promise.all([
        isSignedIn ? api.listReadingArticles() : Promise.resolve([] as ReadingArticle[]),
        loadReader(),
        loadCurrentPage(),
      ]);
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

  const startCurrentPage = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const page = await getCurrentPage();
      setCurrentPage(page);
      if (!page) throw new Error("読み上げできるページがありません。");
      setReader(await send<PopupReaderState>({
        type: "filoStartPage",
        page,
        autoplay: true,
        targetLanguage: settings.targetLanguage,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const addCurrentPage = async () => {
    if (busy) return;
    if (!isSignedIn) {
      openWeb("/sign-in");
      return;
    }
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

  const removeFromReadingList = async (articleId: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.removeFromReadingList(articleId);
      setArticles((current) => current.filter((article) => article.id !== articleId));
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
      if (action === "settings" && !reader) {
        const nextSettings = await send<ReaderSettings>({ type: "filoSetSettings", ...settings });
        setSettings(nextSettings);
      } else {
        setReader(await send<PopupReaderState | null>({ type: "filoControl", action, ...settings }));
        setSettings((current) => ({ ...current, ...settings } as ReaderSettings));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!isLoaded) return <main className="empty-view">ログイン状態を確認しています…</main>;

  const targetLanguage = reader?.targetLanguage ?? settings.targetLanguage;
  const rate = reader?.rate ?? settings.rate;
  const voiceName = reader?.voiceName ?? settings.voiceName;
  const filteredVoices = voices.filter((voice) => !targetLanguage || voice.lang?.startsWith(targetLanguage));

  return (
    <main className="popup-shell">
      <div className="popup-fixed">
        <header className="brand">
          <span>Filo</span>
          <small title={user?.primaryEmailAddress?.emailAddress}>{user?.primaryEmailAddress?.emailAddress ?? "ログイン不要で読み上げ"}</small>
          {isSignedIn ? <button className="link-button" onClick={() => openWeb("/articles?readingList=1")}>Webを開く</button> : <button className="link-button" onClick={() => openWeb("/sign-in")}>ログイン</button>}
        </header>

        <section className="current-page" aria-label="現在のページ">
          <p className="section-label">現在のページ</p>
          <h1>{currentPage?.title || "読み上げるページを開いてください"}</h1>
          <button className="primary-action read-page-button" disabled={busy || !currentPage} onClick={() => void startCurrentPage()}>
            {currentPage ? "このページを読み上げ" : "読み上げできるページなし"}
          </button>
          <button className="secondary-action read-page-button" disabled={busy || !currentPage} onClick={() => void addCurrentPage()}>
            リーディングリストに追加
          </button>
        </section>

        <section className="settings" aria-label="読み上げ設定">
          <p className="section-label">読み上げ設定</p>
          <div className="setting-row">
            <label htmlFor="language">言語</label>
            <select id="language" value={targetLanguage} disabled={busy} onChange={(event) => void control("settings", { targetLanguage: event.target.value })}>
              {['ja', 'en', 'zh', 'ko', 'es'].map((language) => <option value={language} key={language}>{language}</option>)}
            </select>
            <label htmlFor="rate">速度</label>
            <select id="rate" value={rate} disabled={busy} onChange={(event) => void control("settings", { rate: Number(event.target.value) })}>
              {[0.75, 1, 1.25, 1.5, 2, 3].map((rate) => <option value={rate} key={rate}>{rate}x</option>)}
            </select>
          </div>
          <div className="setting-row">
            <label htmlFor="voice">声</label>
            <select id="voice" value={voiceName ?? ""} disabled={busy} onChange={(event) => void control("settings", { voiceName: event.target.value || null })}>
              <option value="">自動</option>
              {filteredVoices.map((voice) => <option value={voice.name} key={voice.name}>{voice.name}</option>)}
            </select>
          </div>
        </section>
      </div>

      {error ? <p className="error-message">{error}</p> : null}
      {isSignedIn ? <section className="reading-list" aria-label="リーディングリスト">
        <div className="section-heading">
          <p className="section-label">リーディングリスト</p>
        </div>
        {loading ? <p className="status-message">読み込み中…</p> : articles.length === 0 ? (
          <p className="status-message">リーディングリストに記事がありません。</p>
        ) : (
          <ul className="queue-list">
            {articles.map((article) => (
              <li className="queue-item" key={article.id}>
                <button className="article-open" disabled={!article.canonicalUrl} onClick={() => openArticle(article.canonicalUrl)}>
                  <span className="queue-item-title">{article.title}</span>
                  <span className="article-meta">{article.userState.isRead ? "既読" : "未読"} · {article.feed.title}</span>
                </button>
                <button className="queue-item-remove" disabled={busy} onClick={() => void removeFromReadingList(article.id)}>
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section> : null}
    </main>
  );
}
