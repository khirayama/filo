import { francAll } from "franc-min";
import { normalizeSourceLanguage } from "./languages";

// 原文言語の判定。fetch 時に feed 単位・記事単位で決め、`feeds.language` と
// `articles.source_language` に保存する。クライアントはこの値を使い、端末側では
// 統計的な判定を行わない（判定器が 3 つあると挙動が揃わないため）。
//
// 判定精度はほぼ文字数で決まる。franc-min を実測した結果:
//
//   17 字のタイトル            -> nld(オランダ語) に誤判定
//   タイトル単独 (33〜47 字)   -> 英語 10 件中 8 件正解
//   タイトル+説明文 (141〜191) -> 8 言語 8/8 正解
//   フィード全体の連結 (208〜) -> 常に正解
//
// 2 位とのスコア差(margin)は確信度に使えない。英語 10 件連結でも 0.080 しかなく、
// スペイン語 1 件の 0.259 より小さい。margin は言語同士の近さを表すだけで、
// 確信度とは相関しない。よって**長さだけを信号として使う**。

// この長さ以上のテキストなら franc の結果を信用する（上記の実測より）
export const RELIABLE_TEXT_LENGTH = 140;

// フィード言語を判定するために連結するテキストの上限。長くしても精度は上がらない
const FEED_SAMPLE_LIMIT = 4000;

export type LanguageConfidence = "high" | "low";

export interface DetectedLanguage {
  // ISO 639-1。判定できなければ null
  language: string | null;
  // high は文字体系で確定したか、十分な長さのテキストから判定できた場合。
  // 数値ではなく 2 値にしてある（実測できるのは長さの効果だけで、
  // それらしい小数を作っても根拠が無い）
  confidence: LanguageConfidence;
}

// 文字体系。記事とフィードで違えば「別言語かもしれない」と疑う手がかりになる。
export type ScriptClass = "kana" | "hangul" | "han" | "latin" | "cyrillic" | "other" | "none";

const KANA = /[ぁ-ゟ゠-ヺー-ヿㇰ-ㇿｦ-ﾝ]/u;
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/u;
const HAN = /[㐀-䶿一-鿿豈-﫿]/u;
const LATIN = /\p{Script=Latin}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;

// 仮名とハングルは日本語・韓国語だけが使う文字なので、1 文字でもあれば確定できる。
// 漢字だけは日本語と中国語のどちらもありえるので確定しない。
export function scriptClassOf(text: string): ScriptClass {
  if (!text.trim()) return "none";
  if (KANA.test(text)) return "kana";
  if (HANGUL.test(text)) return "hangul";
  if (HAN.test(text)) return "han";
  if (CYRILLIC.test(text)) return "cyrillic";
  if (LATIN.test(text)) return "latin";
  return "other";
}

// その言語が使う文字体系。フィード言語と記事の文字体系を比べるために使う
export function scriptClassOfLanguage(language: string | null): ScriptClass {
  if (!language) return "none";
  const base = language.split("-")[0];
  if (base === "ja") return "kana";
  if (base === "ko") return "hangul";
  if (base === "zh") return "han";
  if (base === "ru" || base === "uk" || base === "bg") return "cyrillic";
  return "latin";
}

// franc に委ねる。短いテキストは信用できないので confidence で区別する
function detectByProfile(text: string): DetectedLanguage {
  const trimmed = text.trim();
  const [best] = francAll(trimmed, { minLength: 10 });
  const language = best ? normalizeSourceLanguage(best[0]) : null;
  if (!language || language === "und") return { language: null, confidence: "low" };
  return {
    language,
    confidence: trimmed.length >= RELIABLE_TEXT_LENGTH ? "high" : "low",
  };
}

// 単体のテキストから判定する。文字体系で確定できるものは franc を呼ばない
export function detectLanguage(text: string): DetectedLanguage {
  const script = scriptClassOf(text);
  if (script === "kana") return { language: "ja", confidence: "high" };
  if (script === "hangul") return { language: "ko", confidence: "high" };
  if (script === "none") return { language: null, confidence: "low" };
  return detectByProfile(text);
}

// フィードの言語。発行者の申告が最も強く、無ければ全 item を連結した長文から判定する。
// 単独のタイトルでは誤判定するが、連結すれば実測で常に正解する。
export function detectFeedLanguage(
  declared: string | null | undefined,
  items: { title: string; summary?: string | null }[],
): DetectedLanguage {
  const normalizedDeclared = normalizeSourceLanguage(declared);
  if (normalizedDeclared) return { language: normalizedDeclared, confidence: "high" };

  let sample = "";
  for (const item of items) {
    if (sample.length >= FEED_SAMPLE_LIMIT) break;
    sample += `${item.title} ${item.summary ?? ""}\n`;
  }
  return detectLanguage(sample.slice(0, FEED_SAMPLE_LIMIT));
}

// 記事の言語。フィード言語を事前確率とし、**明確に違うときだけ**上書きする。
//
// 記事単位のテキストは短く、franc をそのまま信じると英語のタイトルがオランダ語や
// ドイツ語になる（実測 8/10）。そこで上書きは次の場合に限る:
//
//   1. 仮名・ハングルがある     -> 文字体系で確定できるので即上書き
//   2. 文字体系がフィードと違う -> 疑わしいので franc を引くが、
//                                 十分な長さ(140字)があるときだけ採用する
//
// それ以外はフィード言語をそのまま使う。同じ文字体系のなかで言語を当て直そうと
// すると、材料不足のまま誤判定を増やすだけになる。
export function detectArticleLanguage(text: string, feedLanguage: string | null): DetectedLanguage {
  const script = scriptClassOf(text);
  if (script === "none") return { language: feedLanguage, confidence: "low" };
  if (script === "kana") return { language: "ja", confidence: "high" };
  if (script === "hangul") return { language: "ko", confidence: "high" };

  const feedScript = scriptClassOfLanguage(feedLanguage);
  if (feedLanguage && script === feedScript) {
    return { language: feedLanguage, confidence: "high" };
  }
  // 漢字だけの記事は、フィードが日本語なら日本語のままにする（日本語にも漢字だけの
  // タイトルはある）。フィードが中国語なら中国語。判断材料がそれしかない。
  if (script === "han" && feedScript === "kana") {
    return { language: feedLanguage, confidence: "low" };
  }

  const detected = detectByProfile(text);
  if (detected.confidence === "high" && scriptClassOfLanguage(detected.language) === script) {
    return detected;
  }
  // 文字体系はフィードと違うが、どの言語かを言い切れない。誤った原文言語から
  // 翻訳するより、分からないままにする方が害が小さい
  return { language: null, confidence: "low" };
}
