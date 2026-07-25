import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useApi } from "../api/useApi";
import type { PlaybackQueueItem, PlaybackState } from "../api/types";
import { cleanTextForSpeech, splitIntoChunks } from "../lib/ttsTextPrep";
import { errorMessage } from "../lib/messages";

// サーバー共有の読み上げキュー(SPEC/API.md Playback Queue)を Web Speech API で再生する。
// キューと再生位置はサーバーが single source of truth。再生エンジンはこの Provider に
// 常駐し、画面遷移をまたいで再生を継続する。

export type PlayerPlayState = "idle" | "loading" | "playing";

export const RATE_OPTIONS = [0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0] as const;
const RATE_STORAGE_KEY = "filo:ttsRate";
const VOICE_STORAGE_KEY = "filo:ttsVoices";
const POSITION_SYNC_MS = 10_000;

interface PlayerContextValue {
  queue: PlaybackQueueItem[];
  playState: PlayerPlayState;
  currentArticleId: number | null;
  fraction: number;
  rate: number;
  error: string | null;
  queueLoaded: boolean;
  voices: SpeechSynthesisVoice[];
  voicePrefs: Record<string, string>;
  speechLang: string | null;
  inQueue: (articleId: number) => boolean;
  refreshQueue: () => Promise<void>;
  addToQueue: (articleIds: number[]) => Promise<void>;
  removeFromQueue: (articleId: number) => Promise<void>;
  moveInQueue: (articleId: number, direction: -1 | 1) => Promise<void>;
  clearQueue: () => Promise<void>;
  play: (articleId?: number) => void;
  playArticle: (articleId: number) => Promise<void>;
  pause: () => void;
  next: () => void;
  prev: () => void;
  setRate: (rate: number) => void;
  setVoice: (lang: string, voiceURI: string | null) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

interface SpeechSource {
  text: string;
  lang: string | null;
}

function loadStoredRate(): number {
  const raw = Number(localStorage.getItem(RATE_STORAGE_KEY));
  return Number.isFinite(raw) && raw >= 0.5 && raw <= 4 ? raw : 1.5;
}

// 音声設定は言語ごとに保持する(例: { ja: voiceURI, en: voiceURI })
function loadStoredVoicePrefs(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(VOICE_STORAGE_KEY) ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === "string"),
      ) as Record<string, string>;
    }
  } catch {
    // 壊れた保存値はデフォルトに戻す
  }
  return {};
}

export function voiceLangKey(lang: string): string {
  return lang.slice(0, 2).toLowerCase();
}

// リモート音声(Chrome の Google 系など)は rate/pitch が効かないことがあるため、
// 指定がなければ OS のローカル音声を優先して選ぶ。
export function defaultVoiceFor(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const key = voiceLangKey(lang);
  const matching = voices.filter((voice) => voice.lang.toLowerCase().startsWith(key));
  if (matching.length === 0) return null;
  const local = matching.filter((voice) => voice.localService);
  const pool = local.length > 0 ? local : matching;
  return pool.find((voice) => voice.default) ?? pool[0];
}

function resolveVoice(prefs: Record<string, string>, lang: string): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  const stored = prefs[voiceLangKey(lang)];
  if (stored) {
    const voice = voices.find((v) => v.voiceURI === stored);
    if (voice) return voice;
  }
  return defaultVoiceFor(voices, lang);
}

function ensureVoicesReady(): Promise<void> {
  return new Promise((resolve) => {
    if (speechSynthesis.getVoices().length > 0) {
      resolve();
      return;
    }
    speechSynthesis.addEventListener("voiceschanged", () => resolve(), { once: true });
    setTimeout(resolve, 2000);
  });
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const { isLoaded, userId } = useAuth();

  const [queue, setQueue] = useState<PlaybackQueueItem[]>([]);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [playState, setPlayState] = useState<PlayerPlayState>("idle");
  const [currentArticleId, setCurrentArticleId] = useState<number | null>(null);
  const [fraction, setFraction] = useState(0);
  const [rate, setRateState] = useState(loadStoredRate);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicePrefs, setVoicePrefs] = useState<Record<string, string>>(loadStoredVoicePrefs);
  const [speechLang, setSpeechLang] = useState<string | null>(null);

  // 再生ループから常に最新値を参照するための refs
  const generationRef = useRef(0);
  const queueRef = useRef<PlaybackQueueItem[]>([]);
  const rateRef = useRef(rate);
  const voicePrefsRef = useRef(voicePrefs);
  const serverStateRef = useRef<PlaybackState | null>(null);
  const positionRef = useRef({ articleId: null as number | null, fraction: 0 });
  const playStateRef = useRef<PlayerPlayState>("idle");

  queueRef.current = queue;
  rateRef.current = rate;
  voicePrefsRef.current = voicePrefs;
  playStateRef.current = playState;

  // 利用可能な音声の一覧(UI用)。ブラウザにより非同期に到着する。
  useEffect(() => {
    const update = () => setVoices(speechSynthesis.getVoices());
    update();
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);

  const refreshQueue = useCallback(async () => {
    try {
      const data = await api.getPlaybackQueue();
      setQueue(data.items);
      queueRef.current = data.items;
      serverStateRef.current = data.playbackState;
      setQueueLoaded(true);
      // 停止中のみサーバー状態を採用する(再生中はローカルが最新)
      if (playStateRef.current === "idle" && data.playbackState?.currentArticleId != null) {
        setCurrentArticleId(data.playbackState.currentArticleId);
        setFraction(data.playbackState.positionPercent);
        positionRef.current = {
          articleId: data.playbackState.currentArticleId,
          fraction: data.playbackState.positionPercent,
        };
      }
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [api]);

  useEffect(() => {
    if (!isLoaded || !userId) return;
    void refreshQueue();
  }, [isLoaded, userId, refreshQueue]);

  const patchState = useCallback(
    (patch: Parameters<typeof api.updatePlaybackState>[0]) => {
      api.updatePlaybackState(patch).catch(() => {});
    },
    [api],
  );

  // 再生中は約10秒ごとに再生位置をサーバーへ保存し、端末切替時の再開に備える
  useEffect(() => {
    if (playState !== "playing") return;
    const timer = window.setInterval(() => {
      const pos = positionRef.current;
      if (pos.articleId != null) patchState({ positionPercent: pos.fraction });
    }, POSITION_SYNC_MS);
    return () => window.clearInterval(timer);
  }, [playState, patchState]);

  // 読み上げ対象本文の解決: 抽出本文 > RSS本文。本文翻訳は扱わない(プラットフォーム翻訳に委ねる)
  const resolveSpeech = useCallback(
    async (articleId: number): Promise<SpeechSource | null> => {
      const content = await api.getContent(articleId).catch(() => null);
      if (content?.status === "ready" && (content.text || content.html)) {
        return {
          text: content.text ?? content.html ?? "",
          lang: content.sourceLanguage ?? null,
        };
      }
      const detail = await api.getArticle(articleId).catch(() => null);
      const raw = detail?.rssContentHtml ?? detail?.rssSummary;
      if (!raw) return null;
      return { text: raw, lang: detail?.sourceLanguage ?? null };
    },
    [api],
  );

  // 音読キュー追加時に必要な範囲で本文を取得・解決する(CONCEPT.md 読み上げ方針)
  const requestExtraction = useCallback(
    (articleIds: number[]) => {
      for (const articleId of articleIds) {
        api.requestContent(articleId).catch(() => {});
      }
    },
    [api],
  );

  const speakOne = useCallback((text: string, lang: string | null, gen: number): Promise<void> => {
    return new Promise((resolve) => {
      if (gen !== generationRef.current) {
        resolve();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      if (lang) utterance.lang = lang === "ja" ? "ja-JP" : lang;
      const voice = lang ? resolveVoice(voicePrefsRef.current, lang) : null;
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }
      utterance.rate = rateRef.current;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      speechSynthesis.speak(utterance);
    });
  }, []);

  const nextArticleId = useCallback((articleId: number): number | null => {
    const items = queueRef.current;
    const index = items.findIndex((item) => item.articleId === articleId);
    if (index < 0 || index + 1 >= items.length) return null;
    return items[index + 1].articleId;
  }, []);

  const runPlayback = useCallback(
    async (startArticleId: number, resumeFraction: number) => {
      const gen = ++generationRef.current;
      speechSynthesis.cancel();
      setPlayState("loading");
      setError(null);
      await ensureVoicesReady();
      if (gen !== generationRef.current) return;

      let articleId: number | null = startArticleId;
      let resume = resumeFraction;
      while (articleId != null && gen === generationRef.current) {
        const item = queueRef.current.find((entry) => entry.articleId === articleId);
        if (!item) break;
        setCurrentArticleId(articleId);
        setFraction(0);
        const speech = await resolveSpeech(articleId);
        if (gen !== generationRef.current) return;
        if (!speech || !speech.text.trim()) {
          // 本文がない記事はスキップして次へ
          articleId = nextArticleId(articleId);
          resume = 0;
          continue;
        }

        const chunks = splitIntoChunks(cleanTextForSpeech(speech.text));
        const startChunk =
          resume > 0 ? Math.min(Math.floor(resume * chunks.length), chunks.length - 1) : 0;
        resume = 0;

        setPlayState("playing");
        setSpeechLang(speech.lang);
        positionRef.current = { articleId, fraction: startChunk / chunks.length };
        // 読み上げ開始時に既読化する(SPEC/SCREENS.md Navigation Rules)
        api.setArticleRead(articleId, true).catch(() => {});
        patchState({
          currentArticleId: articleId,
          contentLanguage: speech.lang,
          positionPercent: startChunk / chunks.length,
        });

        let finished = true;
        for (let i = startChunk; i < chunks.length; i++) {
          if (gen !== generationRef.current) {
            finished = false;
            break;
          }
          positionRef.current = { articleId, fraction: i / chunks.length };
          setFraction(i / chunks.length);
          await speakOne(chunks[i], speech.lang, gen);
          if (gen !== generationRef.current) {
            finished = false;
            break;
          }
        }
        if (!finished) return;

        // 1件読み上げ完了: サーバーキューから削除して次へ進む
        setFraction(1);
        const upcoming = nextArticleId(articleId);
        api.removePlaybackQueueItem(articleId).catch(() => {});
        setQueue((prev) => prev.filter((entry) => entry.articleId !== articleId));
        articleId = upcoming;
      }

      if (gen !== generationRef.current) return;
      setPlayState("idle");
      setCurrentArticleId(null);
      setFraction(0);
      positionRef.current = { articleId: null, fraction: 0 };
      patchState({ currentArticleId: null, contentLanguage: null, positionPercent: 0 });
    },
    [api, nextArticleId, patchState, resolveSpeech, speakOne],
  );

  const play = useCallback(
    (articleId?: number) => {
      const items = queueRef.current;
      if (items.length === 0) return;
      const target =
        articleId ??
        positionRef.current.articleId ??
        serverStateRef.current?.currentArticleId ??
        items[0]?.articleId;
      if (target == null || !items.some((item) => item.articleId === target)) {
        void runPlayback(items[0].articleId, 0);
        return;
      }
      // 同一記事の再開なら保存位置から続きを読む
      const resume =
        articleId === undefined && positionRef.current.articleId === target
          ? positionRef.current.fraction
          : articleId === undefined && serverStateRef.current?.currentArticleId === target
            ? serverStateRef.current.positionPercent
            : 0;
      void runPlayback(target, resume);
    },
    [runPlayback],
  );

  // 記事詳細などから「この記事を読み上げ」。未登録ならキューに追加してから再生する。
  const playArticle = useCallback(
    async (articleId: number) => {
      if (!queueRef.current.some((item) => item.articleId === articleId)) {
        try {
          await api.addPlaybackQueueItems([articleId]);
          requestExtraction([articleId]);
          await refreshQueue();
        } catch (e) {
          setError(errorMessage(e));
          return;
        }
      }
      void runPlayback(articleId, 0);
    },
    [api, refreshQueue, requestExtraction, runPlayback],
  );

  const pause = useCallback(() => {
    generationRef.current++;
    speechSynthesis.cancel();
    setPlayState("idle");
    const pos = positionRef.current;
    if (pos.articleId != null) patchState({ positionPercent: pos.fraction });
  }, [patchState]);

  const next = useCallback(() => {
    const current = positionRef.current.articleId ?? currentArticleId;
    if (current == null) return;
    const upcoming = nextArticleId(current);
    if (upcoming != null) void runPlayback(upcoming, 0);
  }, [currentArticleId, nextArticleId, runPlayback]);

  const prev = useCallback(() => {
    const current = positionRef.current.articleId ?? currentArticleId;
    const items = queueRef.current;
    const index = items.findIndex((item) => item.articleId === current);
    if (index > 0) void runPlayback(items[index - 1].articleId, 0);
    else if (index === 0) void runPlayback(items[0].articleId, 0);
  }, [currentArticleId, runPlayback]);

  const setRate = useCallback((value: number) => {
    setRateState(value);
    localStorage.setItem(RATE_STORAGE_KEY, String(value));
  }, []);

  // voiceURI が null なら「自動(デフォルト音声)」に戻す
  const setVoice = useCallback((lang: string, voiceURI: string | null) => {
    setVoicePrefs((prev) => {
      const next = { ...prev };
      const key = voiceLangKey(lang);
      if (voiceURI) next[key] = voiceURI;
      else delete next[key];
      localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const inQueue = useCallback(
    (articleId: number) => queue.some((item) => item.articleId === articleId),
    [queue],
  );

  const addToQueue = useCallback(
    async (articleIds: number[]) => {
      try {
        await api.addPlaybackQueueItems(articleIds);
        requestExtraction(articleIds);
        await refreshQueue();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [api, refreshQueue, requestExtraction],
  );

  const removeFromQueue = useCallback(
    async (articleId: number) => {
      try {
        await api.removePlaybackQueueItem(articleId);
        setQueue((prev) => prev.filter((item) => item.articleId !== articleId));
        if (positionRef.current.articleId === articleId) {
          if (playStateRef.current === "playing") {
            const upcoming = nextArticleId(articleId);
            if (upcoming != null) {
              void runPlayback(upcoming, 0);
            } else {
              pause();
              setCurrentArticleId(null);
              positionRef.current = { articleId: null, fraction: 0 };
            }
          } else {
            setCurrentArticleId(null);
            setFraction(0);
            positionRef.current = { articleId: null, fraction: 0 };
          }
        }
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [api, nextArticleId, pause, runPlayback],
  );

  const moveInQueue = useCallback(
    async (articleId: number, direction: -1 | 1) => {
      const items = [...queueRef.current];
      const index = items.findIndex((item) => item.articleId === articleId);
      const swapWith = index + direction;
      if (index < 0 || swapWith < 0 || swapWith >= items.length) return;
      [items[index], items[swapWith]] = [items[swapWith], items[index]];
      setQueue(items);
      try {
        await api.reorderPlaybackQueue(items.map((item) => item.articleId));
      } catch (e) {
        setError(errorMessage(e));
        await refreshQueue();
      }
    },
    [api, refreshQueue],
  );

  const clearQueue = useCallback(async () => {
    generationRef.current++;
    speechSynthesis.cancel();
    setPlayState("idle");
    setCurrentArticleId(null);
    setFraction(0);
    positionRef.current = { articleId: null, fraction: 0 };
    try {
      await api.clearPlaybackQueue();
      setQueue([]);
      serverStateRef.current = null;
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [api]);

  // ログアウトや画面離脱時に読み上げを止める
  useEffect(() => {
    return () => {
      generationRef.current++;
      speechSynthesis.cancel();
    };
  }, []);

  const value = useMemo(
    () => ({
      queue,
      playState,
      currentArticleId,
      fraction,
      rate,
      error,
      queueLoaded,
      voices,
      voicePrefs,
      speechLang,
      inQueue,
      refreshQueue,
      addToQueue,
      removeFromQueue,
      moveInQueue,
      clearQueue,
      play,
      playArticle,
      pause,
      next,
      prev,
      setRate,
      setVoice,
    }),
    [
      queue,
      playState,
      currentArticleId,
      fraction,
      rate,
      error,
      queueLoaded,
      voices,
      voicePrefs,
      speechLang,
      inQueue,
      refreshQueue,
      addToQueue,
      removeFromQueue,
      moveInQueue,
      clearQueue,
      play,
      playArticle,
      pause,
      next,
      prev,
      setRate,
      setVoice,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerContextValue {
  const value = useContext(PlayerContext);
  if (!value) throw new Error("usePlayer must be used within PlayerProvider");
  return value;
}
