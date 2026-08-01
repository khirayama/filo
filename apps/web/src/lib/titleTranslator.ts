// 一覧タイトルの端末内翻訳。ブラウザ組み込みの Translator API (Chrome / Edge 138+)
// だけを使い、翻訳エンジンは自前で持たない。翻訳結果はサーバーへ保存しない
// (SPEC/APP.md)。API が無いブラウザでは翻訳トグル自体を出さない。
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

const TranslatorApi = (
  globalThis as {
    Translator?: {
      availability(pair: LanguagePair): Promise<Availability>;
      create(pair: LanguagePair): Promise<TranslatorInstance>;
    };
  }
).Translator;

export const titleTranslationSupported = TranslatorApi != null;

// source -> target ごとに 1 インスタンス。生成にモデル取得が伴うので使い回す。
const translators = new Map<string, Promise<TranslatorInstance | null>>();
// セッション内だけのキャッシュ。端末内翻訳は十分速いので永続化しない。
const translated = new Map<string, string>();

function translatorFor(sourceLanguage: string, targetLanguage: string): Promise<TranslatorInstance | null> {
  const key = `${sourceLanguage}->${targetLanguage}`;
  const cached = translators.get(key);
  if (cached) return cached;
  const created = (async () => {
    if (!TranslatorApi) return null;
    const pair = { sourceLanguage, targetLanguage };
    // 対応していない言語ペアはここで落ちる。落ちたペアは原文のまま出す。
    if ((await TranslatorApi.availability(pair)) === "unavailable") return null;
    // 初回はモデルのダウンロードが要る。ユーザーの明示操作(翻訳トグル)から
    // 呼ばれるので、ここでのダウンロード開始はブラウザに許可される。
    return await TranslatorApi.create(pair);
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
  if (!TranslatorApi) return "unavailable";
  try {
    const availability = await TranslatorApi.availability({ sourceLanguage, targetLanguage });
    if (availability === "available") return "installed";
    if (availability === "unavailable") return "unavailable";
    return "downloadable";
  } catch {
    return "unavailable";
  }
}

// 言語モデルを取得する。create() が取得を伴うので、生成できれば準備完了とみなす。
// 一覧のスクロール中ではなく、準備画面の明示操作から呼ぶ。
export async function prepareTitleTranslation(
  sourceLanguage: string,
  targetLanguage: string,
): Promise<boolean> {
  if (!TranslatorApi) return false;
  const key = `${sourceLanguage}->${targetLanguage}`;
  translators.delete(key);
  const translator = await translatorFor(sourceLanguage, targetLanguage);
  return translator != null;
}

// 判定した原文言語が読める言語なら翻訳しない(SPEC/DATABASE.md の表示規則と同じ)。
function needsTranslation(source: string, targetLanguage: string, readableLanguages: string[]): boolean {
  if (source === targetLanguage) return false;
  return !readableLanguages.includes(source);
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

      const translator = await translatorFor(source, targetLanguage);
      if (!translator) continue;

      const result = (await translator.translate(title)).trim();
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
