import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  prepareTitleTranslation,
  titleTranslationStatus,
  titleTranslationSupported,
  translateTitles,
  type TitleTranslationProgress,
  type TitleTranslationStatus,
} from "../lib/titleTranslator";
import { useAppData } from "./AppDataContext";
import { IconButton } from "./ui";

// 一覧タイトルの翻訳は手動トグルでのみ起動する(SPEC/APP.md)。翻訳は端末内で走り、
// 結果はサーバーへ送らない。状態は画面をまたいで共有し、端末ローカルに永続する。
const STORAGE_KEY = "filo.translateTitles";

export interface TitleTranslationLanguage {
  code: string;
  status: TitleTranslationStatus;
}

interface TitleTranslation {
  supported: boolean;
  enabled: boolean;
  translating: boolean;
  toggle: () => void;
  // 翻訳の準備（言語モデルの取得）。一覧のスクロール中に取得を走らせると、
  // ブラウザの取得が不意に始まって理由も伝わらないので、明示操作だけで行う。
  languages: TitleTranslationLanguage[];
  checkedLanguages: boolean;
  preparing: string | null;
  preparationProgress: TitleTranslationProgress | null;
  preparationError: string | null;
  showSetup: boolean;
  setShowSetup: (value: boolean) => void;
  refreshLanguages: () => Promise<void>;
  prepare: (code: string) => Promise<void>;
  // 表示中の記事を翻訳対象として登録する。ON の間はスクロールで増えた分も翻訳する。
  request: (items: { id: number; title: string; sourceLanguage: string | null }[]) => void;
  titleFor: (articleId: number) => string | null;
}

const TitleTranslationContext = createContext<TitleTranslation | null>(null);

export function TitleTranslationProvider({ children }: { children: ReactNode }) {
  const { language, settings, subscriptions, t } = useAppData();
  const readableLanguages = settings?.readableLanguages ?? ["ja"];
  const [enabled, setEnabled] = useState(
    () => titleTranslationSupported && localStorage.getItem(STORAGE_KEY) === "1",
  );
  const [titles, setTitles] = useState<Map<number, string>>(new Map());
  const [translating, setTranslating] = useState(false);
  const [languages, setLanguages] = useState<TitleTranslationLanguage[]>([]);
  const [checkedLanguages, setCheckedLanguages] = useState(false);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [preparationProgress, setPreparationProgress] = useState<TitleTranslationProgress | null>(null);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  // 候補は「購読に実在する言語」。サーバーが決めた feed の言語から作る。
  // 標準APIとWASMのどちらを使うかは翻訳モジュール側で選ぶ。
  const candidates = useMemo(() => {
    const codes = new Set<string>();
    for (const subscription of subscriptions) {
      const code = subscription.feed.language;
      if (!code) continue;
      const base = code.split("-")[0] ?? code;
      if (base === language || readableLanguages.includes(base)) continue;
      codes.add(code);
    }
    return [...codes].sort();
  }, [subscriptions, language, readableLanguages]);

  const refreshLanguages = useCallback(async () => {
    const result: TitleTranslationLanguage[] = [];
    for (const code of candidates) {
      result.push({ code, status: await titleTranslationStatus(code, language) });
    }
    setLanguages(result);
    setCheckedLanguages(true);
  }, [candidates, language]);

  const prepare = useCallback(
    async (code: string) => {
      setPreparing(code);
      setPreparationProgress({ stage: "preparing", progress: 0 });
      setPreparationError(null);
      try {
        let errorDetail: string | undefined;
        const onProgress = (progress: TitleTranslationProgress) => {
          if (progress.error) errorDetail = progress.error.slice(0, 240);
          setPreparationProgress(progress);
        };
        const prepared = await prepareTitleTranslation(code, language, onProgress);
        if (!prepared) {
          setPreparationProgress({ stage: "failed", progress: null });
          const message = t("翻訳モデルの準備に失敗しました。通信状況を確認して、もう一度お試しください。");
          setPreparationError(errorDetail ? `${message} (${errorDetail})` : message);
        }
        await refreshLanguages();
      } finally {
        setPreparing(null);
      }
    },
    [language, refreshLanguages, t],
  );
  // 同じ記事を二度投げないための記録。トグル OFF と表示言語の変更でリセットする。
  const requested = useRef(new Set<number>());
  // 翻訳は 1 本ずつ直列に流す。スクロール中に何度呼ばれても順番待ちになるだけ。
  const chain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    requested.current = new Set();
    setTitles(new Map());
  }, [language]);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      if (!next) requested.current = new Set();
      // ON にした時点で準備状況を確かめ、1 つも使えないなら準備画面へ誘導する
      if (next) {
        void (async () => {
          const statuses = await Promise.all(
            candidates.map((code) => titleTranslationStatus(code, language)),
          );
          setLanguages(candidates.map((code, index) => ({ code, status: statuses[index]! })));
          setCheckedLanguages(true);
          if (!statuses.includes("installed")) setShowSetup(true);
        })();
      }
      return next;
    });
  }, [candidates, language]);

  const request = useCallback(
    (items: { id: number; title: string; sourceLanguage: string | null }[]) => {
      if (!enabled || !titleTranslationSupported) return;
      const fresh = items.filter((item) => !requested.current.has(item.id));
      if (fresh.length === 0) return;
      for (const item of fresh) requested.current.add(item.id);

      setTranslating(true);
      chain.current = chain.current
        .then(() =>
          translateTitles({
            items: fresh,
            targetLanguage: language,
            readableLanguages,
            onTranslated: (id, title) => {
              setTitles((prev) => new Map(prev).set(id, title));
            },
          }).then(() => undefined),
        )
        .catch(() => undefined)
        .finally(() => setTranslating(false));
    },
    [enabled, language, readableLanguages],
  );

  const titleFor = useCallback((articleId: number) => titles.get(articleId) ?? null, [titles]);

  const value = useMemo(
    () => ({
      supported: titleTranslationSupported,
      enabled,
      translating,
      toggle,
      languages,
      checkedLanguages,
      preparing,
      preparationProgress,
      preparationError,
      showSetup,
      setShowSetup,
      refreshLanguages,
      prepare,
      request,
      titleFor,
    }),
    [enabled, translating, toggle, languages, checkedLanguages, preparing, preparationProgress, preparationError, showSetup, refreshLanguages, prepare, request, titleFor],
  );

  return <TitleTranslationContext.Provider value={value}>{children}</TitleTranslationContext.Provider>;
}

export function useTitleTranslation(): TitleTranslation {
  const value = useContext(TitleTranslationContext);
  if (!value) throw new Error("useTitleTranslation must be used within TitleTranslationProvider");
  return value;
}

// 一覧のヘッダーに置く翻訳トグル。端末内翻訳が使えないブラウザでは何も出さない。
export function TitleTranslationToggle() {
  const { t } = useAppData();
  const { supported, enabled, translating, toggle } = useTitleTranslation();
  if (!supported) return null;
  return (
    <IconButton
      icon="translate"
      label={translating ? t("翻訳中…") : enabled ? t("原文タイトルに戻す") : t("タイトルを翻訳")}
      active={enabled}
      onClick={toggle}
    />
  );
}
