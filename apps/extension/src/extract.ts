import { Readability } from "@mozilla/readability";

export interface ExtractResult {
  title: string;
  text: string;
  lang: string | null;
}

function detectLanguageFromText(text: string): string | null {
  const sample = text.slice(0, 1000);
  const cjk = sample.match(/[　-鿿豈-﫿]/g)?.length ?? 0;
  const hangul = sample.match(/[가-힯ᄀ-ᇿ]/g)?.length ?? 0;
  const latin = sample.match(/[a-zA-Z]/g)?.length ?? 0;
  const total = sample.length || 1;

  if (hangul / total > 0.1) return "ko";
  if (cjk / total > 0.1) {
    const hiragana = sample.match(/[぀-ゟ]/g)?.length ?? 0;
    const katakana = sample.match(/[゠-ヿ]/g)?.length ?? 0;
    return hiragana + katakana > 0 ? "ja" : "zh";
  }
  if (latin / total > 0.3) return "en";
  return null;
}

function resolveLanguage(
  readabilityLang: string | null | undefined,
  htmlLang: string | null,
  text: string,
): string | null {
  const fromReadability = readabilityLang?.trim().split("-")[0]?.toLowerCase();
  if (fromReadability && fromReadability.length >= 2) return fromReadability;

  const fromHtml = htmlLang?.trim().split("-")[0]?.toLowerCase();
  if (fromHtml && fromHtml.length >= 2) return fromHtml;

  return detectLanguageFromText(text);
}

export function extractArticleText(): ExtractResult | null {
  const clone = document.cloneNode(true) as Document;
  const htmlLang = document.documentElement.lang || null;

  const reader = new Readability(clone);
  const article = reader.parse();

  if (article?.textContent && article.textContent.trim().length > 100) {
    const text = article.textContent.trim();
    return {
      title: article.title?.trim() || document.title.trim(),
      text,
      lang: resolveLanguage(article.lang, htmlLang, text),
    };
  }

  return null;
}
