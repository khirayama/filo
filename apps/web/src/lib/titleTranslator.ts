// 一覧タイトルの端末内翻訳。標準の Translator API を優先し、API が無い
// ブラウザでは Transformers.js + ONNX Runtime Web (WASM) をフォールバック
// として使う。翻訳結果はサーバーへ保存しない(SPEC/APP.md)。
//
// iOS の Translation framework / Android の ML Kit と同じ役割のモジュール。
// 片方だけ直すとプラットフォーム間で挙動がずれるので、必ず全部を更新する。
//
// **原文言語の判定はサーバーが行う**(apps/api/src/lib/languageDetect.ts)。フィード全体を
// 連結した長文とフィード言語を事前確率にして決めており、端末側の短いタイトル 1 本より
// 材料が多い。判定器を端末ごとに持つと挙動が揃わないので、ここでは記事の
// `sourceLanguage` をそのまま使う。

type Availability = "unavailable" | "downloadable" | "downloading" | "available";

interface TranslatorInstance {
  translate(text: string): Promise<string>;
}

interface LanguagePair {
  sourceLanguage: string;
  targetLanguage: string;
}

interface TranslatorDownloadMonitor {
  addEventListener(
    event: "downloadprogress",
    listener: (event: { loaded: number; total: number }) => void,
  ): void;
}

const TranslatorApi = (
  globalThis as {
    Translator?: {
      availability(pair: LanguagePair): Promise<Availability>;
      create(
        pair: LanguagePair,
        options?: { monitor?: (monitor: TranslatorDownloadMonitor) => void },
      ): Promise<TranslatorInstance>;
    };
  }
).Translator;

// WASM fallback is loaded lazily, but WebAssembly itself is enough to expose the
// feature. The actual language-pair support is checked asynchronously below.
const wasmTranslationSupported = typeof WebAssembly !== "undefined";

// Keep the public surface used by the React layer stable. The implementation
// chooses a local engine per language pair without the caller needing to know
// which browser it is running in.
export const titleTranslationSupported = TranslatorApi != null || wasmTranslationSupported;

export type TitleTranslationProgressStage = "preparing" | "downloading" | "initializing" | "ready" | "failed";

export interface TitleTranslationProgress {
  stage: TitleTranslationProgressStage;
  progress: number | null;
  loaded?: number;
  total?: number;
  error?: string;
}

export type TitleTranslationProgressListener = (progress: TitleTranslationProgress) => void;
type ProgressListener = TitleTranslationProgressListener;

// source -> target ごとに 1 インスタンス。生成にモデル取得が伴うので使い回す。
const translators = new Map<string, Promise<TranslatorInstance | null>>();
const fallbackTranslators = new Map<string, Promise<TranslatorInstance | null>>();
const nativeUnavailable = new Set<string>();
const fallbackModelsReady = new Set<string>();
// セッション内だけのキャッシュ。端末内翻訳は十分速いので永続化しない。
const translated = new Map<string, string>();

// Use the multilingual model in browsers without the native Translator API so
// titles are readable. Its download is larger, but it is substantially better
// for cross-language titles than the small Marian pair models.
const LOCAL_MULTILINGUAL_MODEL = "Xenova/m2m100_418M";
const LOCAL_MULTILINGUAL_LANGUAGES = new Set([
  "ar", "de", "en", "es", "fr", "hi", "id", "it", "ja", "ko", "nl", "pl", "pt", "ru", "th", "tr", "vi", "zh",
]);
const LOCAL_TO_EN_MODELS: Record<string, string> = {
  de: "Xenova/opus-mt-de-en",
  es: "Xenova/opus-mt-es-en",
  fr: "Xenova/opus-mt-fr-en",
  it: "Xenova/opus-mt-it-en",
  ja: "Xenova/opus-mt-jap-en",
  ko: "Xenova/opus-mt-ko-en",
  nl: "Xenova/opus-mt-nl-en",
  ru: "Xenova/opus-mt-ru-en",
  zh: "Xenova/opus-mt-zh-en",
};

const LOCAL_FROM_EN_MODELS: Record<string, string> = {
  de: "Xenova/opus-mt-en-de",
  es: "Xenova/opus-mt-en-es",
  fr: "Xenova/opus-mt-en-fr",
  it: "Xenova/opus-mt-en-it",
  ja: "Xenova/opus-mt-en-jap",
  nl: "Xenova/opus-mt-en-nl",
  ru: "Xenova/opus-mt-en-ru",
  zh: "Xenova/opus-mt-en-zh",
};

const safariBrowser = typeof navigator !== "undefined"
  && /Safari/i.test(navigator.userAgent)
  && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS/i.test(navigator.userAgent);
const USE_MULTILINGUAL_MODEL = safariBrowser || TranslatorApi == null;
const LOCAL_DTYPE = "q8";

interface LocalTranslatorPipeline {
  (text: string, options?: { src_lang?: string; tgt_lang?: string }): Promise<Array<{ translation_text: string }>>;
}

type LocalPipelineFactory = (
  task: string,
  model: string,
  options: { dtype: string; progress_callback: (info: unknown) => void },
) => Promise<LocalTranslatorPipeline>;

interface LocalProgressInfo {
  status: "initiate" | "download" | "progress" | "progress_total" | "done" | "ready";
  progress?: number;
  loaded?: number;
  total?: number;
}

const fallbackRuntimes = new Map<string, Promise<LocalTranslatorPipeline | null>>();
const fallbackRuntimeErrors = new Map<string, string>();
const fallbackProgressListeners = new Set<ProgressListener>();

function pairKey(sourceLanguage: string, targetLanguage: string): string {
  return `${sourceLanguage}->${targetLanguage}`;
}

function baseLanguage(language: string): string {
  return language.split("-")[0] ?? language;
}

function publishFallbackProgress(info: LocalProgressInfo): void {
  let progress: TitleTranslationProgress;
  if (info.status === "progress" || info.status === "progress_total") {
    progress = {
      stage: "downloading",
      progress: typeof info.progress === "number" ? info.progress : null,
      loaded: info.loaded,
      total: info.total,
    };
  } else if (info.status === "done" || info.status === "ready") {
    progress = { stage: "initializing", progress: 100 };
  } else {
    progress = { stage: "preparing", progress: 0 };
  }
  for (const listener of fallbackProgressListeners) listener(progress);
}

async function getFallbackRuntime(model: string): Promise<LocalTranslatorPipeline | null> {
  if (!wasmTranslationSupported) return null;
  const cached = fallbackRuntimes.get(model);
  if (cached) return cached;

  const runtime = import("@huggingface/transformers")
    .then(({ pipeline }) =>
      (pipeline as unknown as LocalPipelineFactory)("translation", model, {
        // Keep the multilingual model quantized. Transformers.js is pinned to a
        // runtime generation that supports this graph in Safari as well.
        dtype: LOCAL_DTYPE,
        progress_callback: (info: unknown) => publishFallbackProgress(info as LocalProgressInfo),
      }) as Promise<LocalTranslatorPipeline>,
    )
    .catch((error: unknown) => {
      // Allow a retry after a transient model/network failure.
      const message = error instanceof Error ? error.message : String(error);
      fallbackRuntimeErrors.set(model, message);
      console.error(`[titleTranslator] Failed to load ${model}:`, error);
      fallbackRuntimes.delete(model);
      return null;
    });

  fallbackRuntimes.set(model, runtime);
  return runtime;
}

function fallbackModels(sourceLanguage: string, targetLanguage: string): string[] | null {
  const source = baseLanguage(sourceLanguage);
  const target = baseLanguage(targetLanguage);
  if (source === target) return [];
  if (USE_MULTILINGUAL_MODEL) {
    return LOCAL_MULTILINGUAL_LANGUAGES.has(source) && LOCAL_MULTILINGUAL_LANGUAGES.has(target)
      ? [LOCAL_MULTILINGUAL_MODEL]
      : null;
  }
  if (source === "en") {
    const model = LOCAL_FROM_EN_MODELS[target];
    return model ? [model] : null;
  }
  if (target === "en") {
    const model = LOCAL_TO_EN_MODELS[source];
    return model ? [model] : null;
  }
  const toEnglish = LOCAL_TO_EN_MODELS[source];
  const fromEnglish = LOCAL_FROM_EN_MODELS[target];
  return toEnglish && fromEnglish ? [toEnglish, fromEnglish] : null;
}

async function fallbackStatus(sourceLanguage: string, targetLanguage: string): Promise<TitleTranslationStatus> {
  if (!wasmTranslationSupported) return "unavailable";
  const models = fallbackModels(sourceLanguage, targetLanguage);
  if (!models) return "unavailable";
  if (models.every((model) => fallbackModelsReady.has(model))) return "installed";
  return "downloadable";
}

async function prepareFallback(
  sourceLanguage: string,
  targetLanguage: string,
  onProgress?: ProgressListener,
): Promise<boolean> {
  const models = await fallbackModels(sourceLanguage, targetLanguage);
  if (!models?.length) return false;

  const listener = onProgress ? (progress: TitleTranslationProgress) => onProgress(progress) : null;
  if (listener) fallbackProgressListeners.add(listener);
  onProgress?.({ stage: "preparing", progress: 0 });
  try {
    // Loading the pipeline downloads the model during the explicit preparation
    // action. Transformers.js stores the model in the browser cache for reuse.
    for (const model of models) {
      if (!await getFallbackRuntime(model)) {
        onProgress?.({
          stage: "failed",
          progress: null,
          error: fallbackRuntimeErrors.get(model),
        });
        return false;
      }
      fallbackModelsReady.add(model);
    }
    onProgress?.({ stage: "ready", progress: 100 });
    return true;
  } catch {
    onProgress?.({ stage: "failed", progress: null });
    return false;
  } finally {
    if (listener) fallbackProgressListeners.delete(listener);
  }
}

async function fallbackTranslatorFor(sourceLanguage: string, targetLanguage: string): Promise<TranslatorInstance | null> {
  const key = pairKey(baseLanguage(sourceLanguage), baseLanguage(targetLanguage));
  const cached = fallbackTranslators.get(key);
  if (cached) return cached;

  const created = (async () => {
    const models = fallbackModels(sourceLanguage, targetLanguage);
    if (!models?.length) return null;
    const runtimes: LocalTranslatorPipeline[] = [];
    for (const model of models) {
      const runtime = await getFallbackRuntime(model);
      if (!runtime) return null;
      runtimes.push(runtime);
    }
    return {
      translate: async (text: string) => {
        let translatedText = text;
        for (const runtime of runtimes) {
          const [response] = await runtime(
            translatedText,
            USE_MULTILINGUAL_MODEL
              ? { src_lang: baseLanguage(sourceLanguage), tgt_lang: baseLanguage(targetLanguage) }
              : undefined,
          );
          translatedText = response?.translation_text ?? "";
        }
        return translatedText;
      },
    } satisfies TranslatorInstance;
  })().catch(() => null);

  fallbackTranslators.set(key, created);
  return created;
}

async function nativeTranslatorFor(
  sourceLanguage: string,
  targetLanguage: string,
  onProgress?: ProgressListener,
): Promise<TranslatorInstance | null> {
  const key = pairKey(sourceLanguage, targetLanguage);
  if (!TranslatorApi || nativeUnavailable.has(key)) return null;
  try {
    const pair = { sourceLanguage, targetLanguage };
    if (await TranslatorApi.availability(pair) === "unavailable") {
      nativeUnavailable.add(key);
      return null;
    }
    onProgress?.({ stage: "preparing", progress: 0 });
    // 初回はモデルのダウンロードが要る。ユーザーの明示操作(翻訳トグル)から
    // 呼ばれるので、ここでのダウンロード開始はブラウザに許可される。
    const translator = await TranslatorApi.create(pair, {
      monitor: (monitor) => {
        monitor.addEventListener("downloadprogress", ({ loaded, total }) => {
          onProgress?.({
            stage: "downloading",
            progress: total > 0 ? (loaded / total) * 100 : null,
            loaded,
            total,
          });
        });
      },
    });
    onProgress?.({ stage: "ready", progress: 100 });
    return translator;
  } catch {
    nativeUnavailable.add(key);
    return null;
  }
}

function translatorFor(sourceLanguage: string, targetLanguage: string): Promise<TranslatorInstance | null> {
  const key = pairKey(sourceLanguage, targetLanguage);
  const cached = translators.get(key);
  if (cached) return cached;
  const created = (async () => {
    return (await nativeTranslatorFor(sourceLanguage, targetLanguage))
      ?? (await fallbackTranslatorFor(sourceLanguage, targetLanguage));
  })().catch(() => null);
  translators.set(key, created);
  return created;
}

export type TitleTranslationStatus = "installed" | "downloadable" | "unavailable";

// 言語ペアの準備状況。準備画面が状態を出すために使う
export async function titleTranslationStatus(
  sourceLanguage: string,
  targetLanguage: string,
): Promise<TitleTranslationStatus> {
  const key = pairKey(sourceLanguage, targetLanguage);
  if (TranslatorApi && !nativeUnavailable.has(key)) {
    try {
      const availability = await TranslatorApi.availability({ sourceLanguage, targetLanguage });
      if (availability === "available") return "installed";
      if (availability === "downloadable" || availability === "downloading") return "downloadable";
      nativeUnavailable.add(key);
    } catch {
      nativeUnavailable.add(key);
    }
  }
  return await fallbackStatus(sourceLanguage, targetLanguage);
}

// 言語モデルを取得する。標準APIのcreate()またはWASMパイプラインの生成が
// 取得を伴うので、生成できれば準備完了とみなす。一覧のスクロール中ではなく、
// 準備画面の明示操作から呼ぶ。
export async function prepareTitleTranslation(
  sourceLanguage: string,
  targetLanguage: string,
  onProgress?: ProgressListener,
): Promise<boolean> {
  const key = pairKey(sourceLanguage, targetLanguage);
  translators.delete(key);
  if (await nativeTranslatorFor(sourceLanguage, targetLanguage, onProgress)) return true;
  return await prepareFallback(sourceLanguage, targetLanguage, onProgress);
}

// 判定した原文言語が読める言語なら翻訳しない(SPEC/DATABASE.md の表示規則と同じ)。
function needsTranslation(source: string, targetLanguage: string, readableLanguages: string[]): boolean {
  const normalizedSource = baseLanguage(source);
  if (normalizedSource === baseLanguage(targetLanguage)) return false;
  return !readableLanguages.map(baseLanguage).includes(normalizedSource);
}

export interface TitleTranslationRequest {
  items: { id: number; title: string; sourceLanguage: string | null }[];
  targetLanguage: string;
  readableLanguages: string[];
  onTranslated: (id: number, title: string) => void;
}

export interface TitleTranslationOutcome {
  attempted: number;
  translated: number;
}

// 与えられたタイトルを表示言語へ翻訳し、確定したものから順に onTranslated へ返す。
// 1 件の失敗は握りつぶして原文のまま残す(全滅したかどうかは呼び出し側が判断する)。
export async function translateTitles({
  items,
  targetLanguage,
  readableLanguages,
  onTranslated,
}: TitleTranslationRequest): Promise<TitleTranslationOutcome> {
  const outcome: TitleTranslationOutcome = { attempted: 0, translated: 0 };
  if (!titleTranslationSupported) return outcome;

  for (const item of items) {
    const title = item.title.trim();
    if (!title) continue;

    const cacheKey = `${item.id}:${targetLanguage}`;
    const cached = translated.get(cacheKey);
    if (cached !== undefined) {
      onTranslated(item.id, cached);
      continue;
    }

    // 原文言語はサーバーが決めている。不明な記事は原文のまま出す
    const source = item.sourceLanguage;
    if (!source) continue;

    outcome.attempted++;
    try {
      if (!needsTranslation(source, targetLanguage, readableLanguages)) continue;

      let translator = await translatorFor(source, targetLanguage);
      if (!translator) continue;

      let result: string;
      try {
        result = (await translator.translate(title)).trim();
      } catch {
        // A native implementation can become unavailable after the capability
        // check (for example after a model download failure). Retry once with
        // the browser-independent local engine.
        nativeUnavailable.add(pairKey(source, targetLanguage));
        translators.delete(pairKey(source, targetLanguage));
        translator = await fallbackTranslatorFor(source, targetLanguage);
        if (!translator) continue;
        result = (await translator.translate(title)).trim();
      }
      if (!result || result === title) continue;
      translated.set(cacheKey, result);
      onTranslated(item.id, result);
      outcome.translated++;
    } catch {
      // このタイトルは原文のまま残す
    }
  }

  return outcome;
}
