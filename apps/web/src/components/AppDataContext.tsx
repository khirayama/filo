import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { authClient } from "../auth-client";
import { useApi } from "../api/useApi";
import type { Settings, Subscription, Tag, UnreadCounts } from "../api/types";
import { errorMessage, normalizeLanguage, translate, type SupportedLanguage } from "../lib/messages";
import { applyTheme } from "../lib/theme";

// Tags, subscriptions and settings are needed by the sidebar and most
// screens. This context loads them once per session and lets screens that
// mutate them call refresh() instead of every screen refetching on mount.
interface AppData {
  tags: Tag[];
  subscriptions: Subscription[];
  settings: Settings | null;
  unreadCounts: UnreadCounts;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshUnreadCounts: (options?: { force?: boolean }) => Promise<void>;
  setSettings: (settings: Settings) => void;
  language: SupportedLanguage;
  t: (source: string, values?: Record<string, string | number>) => string;
}

const AppDataContext = createContext<AppData | null>(null);

const LANGUAGE_STORAGE_KEY = "filo:language";
const UNREAD_CACHE_TTL_MS = 10_000;

interface CachedUnreadCounts {
  userId: string;
  value: UnreadCounts;
  fetchedAt: number;
  inFlight?: Promise<UnreadCounts>;
}

function loadStoredLanguage(): SupportedLanguage {
  try {
    return normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? "ja");
  } catch {
    return "ja";
  }
}

function storeLanguage(language: SupportedLanguage): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The in-memory setting is still enough for the current session.
  }
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const userId = session?.user.id;
  const [tags, setTags] = useState<Tag[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<UnreadCounts>({ allArticles: 0, readingList: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localLanguage, setLocalLanguage] = useState<SupportedLanguage>(loadStoredLanguage);
  const generation = useRef(0);
  const activeUserId = useRef<string | null | undefined>(undefined);
  const unreadCache = useRef<CachedUnreadCounts | null>(null);

  const fetchUnreadCounts = useCallback(async (force = false): Promise<UnreadCounts | null> => {
    if (!userId || activeUserId.current !== userId) return null;
    const cached = unreadCache.current;
    const now = Date.now();
    if (cached?.userId === userId && cached.inFlight) return cached.inFlight;
    if (
      !force &&
      cached?.userId === userId &&
      now - cached.fetchedAt < UNREAD_CACHE_TTL_MS
    ) {
      return cached.value;
    }

    let request: Promise<UnreadCounts>;
    request = api.getUnreadCounts().then((nextUnreadCounts) => {
      if (activeUserId.current === userId) {
        unreadCache.current = {
          userId,
          value: nextUnreadCounts,
          fetchedAt: Date.now(),
        };
      }
      return nextUnreadCounts;
    }).finally(() => {
      if (unreadCache.current?.inFlight === request) {
        unreadCache.current.inFlight = undefined;
      }
    });
    unreadCache.current = {
      userId,
      value: cached?.userId === userId ? cached.value : { allArticles: 0, readingList: 0 },
      fetchedAt: cached?.userId === userId ? cached.fetchedAt : 0,
      inFlight: request,
    };
    return request;
  }, [api, userId]);

  const refresh = useCallback(async () => {
    if (!userId || activeUserId.current !== userId) return;
    const refreshUserId = userId;
    const gen = ++generation.current;
    try {
      const [tagList, subscriptionList, userSettings, readingListCounts] = await Promise.all([
        api.listTags(),
        api.listSubscriptions(),
        api.getSettings(),
        api.getUnreadCounts("reading_list"),
      ]);
      const nextUnreadCounts: UnreadCounts = {
        // Each article belongs to at most one subscription for a user, so the
        // subscription badges are an exact and cheaper source for this total.
        allArticles: subscriptionList.reduce((total, subscription) => total + subscription.unreadCount, 0),
        readingList: readingListCounts.readingList,
      };
      if (generation.current !== gen || activeUserId.current !== refreshUserId) return;
      setTags(tagList);
      setSubscriptions(subscriptionList);
      setSettingsState(userSettings);
      setLocalLanguage(userSettings.language);
      storeLanguage(userSettings.language);
      setUnreadCounts(nextUnreadCounts);
      unreadCache.current = {
        userId: refreshUserId,
        value: nextUnreadCounts,
        fetchedAt: Date.now(),
      };
      applyTheme(userSettings.theme);
      setError(null);
    } catch (e) {
      if (generation.current !== gen || activeUserId.current !== refreshUserId) return;
      setError(errorMessage(e, normalizeLanguage(settings?.language ?? "ja")));
    } finally {
      if (generation.current === gen && activeUserId.current === refreshUserId) setLoading(false);
    }
  }, [api, userId]);

  const refreshUnreadCounts = useCallback(async (options: { force?: boolean } = {}) => {
    const nextUnreadCounts = await fetchUnreadCounts(options.force === true);
    if (nextUnreadCounts && activeUserId.current === userId) setUnreadCounts(nextUnreadCounts);
  }, [fetchUnreadCounts, userId]);

  useEffect(() => {
    const userChanged = activeUserId.current !== userId;
    if (!userId || userChanged) {
      ++generation.current;
      activeUserId.current = userId;
      setTags([]);
      setSubscriptions([]);
      setSettingsState(null);
      setUnreadCounts({ allArticles: 0, readingList: 0 });
      unreadCache.current = null;
      setError(null);
      setLoading(Boolean(userId));
    }
    if (!sessionPending && userId) void refresh();
  }, [sessionPending, userId, refresh]);

  const setSettings = useCallback((next: Settings) => {
    setSettingsState(next);
    setLocalLanguage(next.language);
    storeLanguage(next.language);
    applyTheme(next.theme);
  }, []);

  // Auth can change between render and the clearing effect. Never expose state
  // unless it belongs to the currently authenticated user.
  const hasCurrentUserData = Boolean(userId) && activeUserId.current === userId;
  const visibleTags = hasCurrentUserData ? tags : [];
  const visibleSubscriptions = hasCurrentUserData ? subscriptions : [];
  const visibleSettings = hasCurrentUserData ? settings : null;
  const visibleUnreadCounts = hasCurrentUserData ? unreadCounts : { allArticles: 0, readingList: 0 };
  const visibleError = hasCurrentUserData ? error : null;
  const visibleLoading = Boolean(userId) && (!hasCurrentUserData || loading);
  const language = normalizeLanguage(visibleSettings?.language ?? localLanguage);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const t = useCallback((source: string, values?: Record<string, string | number>) => translate(source, language, values), [language]);

  const value = useMemo(
    () => ({
      tags: visibleTags,
      subscriptions: visibleSubscriptions,
      settings: visibleSettings,
      unreadCounts: visibleUnreadCounts,
      loading: visibleLoading,
      error: visibleError,
      refresh,
      refreshUnreadCounts,
      setSettings,
      language,
      t,
    }),
    [visibleTags, visibleSubscriptions, visibleSettings, visibleUnreadCounts, visibleLoading, visibleError, refresh, refreshUnreadCounts, setSettings, language, t],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppData {
  const value = useContext(AppDataContext);
  if (!value) throw new Error("useAppData must be used within AppDataProvider");
  return value;
}
