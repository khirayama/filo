import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { refreshToken, signIn, signOut, signUp } from "./auth";
import { createExtensionApi, type ReadingArticle } from "./api";
import { webAppPath } from "./config";
import { trackEvent } from "./analytics";

interface ReaderSettings {
  targetLanguage: string;
  rate: number;
  voiceName: string | null;
  extractionMode: "article" | "display";
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

interface ReaderSession {
  tabId: number;
  autoplay: boolean;
  targetLanguage: string;
  rate: number;
  voiceName: string | null;
  extractionMode: "article" | "display";
  playing: boolean;
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

function isQueueArticleVisible(articleId: number): boolean {
  const list = document.querySelector<HTMLElement>(".queue-list");
  const row = document.getElementById(`filo-queue-${articleId}`);
  if (!list || !row) return false;
  const listRect = list.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  return rowRect.bottom > listRect.top && rowRect.top < listRect.bottom;
}

function firstVisibleQueueArticleIndex(articles: readonly { id: number }[]): number {
  const firstIndex = articles.findIndex((article) => isQueueArticleVisible(article.id));
  return firstIndex >= 0 ? firstIndex : 0;
}

export function App() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const api = useMemo(() => createExtensionApi(refreshToken), []);
  const [articles, setArticles] = useState<ReadingArticle[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [settings, setSettings] = useState<ReaderSettings>({ targetLanguage: "ja", rate: 1, voiceName: null, extractionMode: "article" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<{ url: string; title: string } | null>(null);
  const [readerState, setReaderState] = useState<ReaderSession | null>(null);
  const [selectedArticleIndex, setSelectedArticleIndex] = useState<number | null>(null);
  const viewedArticleIds = useRef("");
  useEffect(() => {
    void refreshToken().then(token => {
      setIsSignedIn(Boolean(token));
      setIsLoaded(true);
    }).catch(() => {
      setIsSignedIn(false);
      setIsLoaded(true);
    });
  }, []);
  const submitAuth = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      if (authMode === "sign-in") {
        await signIn(authEmail.trim(), authPassword);
        setIsSignedIn(true);
      } else {
        await signUp(authEmail, authPassword);
        setIsSignedIn(true);
      }
      setAuthPassword("");
      setAuthOpen(false);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "認証に失敗しました。");
    } finally {
      setAuthBusy(false);
    }
  };
  const handleSignOut = async () => {
    await signOut();
    setIsSignedIn(false);
    setArticles([]);
  };

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

  const loadSettings = useCallback(async () => {
    const [nextVoices, nextSettings] = await Promise.all([
      send<Voice[]>({ type: "filoGetVoices" }),
      send<ReaderSettings>({ type: "filoGetSettings" }),
    ]);
    setVoices(nextVoices);
    setSettings(nextSettings);
  }, []);

  const loadReaderState = useCallback(async () => {
    setReaderState(await send<ReaderSession | null>({ type: "filoGetState" }));
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextArticles] = await Promise.all([
        isSignedIn ? api.listReadingArticles() : Promise.resolve([] as ReadingArticle[]),
        loadSettings(),
        loadReaderState(),
        loadCurrentPage(),
      ]);
      setArticles(nextArticles);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [api, isSignedIn, loadCurrentPage, loadReaderState, loadSettings]);

  useEffect(() => {
    document.title = "Filo Reader";
    trackEvent("screen_view", { screen_name: "extension_popup" });
  }, []);

  useEffect(() => {
    if (isLoaded) void loadAll();
  }, [isLoaded, loadAll]);

  useEffect(() => {
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      if (changes["filo:readerSettings"]) void loadSettings().catch(() => undefined);
      if (changes["filo:readerState"]) {
        setReaderState((changes["filo:readerState"].newValue as ReaderSession | undefined) ?? null);
      }
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, [loadSettings]);

  const startCurrentPage = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const page = await getCurrentPage();
      setCurrentPage(page);
      if (!page) throw new Error("読み上げできるページがありません。");
      trackEvent("start_reading", { source: "extension_current_page" });
      setSettings(await send<ReaderSettings>({
        type: "filoStartPage",
        page,
        autoplay: true,
        targetLanguage: settings.targetLanguage,
        extractionMode: settings.extractionMode,
      }));
      await loadReaderState();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const addCurrentPage = async () => {
    if (busy) return;
    if (!isSignedIn) {
      setAuthError(null);
      setAuthOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const page = await getCurrentPage();
      setCurrentPage(page);
      if (!page) throw new Error("追加できるページがありません。");
      await api.importArticle({ url: page.url, title: page.title });
      trackEvent("add_to_reading_list", { source: "extension_current_page" });
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
      trackEvent("remove_from_reading_list", { article_id: articleId });
      setArticles((current) => current.filter((article) => article.id !== articleId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const updateSelectedState = async (patch: { isRead?: boolean; inReadingList?: boolean; isBookmarked?: boolean }) => {
    const article = articles[selectedArticleIndex ?? 0];
    if (!article || busy) return;
    setBusy(true);
    setError(null);
    try {
      const state = patch.isRead !== undefined
        ? await api.setArticleRead(article.id, patch.isRead)
        : patch.inReadingList !== undefined
          ? await api.setReadingListMembership(article.id, patch.inReadingList)
          : await api.setBookmarkMembership(article.id, patch.isBookmarked === true);
      if (patch.isRead !== undefined) trackEvent(patch.isRead ? "mark_article_read" : "mark_article_unread", { article_id: article.id });
      if (patch.inReadingList !== undefined) trackEvent(patch.inReadingList ? "add_to_reading_list" : "remove_from_reading_list", { article_id: article.id });
      if (patch.isBookmarked !== undefined) trackEvent(patch.isBookmarked ? "add_to_wishlist" : "remove_from_wishlist", { article_id: article.id });
      setArticles((current) => current.map((item) => item.id === article.id ? { ...item, userState: state } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const showShortcutHelp = () => {
    window.alert([
      "J / ↓  次の記事",
      "K / ↑  前の記事",
      "Enter / O  記事を開く",
      "V  元記事を開く",
      "M  既読／未読",
      "S  リーディングリストに追加",
      "B  ブックマーク",
      "R  更新",
      "Shift+A  すべて既読",
      "Space  読み上げ開始／停止",
      "Esc  ポップアップを閉じる",
    ].join("\n"));
  };

  const control = async (action: string, settings: Record<string, unknown> = {}) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (action === "settings") {
        const nextSettings = await send<ReaderSettings>({ type: "filoSetSettings", ...settings });
        const setting = Object.keys(settings)[0];
        if (setting) trackEvent("settings_change", { setting, value: String(settings[setting]) });
        setSettings(nextSettings);
      } else {
        setSettings(await send<ReaderSettings>({ type: "filoControl", action, ...settings }));
        await loadReaderState();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const { targetLanguage, rate, voiceName, extractionMode } = settings;
  const filteredVoices = voices.filter((voice) => !targetLanguage || voice.lang?.startsWith(targetLanguage));
  const isPlaying = readerState?.playing === true;

  useEffect(() => {
    setSelectedArticleIndex((current) => current == null ? null : Math.min(current, Math.max(articles.length - 1, 0)));
  }, [articles.length]);

  useEffect(() => {
    if (!isSignedIn || loading || articles.length === 0) return;
    const ids = articles.map((article) => article.id).join(",");
    if (viewedArticleIds.current === ids) return;
    viewedArticleIds.current = ids;
    trackEvent("view_item_list", { item_list_name: "extension_reading_list", item_count: articles.length });
  }, [articles, isSignedIn, loading]);

  useEffect(() => {
    const article = selectedArticleIndex == null ? undefined : articles[selectedArticleIndex];
    if (article) document.getElementById(`filo-queue-${article.id}`)?.scrollIntoView({ block: "center" });
  }, [articles, selectedArticleIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, button, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey || event.altKey;
      if (event.shiftKey && key === "a" && !modifier) {
        event.preventDefault();
        if (isSignedIn && window.confirm("現在のリーディングリストの記事をすべて既読にしますか？")) {
          void Promise.all(articles.map((article) => api.setArticleRead(article.id, true)))
            .then(() => { trackEvent("mark_all_articles_read", { scope: "reading_list" }); return loadAll(); })
            .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
        }
        return;
      }
      if (modifier) return;
      const isArticleNavigationKey = key === "j"
        || event.key === "ArrowDown"
        || key === "k"
        || event.key === "ArrowUp";
      if (event.repeat && !isArticleNavigationKey) return;
      if (key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedArticleIndex((current) => {
          if (current != null && isQueueArticleVisible(articles[current]?.id ?? -1)) {
            return Math.min(current + 1, Math.max(articles.length - 1, 0));
          }
          return firstVisibleQueueArticleIndex(articles);
        });
      } else if (key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedArticleIndex((current) => {
          if (current != null && isQueueArticleVisible(articles[current]?.id ?? -1)) {
            return Math.max(current - 1, 0);
          }
          return firstVisibleQueueArticleIndex(articles);
        });
      } else if (key === "enter" || key === "o" || key === "v") {
        event.preventDefault();
        const article = articles[selectedArticleIndex ?? 0];
        if (article?.canonicalUrl) openArticle(article.canonicalUrl);
      } else if (key === "m") {
        event.preventDefault();
        void updateSelectedState({ isRead: !articles[selectedArticleIndex ?? 0]?.userState.isRead });
      } else if (key === "s") {
        event.preventDefault();
        void addCurrentPage();
      } else if (key === "b") {
        event.preventDefault();
        void updateSelectedState({ isBookmarked: !articles[selectedArticleIndex ?? 0]?.userState.isBookmarked });
      } else if (key === "r") {
        event.preventDefault();
        trackEvent("refresh_feeds", { source: "extension" });
        void loadAll();
      } else if (key === " " && currentPage) {
        event.preventDefault();
        void (isPlaying ? control("pause") : startCurrentPage());
      } else if (key === "escape") {
        event.preventDefault();
        window.close();
      } else if (event.key === "?") {
        event.preventDefault();
        showShortcutHelp();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addCurrentPage, api, articles, control, currentPage, isPlaying, isSignedIn, loadAll, selectedArticleIndex, startCurrentPage, updateSelectedState]);

  if (!isLoaded) return <main className="empty-view">ログイン状態を確認しています…</main>;

  return (
    <main className="popup-shell">
      <div className="popup-fixed">
        <header className="brand">
          <img className="brand-mark" src="/logo.svg" alt="" aria-hidden="true" width="24" height="24" />
          <span>Filo</span>
          {isSignedIn ? <><button className="link-button" onClick={() => openWeb("/articles?readingList=1")}>Webを開く</button><button className="link-button" onClick={() => void handleSignOut()}>ログアウト</button></> : <button className="link-button" onClick={() => { setAuthError(null); setAuthOpen((open) => !open); }}>{authOpen ? "閉じる" : "ログイン"}</button>}
        </header>

        {!isSignedIn && authOpen ? (
          <form className="auth-panel" onSubmit={(event) => { event.preventDefault(); void submitAuth(); }}>
            <p className="section-label">{authMode === "sign-in" ? "ログイン" : "アカウント作成"}</p>
            <input aria-label="メールアドレス" type="email" required autoComplete="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="メールアドレス" />
            <input aria-label="パスワード" type="password" required minLength={8} autoComplete={authMode === "sign-in" ? "current-password" : "new-password"} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="8文字以上のパスワード" />
            <button className="primary-action auth-submit" disabled={authBusy} type="submit">{authBusy ? "処理中…" : authMode === "sign-in" ? "ログイン" : "登録"}</button>
            {authError ? <p className="error-message">{authError}</p> : null}
            <button className="link-button auth-switch" type="button" onClick={() => { setAuthError(null); setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in"); }}>{authMode === "sign-in" ? "アカウントを作成" : "ログインへ戻る"}</button>
          </form>
        ) : null}

        <section className="current-page" aria-label="現在のページ">
          <p className="section-label">現在のページ</p>
          <h1>{currentPage?.title || "読み上げるページを開いてください"}</h1>
          <button
            className="primary-action read-page-button"
            disabled={busy || (!currentPage && !isPlaying)}
            onClick={() => {
              if (isPlaying) { trackEvent("reading_stop"); void control("pause"); }
              else void startCurrentPage();
            }}
          >
            {isPlaying ? "読み上げを停止" : currentPage ? "このページを読み上げ" : "読み上げできるページなし"}
          </button>
          <button className="secondary-action read-page-button" disabled={busy || !currentPage} onClick={() => void addCurrentPage()}>
            リーディングリストに追加
          </button>
        </section>

        <section className="settings" aria-label="読み上げ設定">
          <p className="section-label">読み上げ設定</p>
          <div className="setting-row">
            <label htmlFor="extraction-mode">内容</label>
            <select id="extraction-mode" value={extractionMode} disabled={busy} onChange={(event) => void control("settings", { extractionMode: event.target.value })}>
              <option value="article">本文を抽出</option>
              <option value="display">表示中の文章</option>
            </select>
          </div>
          {extractionMode === "display" ? <p className="setting-hint">ページ翻訳後に使うと、表示中の翻訳を読み上げます。</p> : null}
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
        {loading ? <p className="status-message">リーディングリストを読み込んでいます…</p> : articles.length === 0 ? (
          <p className="status-message">リーディングリストに記事がありません。</p>
        ) : (
          <ul className="queue-list">
            {articles.map((article, index) => (
              <li
                id={`filo-queue-${article.id}`}
                className={`queue-item${index === selectedArticleIndex ? " queue-item-selected" : ""}`}
                key={article.id}
                style={index === selectedArticleIndex ? { outline: "2px solid #4f46e5", outlineOffset: "-2px" } : undefined}
              >
                <button className="article-open" disabled={!article.canonicalUrl} onClick={() => { trackEvent("select_item", { article_id: article.id }); openArticle(article.canonicalUrl); }}>
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
