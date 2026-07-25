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

  const refresh = useCallback(async () => {
    const gen = ++generation.current;
    try {
      const [tagList, subscriptionList, userSettings] = await Promise.all([
        api.listTags(),
        api.listSubscriptions(),
        api.getSettings(),
      ]);
      if (generation.current !== gen) return;
      setTags(tagList);
      setSubscriptions(subscriptionList);
      setSettingsState(userSettings);
      applyTheme(userSettings.theme);
      setError(null);
    } catch (e) {
      if (generation.current !== gen) return;
      setError(errorMessage(e, normalizeLanguage(settings?.language ?? navigator.language)));
    } finally {
      if (generation.current === gen) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!isLoaded || !userId) return;
    void refresh();
  }, [isLoaded, userId, refresh]);

  const setSettings = useCallback((next: Settings) => {
    setSettingsState(next);
    applyTheme(next.theme);
  }, []);

  const language = normalizeLanguage(settings?.language ?? navigator.language);
  const t = useCallback((source: string, values?: Record<string, string | number>) => translate(source, language, values), [language]);

  const value = useMemo(
    () => ({ tags, subscriptions, settings, loading, error, refresh, setSettings, language, t }),
    [tags, subscriptions, settings, loading, error, refresh, setSettings, language, t],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppData {
  const value = useContext(AppDataContext);
  if (!value) throw new Error("useAppData must be used within AppDataProvider");
  return value;
}
