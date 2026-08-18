import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useApi } from "../api/useApi";
import type { Settings, Subscription, Tag } from "../api/types";
import { errorMessage, normalizeLanguage, translate, type SupportedLanguage } from "../lib/messages";
import { applyTheme } from "../lib/theme";

// Tags, subscriptions and settings are needed by the sidebar and most
// screens. This context loads them once per session and lets screens that
// mutate them call refresh() instead of every screen refetching on mount.
interface AppData {
  tags: Tag[];
  subscriptions: Subscription[];
  settings: Settings | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setSettings: (settings: Settings) => void;
  language: SupportedLanguage;
  t: (source: string, values?: Record<string, string | number>) => string;
}

const AppDataContext = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const { isLoaded, userId } = useAuth();
  const [tags, setTags] = useState<Tag[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const activeUserId = useRef<string | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (!userId || activeUserId.current !== userId) return;
    const refreshUserId = userId;
    const gen = ++generation.current;
    try {
      const [tagList, subscriptionList, userSettings] = await Promise.all([
        api.listTags(),
        api.listSubscriptions(),
        api.getSettings(),
      ]);
      if (generation.current !== gen || activeUserId.current !== refreshUserId) return;
      setTags(tagList);
      setSubscriptions(subscriptionList);
      setSettingsState(userSettings);
      applyTheme(userSettings.theme);
      setError(null);
    } catch (e) {
      if (generation.current !== gen || activeUserId.current !== refreshUserId) return;
      setError(errorMessage(e, normalizeLanguage(settings?.language ?? navigator.language)));
    } finally {
      if (generation.current === gen && activeUserId.current === refreshUserId) setLoading(false);
    }
  }, [api, userId]);

  useEffect(() => {
    const userChanged = activeUserId.current !== userId;
    if (!userId || userChanged) {
      ++generation.current;
      activeUserId.current = userId;
      setTags([]);
      setSubscriptions([]);
      setSettingsState(null);
      setError(null);
      setLoading(Boolean(userId));
    }
    if (isLoaded && userId) void refresh();
  }, [isLoaded, userId, refresh]);

  const setSettings = useCallback((next: Settings) => {
    setSettingsState(next);
    applyTheme(next.theme);
  }, []);

  // Auth can change between render and the clearing effect. Never expose state
  // unless it belongs to the user currently reported by Clerk.
  const hasCurrentUserData = Boolean(userId) && activeUserId.current === userId;
  const visibleTags = hasCurrentUserData ? tags : [];
  const visibleSubscriptions = hasCurrentUserData ? subscriptions : [];
  const visibleSettings = hasCurrentUserData ? settings : null;
  const visibleError = hasCurrentUserData ? error : null;
  const visibleLoading = Boolean(userId) && (!hasCurrentUserData || loading);
  const language = normalizeLanguage(visibleSettings?.language ?? navigator.language);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const t = useCallback((source: string, values?: Record<string, string | number>) => translate(source, language, values), [language]);

  const value = useMemo(
    () => ({
      tags: visibleTags,
      subscriptions: visibleSubscriptions,
      settings: visibleSettings,
      loading: visibleLoading,
      error: visibleError,
      refresh,
      setSettings,
      language,
      t,
    }),
    [visibleTags, visibleSubscriptions, visibleSettings, visibleLoading, visibleError, refresh, setSettings, language, t],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppData {
  const value = useContext(AppDataContext);
  if (!value) throw new Error("useAppData must be used within AppDataProvider");
  return value;
}
