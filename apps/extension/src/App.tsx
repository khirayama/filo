import { useCallback, useEffect, useState } from "react";
import { AUTH_TOKEN_KEY, refreshToken, signIn, signOut, signUp } from "./auth";
import { api } from "./api";
import { webAppPath } from "./config";
import { trackEvent } from "./analytics";
import { Icon } from "./icons";
import { speech, type Voice } from "./speech";
import { LANGUAGE_NAMES, normalizeLanguage, SUPPORTED_LANGUAGES, translate, type SupportedLanguage } from "../../web/src/lib/messages";
import {
  baseLanguage,
  currentSessionItem,
  EMPTY_READER_STATE,
  READER_SETTINGS_KEY,
  READER_STATE_KEY,
  READING_RATES,
  type ReaderCommand,
  type ReaderItem,
  type ReaderSettings,
  type ReaderState,
} from "./reader";

interface ActiveTab {
  id: number;
  url: string;
  title: string;
}

async function send(command: ReaderCommand): Promise<void> {
  const response = await chrome.runtime.sendMessage(command) as { ok?: boolean; error?: string } | undefined;
  if (!response?.ok) throw new Error(response?.error ?? "拡張機能を操作できませんでした。");
}

async function readActiveTab(): Promise<ActiveTab | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined || !tab.url || !/^https?:\/\//i.test(tab.url)) return null;
  return { id: tab.id, url: tab.url, title: tab.title ?? "" };
}

async function readHasSelection(tabId: number): Promise<boolean> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(window.getSelection()?.toString().trim()),
    });
    return result?.result === true;
  } catch {
    return false;
  }
}

function useStorageValue<T>(area: "local" | "session", key: string, fallback: T): T {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    const storage = chrome.storage[area];
    void storage.get(key).then((stored) => setValue((stored[key] as T | undefined) ?? fallback));
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, changedArea: string) => {
      if (changedArea === area && key in changes) setValue((changes[key].newValue as T | undefined) ?? fallback);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
    // `fallback` is a constant default; re-subscribing on identity changes is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area, key]);
  return value;
}

const SHORTCUTS = [
  "Space  読み上げ開始／停止",
  "J  次の記事",
  "K  前の記事",
  "S  リーディングリストに追加",
  "Esc  ポップアップを閉じる",
  "?  ショートカット一覧を表示",
];

export function App() {
  const [language, setLanguage] = useState<SupportedLanguage>(() => normalizeLanguage(chrome.i18n.getUILanguage()));
  const t = useCallback((source: string, values?: Record<string, string | number>) => translate(source, language, values), [language]);

  // Account
  const [authChecked, setAuthChecked] = useState(false);
  const token = useStorageValue<string | null>("local", AUTH_TOKEN_KEY, null);
  const isSignedIn = authChecked && token !== null;
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  // Reader
  const reader = useStorageValue<ReaderState>("session", READER_STATE_KEY, EMPTY_READER_STATE);
  const storedSettings = useStorageValue<Partial<ReaderSettings> | null>("local", READER_SETTINGS_KEY, null);
  const settings: ReaderSettings = {
    targetLanguage: storedSettings?.targetLanguage ?? language,
    rate: storedSettings?.rate ?? 1,
    voiceName: storedSettings?.voiceName ?? null,
  };
  const [voices, setVoices] = useState<Voice[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab | null>(null);
  const [hasSelection, setHasSelection] = useState(false);

  // Reading list
  const [items, setItems] = useState<ReaderItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const fail = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)), []);

  useEffect(() => {
    void refreshToken().catch(() => null).finally(() => setAuthChecked(true));
    void speech.getVoices().then(setVoices);
    trackEvent("screen_view", { screen_name: "extension_popup" });
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : language;
    document.title = t("Filo Reader");
  }, [language, t]);

  const loadActiveTab = useCallback(async () => {
    const tab = await readActiveTab();
    setActiveTab(tab);
    setHasSelection(tab ? await readHasSelection(tab.id) : false);
  }, []);

  useEffect(() => {
    void loadActiveTab();
    const refresh = () => void loadActiveTab();
    const onUpdated = (_tabId: number, changeInfo: { status?: string; url?: string; title?: string }) => {
      if (changeInfo.status === "complete" || changeInfo.url || changeInfo.title) refresh();
    };
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [loadActiveTab]);

  const loadReadingList = useCallback(async () => {
    setListLoading(true);
    try {
      setItems(await api.listReadingList());
    } catch (cause) {
      fail(cause);
    } finally {
      setListLoading(false);
    }
  }, [fail]);

  useEffect(() => {
    if (!isSignedIn) {
      setItems([]);
      return;
    }
    void loadReadingList();
    void api.getSettings().then((account) => setLanguage(account.language), () => undefined);
  }, [isSignedIn, loadReadingList]);

  // Keep the list's read marks in step with the reading session.
  const sessionItems = reader.session?.items;
  useEffect(() => {
    if (!sessionItems) return;
    const read = new Set(sessionItems.filter((item) => item.isRead).map((item) => item.articleId));
    setItems((current) => current.map((item) => read.has(item.articleId) && !item.isRead ? { ...item, isRead: true } : item));
  }, [sessionItems]);

  const session = reader.session;
  const playback = reader.playback;
  const inReaderTab = session !== null && activeTab?.id === session.tabId;
  const currentArticle = inReaderTab ? currentSessionItem(session) : null;
  const currentArticleId = currentSessionItem(session)?.articleId ?? null;
  const playingHere = playback !== null && playback.tabId === activeTab?.id;
  const playingElsewhere = playback !== null && !playingHere;

  const run = (command: ReaderCommand) => {
    setError(null);
    setNotice(null);
    void send(command).catch(fail);
  };

  const togglePlayback = () => {
    if (playback) {
      trackEvent("reading_stop");
      run({ type: "stop" });
    } else if (activeTab) {
      trackEvent("start_reading", { source: "extension_current_page" });
      run({ type: "play", tabId: activeTab.id, kind: "page" });
    }
  };

  const readSelection = () => {
    if (!activeTab || !hasSelection) return;
    trackEvent("start_reading", { source: "extension_selection" });
    run({ type: "play", tabId: activeTab.id, kind: "selection" });
  };

  const addCurrentPage = async () => {
    if (!activeTab || adding) return;
    if (!isSignedIn) {
      setAuthError(null);
      setAuthOpen(true);
      return;
    }
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      await api.importArticle({ url: activeTab.url, title: activeTab.title });
      trackEvent("add_to_reading_list", { source: "extension_current_page" });
      setNotice(t("リーディングリストに追加しました。"));
      await loadReadingList();
    } catch (cause) {
      fail(cause);
    } finally {
      setAdding(false);
    }
  };

  const removeItem = async (articleId: number) => {
    setError(null);
    try {
      await api.removeFromReadingList(articleId);
      trackEvent("remove_from_reading_list", { article_id: articleId });
      setItems((current) => current.filter((item) => item.articleId !== articleId));
    } catch (cause) {
      fail(cause);
    }
  };

  const selectItem = (articleId: number) => {
    trackEvent("select_item", { article_id: articleId });
    run({ type: "select", articleId });
  };

  const move = (delta: 1 | -1) => {
    if (session) run({ type: "move", delta });
  };

  const changeSettings = (patch: Partial<ReaderSettings>) => {
    const [setting] = Object.keys(patch);
    if (setting) trackEvent("settings_change", { setting, value: String(patch[setting as keyof ReaderSettings]) });
    run({ type: "setSettings", settings: patch });
  };

  const submitAuth = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await (authMode === "sign-in" ? signIn : signUp)(authEmail, authPassword);
      setAuthPassword("");
      setAuthOpen(false);
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : "認証に失敗しました。");
    } finally {
      setAuthBusy(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, button, [contenteditable='true']")) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (event.key === "?") {
        event.preventDefault();
        setShowShortcuts((open) => !open);
      } else if (key === "escape") {
        event.preventDefault();
        if (showShortcuts) setShowShortcuts(false);
        else window.close();
      } else if (event.repeat) {
        return;
      } else if (key === " ") {
        event.preventDefault();
        togglePlayback();
      } else if (key === "j") {
        event.preventDefault();
        move(1);
      } else if (key === "k") {
        event.preventDefault();
        move(-1);
      } else if (key === "s") {
        event.preventDefault();
        void addCurrentPage();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const targetBase = baseLanguage(settings.targetLanguage);
  const languageVoices = voices.filter((voice) => baseLanguage(voice.lang) === targetBase);
  const pageTitle = currentArticle?.title || activeTab?.title || activeTab?.url;
  const playbackStatus = playback?.status === "preparing"
    ? t("準備しています…")
    : playback?.untranslated
      ? t("翻訳を利用できないため原文で読み上げています。")
      : null;
  const shownError = error ?? reader.error;

  if (!authChecked) return <main className="empty-view">{t("ログイン状態を確認しています…")}</main>;

  return (
    <main className="popup">
      <header className="popup-header">
        <img className="brand-mark" src="/logo.svg" alt="" aria-hidden="true" width="22" height="22" />
        <span className="brand-name">Filo</span>
        <span className="header-spacer" />
        {isSignedIn ? (
          <>
            <button className="text-button" onClick={() => void chrome.tabs.create({ url: webAppPath("/articles?readingList=1") })}>
              <Icon name="externalLink" size={14} />{t("Webを開く")}
            </button>
            <button className="text-button" onClick={() => void signOut()}>{t("ログアウト")}</button>
          </>
        ) : (
          <button className="text-button" onClick={() => { setAuthError(null); setAuthOpen((open) => !open); }}>
            {authOpen ? t("閉じる") : t("ログイン")}
          </button>
        )}
      </header>

      {!isSignedIn && authOpen ? (
        <form className="auth-panel" onSubmit={(event) => { event.preventDefault(); void submitAuth(); }}>
          <p className="section-label">{authMode === "sign-in" ? t("ログイン") : t("アカウント作成")}</p>
          <input aria-label={t("メールアドレス")} type="email" required autoComplete="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder={t("メールアドレス")} />
          <input aria-label={t("パスワード")} type="password" required minLength={8} autoComplete={authMode === "sign-in" ? "current-password" : "new-password"} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder={t("8文字以上のパスワード")} />
          <button className="button button-primary" disabled={authBusy} type="submit">{authBusy ? t("処理中…") : authMode === "sign-in" ? t("ログイン") : t("登録")}</button>
          {authError ? <p className="message message-error">{t(authError)}</p> : null}
          <button className="text-button auth-switch" type="button" onClick={() => { setAuthError(null); setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in"); }}>
            {authMode === "sign-in" ? t("アカウントを作成") : t("ログインへ戻る")}
          </button>
        </form>
      ) : null}

      {playingElsewhere ? (
        <div className="mini-player">
          <Icon name="play" size={14} filled />
          <span className="mini-player-title">{playback.title || t("読み上げ中")}</span>
          <button className="button button-small" onClick={() => run({ type: "stop" })}>
            <Icon name="pause" size={14} />{t("停止")}
          </button>
        </div>
      ) : null}

      <section className="reader-panel" aria-label={t("現在のページ")}>
        <p className="section-label">
          {inReaderTab ? `${t("リーディングリスト")} · ${session.index + 1} / ${session.items.length}` : t("現在のページ")}
        </p>
        <h1 className="page-title">{pageTitle || t("読み上げるページを開いてください")}</h1>
        <button className="button button-primary button-block" disabled={!activeTab && !playback} onClick={togglePlayback}>
          <Icon name={playback ? "pause" : "play"} size={16} />
          {playback ? t("読み上げを停止") : t("このページを読み上げ")}
        </button>
        <div className="button-row">
          <button className="button button-small" disabled={!activeTab || !hasSelection} onClick={readSelection}>
            <Icon name="play" size={14} />{t("選択範囲を読み上げ")}
          </button>
          <button className="button button-small" disabled={!activeTab || adding} onClick={() => void addCurrentPage()}>
            <Icon name="queueAdd" size={14} />{t("リストに追加")}
          </button>
        </div>
        {playingHere && playbackStatus ? <p className="message">{playbackStatus}</p> : null}
        {notice ? <p className="message">{notice}</p> : null}
        {shownError ? <p className="message message-error">{t(shownError)}</p> : null}

        <div className="settings-row">
          <label className="setting setting-voice">
            <span>{t("声")}</span>
            <select value={settings.voiceName ?? ""} onChange={(event) => changeSettings({ voiceName: event.target.value || null })}>
              <option value="">{t("自動")}</option>
              {languageVoices.map((voice) => <option value={voice.name} key={voice.name}>{voice.name}</option>)}
            </select>
          </label>
          <label className="setting">
            <span>{t("言語")}</span>
            <select value={targetBase ?? ""} onChange={(event) => changeSettings({ targetLanguage: event.target.value, voiceName: null })}>
              {SUPPORTED_LANGUAGES.map((code) => <option value={code} key={code}>{LANGUAGE_NAMES[code]}</option>)}
            </select>
          </label>
          <label className="setting setting-rate">
            <span>{t("速度")}</span>
            <select value={settings.rate} onChange={(event) => changeSettings({ rate: Number(event.target.value) })}>
              {READING_RATES.map((rate) => <option value={rate} key={rate}>{rate}x</option>)}
            </select>
          </label>
        </div>
      </section>

      {showShortcuts ? (
        <section className="shortcuts" aria-label={t("キーボードショートカット")}>
          <p className="section-label">{t("キーボードショートカット")}</p>
          <ul>{SHORTCUTS.map((line) => <li key={line}>{t(line)}</li>)}</ul>
        </section>
      ) : null}

      {isSignedIn ? (
        <section className="reading-list" aria-label={t("リーディングリスト")}>
          <p className="section-label list-heading">{t("リーディングリスト")}</p>
          {listLoading && items.length === 0 ? (
            <p className="message">{t("リーディングリストを読み込んでいます…")}</p>
          ) : items.length === 0 ? (
            <p className="message">{t("リーディングリストに記事がありません。")}</p>
          ) : (
            <ul className="list">
              {items.map((item) => {
                const current = item.articleId === currentArticleId;
                return (
                  <li className={`list-row${current ? " list-row-current" : ""}`} key={item.articleId}>
                    <button className="list-row-main" onClick={() => selectItem(item.articleId)}>
                      <span className="list-row-title">{item.title}</span>
                      <span className="list-row-meta">{t(item.isRead ? "既読" : "未読")}{item.feedTitle ? ` · ${item.feedTitle}` : ""}</span>
                    </button>
                    <button className="icon-button" aria-label={t("リーディングリストから削除")} title={t("リーディングリストから削除")} onClick={() => void removeItem(item.articleId)}>
                      <Icon name="trash" size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </main>
  );
}
