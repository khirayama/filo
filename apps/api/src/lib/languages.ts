// Languages the app can generate UI/listing translations into.
export const SUPPORTED_LANGUAGES = ["ja", "en", "zh", "ko", "es"] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

function normalizeLanguageCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const lower = value.trim().toLowerCase().replace(/_/g, "-");
  return lower || null;
}

const ISO639_3_TO_1: ReadonlyMap<string, string> = new Map([
  ["afr", "af"], ["amh", "am"], ["ara", "ar"], ["arb", "ar"], ["ben", "bn"], ["bul", "bg"],
  ["cat", "ca"], ["ces", "cs"], ["cze", "cs"], ["dan", "da"], ["deu", "de"], ["ger", "de"],
  ["ell", "el"], ["gre", "el"], ["eng", "en"], ["est", "et"], ["eus", "eu"], ["fas", "fa"],
  ["per", "fa"], ["fin", "fi"], ["fra", "fr"], ["fre", "fr"], ["glg", "gl"], ["heb", "he"],
  ["hin", "hi"], ["hrv", "hr"], ["hun", "hu"], ["ind", "id"], ["ita", "it"], ["jpn", "ja"],
  ["kor", "ko"], ["lit", "lt"], ["nld", "nl"], ["dut", "nl"], ["nor", "no"], ["pol", "pl"],
  ["por", "pt"], ["ron", "ro"], ["rum", "ro"], ["rus", "ru"], ["slk", "sk"], ["slo", "sk"],
  ["slv", "sl"], ["spa", "es"], ["swe", "sv"], ["tam", "ta"], ["tha", "th"], ["tur", "tr"],
  ["ukr", "uk"], ["vie", "vi"], ["zho", "zh"], ["chi", "zh"], ["cmn", "zh"],
]);

// AI source_lang values are normalized only for storage and client language
// selection; no local language inference is performed.
export function normalizeSourceLanguage(value: string | null | undefined): string | null {
  const lower = normalizeLanguageCode(value);
  if (!lower) return null;
  return ISO639_3_TO_1.get(lower) ?? (lower.startsWith("zh-") ? "zh" : lower.split("-")[0] ?? null);
}

export function isLikelyVerbatimProperNoun(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) return false;
  if (/[぀-ヿ一-鿿㐀-䶿]/.test(trimmed)) return false;
  if (/[0-9]/.test(trimmed)) return true;
  if (/[\/&#:._+\-]/.test(trimmed)) return true;
  if (/\b[A-Z]{2,}\b/.test(trimmed)) return true;
  if (/\b[A-Za-z]*[a-z][A-Z][A-Za-z]*\b/.test(trimmed)) return true;
  if (/\b[A-Z][a-z]+(?:[A-Z][A-Za-z]*)+\b/.test(trimmed)) return true;
  return false;
}

// Lightweight output sanity checks. Source-language decisions are made by AI;
// this only rejects an obviously incompatible target script.
export function matchesTargetLanguage(text: string, targetLang: SupportedLanguage): boolean {
  const counts = {
    kana: text.match(/[぀-ヿ]/g)?.length ?? 0,
    han: text.match(/[一-鿿㐀-䶿]/g)?.length ?? 0,
    hangul: text.match(/[가-힣ᄀ-ᇿ]/g)?.length ?? 0,
    cyrillic: text.match(/[Ѐ-ӿ]/g)?.length ?? 0,
    arabic: text.match(/[؀-ۿ]/g)?.length ?? 0,
  };
  if (targetLang === "ja") return counts.hangul < 2 && (counts.kana > 0 || counts.han > 0 || isLikelyVerbatimProperNoun(text));
  if (targetLang === "zh") return counts.hangul === 0 && counts.kana === 0 && counts.han >= 2;
  if (targetLang === "ko") return counts.hangul >= 2 && counts.kana === 0;
  if (counts.kana >= 2 || counts.hangul >= 2 || counts.han >= 2 || counts.cyrillic >= 4 || counts.arabic >= 4) return false;
  return true;
}

export function parseReadableLanguages(raw: string | null | undefined): SupportedLanguage[] {
  if (!raw) return ["ja"];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return ["ja"];
    return parsed.filter(isSupportedLanguage);
  } catch {
    return ["ja"];
  }
}
