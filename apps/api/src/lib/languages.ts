// Display languages the app supports. Title translation itself happens
// on-device, so this list only drives settings validation and the language the
// clients translate into.
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

// Normalizes a feed's declared language (RSS <language> / Atom xml:lang) into a
// bare ISO 639-1 code. It is a hint for read-aloud voice selection; clients that
// translate on-device run their own detection instead.
export function normalizeSourceLanguage(value: string | null | undefined): string | null {
  const lower = normalizeLanguageCode(value);
  if (!lower) return null;
  return ISO639_3_TO_1.get(lower) ?? (lower.startsWith("zh-") ? "zh" : lower.split("-")[0] ?? null);
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
