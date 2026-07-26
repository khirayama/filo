import type { Env } from "../env";
import {
  SUPPORTED_LANGUAGES,
  isLikelyVerbatimProperNoun,
  matchesTargetLanguage,
  normalizeSourceLanguage,
  type SupportedLanguage,
} from "./languages";
import { nowIso } from "./util";

const LANG_NAMES: Record<string, string> = {
  ja: "Japanese",
  en: "English",
  zh: "Chinese",
  es: "Spanish",
  ko: "Korean",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ru: "Russian",
  ar: "Arabic",
};

const DEFAULT_API_URL = "http://localhost:1234/v1";
const DEFAULT_MODEL = "google/gemma-4-12b-qat";

// Batches are packed as large as the per-request token window allows so a
// single LM Studio request can translate all target languages for each title.
// Measured on the local 12B model, a batch of 8 costs the same per title as a
// batch of 4 (generation is decode-bound, and prompt processing is a few
// seconds either way), so this stays small to keep one request's wall time —
// and the cost of losing it to a timeout — bounded.
export const BATCH_MAX_TITLES = 4;
const MAX_COMPLETION_TOKENS = 2500;

// A pending pair is attempted this many times (across drains) before it is
// recorded as an error row.
export const MAX_TRANSLATION_ATTEMPTS = 3;

// Pacing is off by default. LM Studio is a local server with no provider
// quota, so sleeping between batches is idle time on the machine that is
// already the bottleneck. Set TRANSLATION_TOKENS_PER_MINUTE (and optionally
// TRANSLATION_PACING_MS as a floor) when pointing the worker at a remote or
// capacity-limited OpenAI-compatible server.
const DEFAULT_TOKENS_PER_MINUTE = 0;
const DEFAULT_PACING_MS = 0;
const MAX_PACING_MS = 65_000;

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | Array<{ type?: string; text?: string }> };
  }>;
  usage?: { total_tokens?: number };
}

interface RepairCandidate {
  id: number;
  language: SupportedLanguage;
  candidate: string;
}

type ChatMessageContent = string | Array<{ type?: string; text?: string }> | undefined;

function extractMessageText(content: ChatMessageContent): string | null {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text!.trim())
    .filter(Boolean)
    .join("\n");
  return text || null;
}

// A title occupies one prompt line, so any tab or newline inside it would
// break the line format. Titles are stored unchanged; only the copy sent to
// the model is flattened.
function flattenTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// A translated title that contains a substantial fragment from an incompatible
// writing system is suspicious, but not automatically unusable: a proper noun
// or brand can legitimately survive translation. The caller may use this as a
// repair signal while still accepting the output if the repair does not improve
// it.
function isMixedScriptTranslationFailure(value: string, targetLang: SupportedLanguage): boolean {
  const hasKana = (value.match(/[぀-ヿ]/g)?.length ?? 0) >= 2;
  const hasHan = (value.match(/[一-鿿㐀-䶿]/g)?.length ?? 0) >= 2;
  const hasHangul = (value.match(/[가-힣ᄀ-ᇿ]/g)?.length ?? 0) >= 2;
  const hasCyrillic = (value.match(/[Ѐ-ӿ]/g)?.length ?? 0) >= 4;
  const hasArabic = (value.match(/[؀-ۿ]/g)?.length ?? 0) >= 4;

  switch (targetLang) {
    case "ja":
      return (hasKana || hasHan) && (hasHangul || hasCyrillic || hasArabic);
    case "zh":
      return hasHan && (hasKana || hasHangul || hasCyrillic || hasArabic);
    case "ko":
      return hasHangul && (hasKana || hasCyrillic || hasArabic);
    case "en":
    case "es":
      return /[A-Za-z]{3}/.test(value)
        && (hasKana || hasHan || hasHangul || hasCyrillic || hasArabic);
  }
}

interface ScriptCounts {
  latin: number;
  kana: number;
  han: number;
  hangul: number;
  cyrillic: number;
  arabic: number;
}

function scriptCounts(text: string): ScriptCounts {
  return {
    latin: text.match(/[A-Za-z]/g)?.length ?? 0,
    kana: text.match(/[぀-ヿ]/g)?.length ?? 0,
    han: text.match(/[一-鿿㐀-䶿]/g)?.length ?? 0,
    hangul: text.match(/[가-힣ᄀ-ᇿ]/g)?.length ?? 0,
    cyrillic: text.match(/[Ѐ-ӿ]/g)?.length ?? 0,
    arabic: text.match(/[؀-ۿ]/g)?.length ?? 0,
  };
}

// Strongest of the three "this does not look like the target language" signals:
// the output carries a script the target never uses, or carries none of the
// script the target needs. It buys one focused repair attempt and nothing more —
// no non-echo output is discarded on a language judgement.
//
// Identifying the language of a title is unreliable in exactly the cases this
// app sees most: a tech headline is mostly product names, versions, and digits,
// so a correct translation can leave only a particle or two of the target script
// behind ("2026-07-05의 JS: Deno 2.9, Vite 8.1, ES2026" is valid Korean with one
// Hangul character). Discarding on that signal costs a title its translation
// entirely; keeping it costs the user a title that reads oddly and is obviously
// wrong at a glance.
function isClearlyWrongScript(value: string, targetLang: SupportedLanguage): boolean {
  const counts = scriptCounts(value);
  switch (targetLang) {
    case "ja":
      return !isLikelyVerbatimProperNoun(value)
        && (
          counts.hangul >= 2
          || counts.cyrillic >= 4
          || counts.arabic >= 4
          || (counts.kana + counts.han === 0 && counts.latin >= 3)
        );
    case "zh":
      return counts.cyrillic >= 4
        || counts.arabic >= 4
        || (counts.hangul >= 4 && counts.han < 2)
        || (counts.kana >= 4 && counts.han < 2);
    case "ko":
      return counts.hangul < 2
        && (
          counts.cyrillic >= 4
          || counts.arabic >= 4
          || (counts.kana >= 4 && counts.han < 2)
          || (counts.latin >= 8 && counts.han === 0)
        );
    case "en":
    case "es":
      return counts.latin < 3
        && (
          counts.kana >= 4
          || counts.han >= 4
          || counts.hangul >= 4
          || counts.cyrillic >= 4
          || counts.arabic >= 4
        );
  }
}

export interface TranslationAssessment {
  // Whether the result can be shown to the user. Only an absent or untranslated
  // result is undisplayable; every warning is shown.
  displayable: boolean;
  // Whether one focused repair request is worthwhile before settling the pair.
  repairable: boolean;
  severity: "none" | "warning" | "error";
  reason: string | null;
}

// Decide what to do with one model output. Only two things are unusable: an
// empty result, and an echo of the source title that no rule can justify —
// both mean the model did not translate. Everything else is displayed, with a
// warning-level reason when it looks wrong, because a title shown oddly beats a
// title not shown at all.
export function assessTranslation(
  result: string,
  sourceTitle: string,
  targetLang: SupportedLanguage,
  sourceLang?: string | null,
): TranslationAssessment {
  const trimmed = result.trim();
  if (!trimmed) {
    return { displayable: false, repairable: false, severity: "error", reason: "empty output" };
  }

  if (trimmed === sourceTitle.trim()) {
    const normalizedSourceLang = normalizeSourceLanguage(sourceLang);
    if (normalizedSourceLang === "mixed" || normalizedSourceLang === "und") {
      return { displayable: false, repairable: true, severity: "error", reason: "untranslated echo from mixed or unknown source" };
    }
    // An echo is legitimate for a title already in the target language or a
    // title made up of a verbatim proper noun/brand.
    if (isLikelyVerbatimProperNoun(sourceTitle) || matchesTargetLanguage(sourceTitle, targetLang)) {
      return { displayable: true, repairable: false, severity: "none", reason: null };
    }
    // A normal source/target mismatch remains on the ordinary drain retry
    // path. Focused repair is reserved for a self-reported source language
    // that is itself incompatible, or for an explicitly mixed/unknown title.
    return {
      displayable: false,
      repairable: normalizedSourceLang === targetLang,
      severity: "error",
      reason: "untranslated echo",
    };
  }

  if (isClearlyWrongScript(trimmed, targetLang)) {
    return { displayable: true, repairable: true, severity: "warning", reason: "clearly wrong-language output" };
  }
  if (isMixedScriptTranslationFailure(trimmed, targetLang)) {
    return { displayable: true, repairable: true, severity: "warning", reason: "mixed-script output" };
  }
  if (!matchesTargetLanguage(trimmed, targetLang)) {
    return { displayable: true, repairable: false, severity: "warning", reason: "language heuristic uncertain" };
  }
  return { displayable: true, repairable: false, severity: "none", reason: null };
}

// Whether one output can be shown to the user at all. Warning-level results
// intentionally return true — see assessTranslation.
export function isDisplayableTranslation(
  result: string,
  sourceTitle: string,
  targetLang: SupportedLanguage,
  sourceLang?: string | null,
): boolean {
  return assessTranslation(result, sourceTitle, targetLang, sourceLang).displayable;
}

function forbiddenScriptFragments(value: string, targetLang: SupportedLanguage): string[] {
  const pattern = targetLang === "ja"
    ? /[가-힣ᄀ-ᇿЀ-ӿ؀-ۿ]+/g
    : targetLang === "zh"
      ? /[ぁ-ゖァ-ヺー]+|[가-힣ᄀ-ᇿ]+/g
      : targetLang === "ko"
        ? /[ぁ-ゖァ-ヺー]+|[Ѐ-ӿ]+|[؀-ۿ]+/g
        : /[぀-ヿ一-鿿㐀-䶿가-힣ᄀ-ᇿЀ-ӿ؀-ۿ]+/g;
  return [...new Set(value.match(pattern) ?? [])];
}

function joinEnglishList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export interface TranslationRequestItem {
  id: number;
  text: string;
}

// One call either yields translations keyed by input id, or fails as a whole
// with a human-readable reason. 429s are surfaced separately so the caller can
// reschedule instead of recording a content failure.
export interface TranslationCallOutcome {
  byId: Map<number, TranslationResult> | null;
  failureReason: string | null;
  rateLimited: boolean;
  retryAfterSeconds: number | null;
  // Tokens the request consumed (provider-reported, estimated when absent);
  // used to pace the next request against the per-minute token budget.
  tokensUsed: number;
}

export interface TranslationResult {
  sourceLang: string | null;
  translations: Partial<Record<SupportedLanguage, string>>;
}

// Rough token estimate covering both CJK (~1 token/char) and Latin
// (~0.3 tokens/char) text; used only when the provider omits usage data.
function estimateTokens(chars: number): number {
  return Math.ceil(chars / 2);
}

// A `#<id><TAB><code>` line opens the group for one title; every following
// `<lang><TAB><translation>` line belongs to it until the next header. Lines
// that match neither — prose, a code fence, a half-written final line — are
// skipped, which is what makes a truncated response degrade gracefully:
// complete groups are kept and the pairs after the cut simply stay pending.
//
// A header naming an id that was not requested closes the current group
// instead of opening one, so stray output can never be filed under the
// previous title.
function parseGroupedLines(
  raw: string,
  items: TranslationRequestItem[],
  targetLangs: SupportedLanguage[],
): Map<number, TranslationResult> {
  const byId = new Map<number, TranslationResult>();
  const titleById = new Map(items.map((item) => [item.id, item.text]));
  let current: TranslationResult | null = null;

  for (const line of raw.split("\n")) {
    const header = line.match(/^\s*#\s*(\d+)\s*\t\s*([A-Za-z][A-Za-z-]{1,7})\s*$/);
    if (header) {
      const id = Number(header[1]);
      if (!titleById.has(id)) {
        current = null;
        continue;
      }
      current = byId.get(id) ?? { sourceLang: null, translations: {} };
      current.sourceLang = normalizeSourceLanguage(header[2]);
      byId.set(id, current);
      // The model omits a normal title's own language rather than echoing the
      // title back. For `mixed`/`und`, every target must be emitted explicitly,
      // so never restore the original title for those self-reported sources.
      const sourceLang = current.sourceLang;
      if (
        sourceLang
        && sourceLang !== "mixed"
        && sourceLang !== "und"
        && (targetLangs as readonly string[]).includes(sourceLang)
      ) {
        current.translations[sourceLang as SupportedLanguage] = titleById.get(id)!;
      }
      continue;
    }
    const entry = line.match(/^\s*([A-Za-z]{2})\t(.*)$/);
    if (!entry || !current) continue;
    const lang = entry[1]!.toLowerCase() as SupportedLanguage;
    const value = entry[2]!.trim();
    if (value && targetLangs.includes(lang)) current.translations[lang] = value;
  }
  return byId;
}

// The batch prompt. The output format is chosen so generation — the whole cost
// of a request on a local model — stays minimal: the id is written once per
// title instead of once per language, and the title's own language is omitted
// rather than echoed back verbatim. The worked example at the end is what makes
// the model comply; without it these same instructions yield uppercase language
// codes and echoed titles.
function systemPrompt(targetLangs: SupportedLanguage[]): string {
  const targetNames = targetLangs.map((lang) => LANG_NAMES[lang] ?? lang);
  return [
    "You translate article titles into several languages.",
    "Input: one title per line, formatted as the id, a tab, then the title.",
    "For each input title output a header line: `#`, the id, a tab, and the lowercase ISO 639-1 code of the language the title itself is written in. If the title contains multiple languages or writing systems, use `mixed`; if the source language cannot be determined, use `und`. For a normal single-language title, follow the header with one line per requested target language other than the title's own language. For `mixed` or `und`, output one line for every requested target language.",
    "Output those lines and nothing else: no JSON, markdown, blank lines, or commentary.",
    `Translate naturally and concisely into ${joinEnglishList(targetNames)}. Keep only official English brand names, English acronyms, model codes, URLs, and numbers unchanged when appropriate.`,
    "Treat quotation marks such as 「」, 『』, “”, and \"\" as delimiters, not as a reason to copy the enclosed text.",
    "Translate quoted product names, campaign names, event names, feature names, place names, and all descriptive parts of names into the requested language. Quoted names are not an exception: translate them strictly and do not copy them unchanged.",
    "For a non-English proper name with no known local-language form, paraphrase its meaning naturally; if that is not practical, use an English rendering rather than copying the original Japanese, Chinese, Korean, Cyrillic, or Arabic script.",
    "Do not mix writing systems. Keep each translation in its requested language and writing system: never leave Japanese kana, Korean characters, Chinese characters, Cyrillic, or Arabic from the source in another target language. The only exceptions are the explicitly allowed English brands, English acronyms, model codes, URLs, and numbers.",
    "",
    "Example — for the input line `7\tApple annonce un nouveau Mac` with target languages `fr ja en`, output exactly:",
    "#7\tfr",
    "ja\tAppleが新しいMacを発表",
    "en\tApple announces a new Mac",
  ].join("\n");
}

function titleLines(items: TranslationRequestItem[]): string[] {
  return items.map((item) => `${item.id}\t${flattenTitle(item.text)}`);
}

function batchPrompt(items: TranslationRequestItem[], targetLangs: SupportedLanguage[]): string {
  return [`Target languages: ${targetLangs.join(" ")}`, ...titleLines(items)].join("\n");
}

function completionTokenBudget(items: TranslationRequestItem[], targetLangs: SupportedLanguage[]): number {
  const inputChars = items.reduce((sum, item) => sum + item.text.length, 0);
  return Math.min(MAX_COMPLETION_TOKENS, Math.max(512, Math.ceil(inputChars * targetLangs.length * 2) + 512));
}

interface ModelRequest {
  system: string;
  prompt: string;
  maxTokens: number;
  // What the answer is parsed against — narrowed to the affected pairs on a repair.
  items: TranslationRequestItem[];
  targetLangs: SupportedLanguage[];
}

// One round trip to the model. `failed` carries whether asking again could
// plausibly help: a malformed or empty answer is worth one more request, an
// HTTP error is not.
type ModelResponse =
  | { kind: "parsed"; byId: Map<number, TranslationResult>; complete: boolean; tokensUsed: number }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "failed"; reason: string; retryable: boolean; tokensUsed: number };

async function requestTranslations(env: Env, request: ModelRequest): Promise<ModelResponse> {
  const baseUrl = (env.LM_STUDIO_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");
  const body = {
    model: env.TRANSLATION_MODEL ?? DEFAULT_MODEL,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.prompt },
    ],
    temperature: 0,
    max_tokens: request.maxTokens,
    // Reasoning is disabled: translation needs a direct answer, and on a 12B
    // model the chain-of-thought is by far the largest share of generated
    // tokens (measured ~430 reasoning tokens vs ~20 answer tokens for a
    // single title). LM Studio accepts the OpenAI reasoning-effort enum;
    // "none" turns it off for models that support the parameter.
    reasoning_effort: "none",
    // The output shape is prompted, not enforced with response_format. Strict
    // json_schema decoding on the local Gemma engine is markedly slower
    // (constrained sampling) and intermittently aborts the request with a
    // "peg-gemma4 format" engine error, failing the whole batch. The line
    // parser tolerates prose and truncation, so plain text output is both
    // faster and more robust. Vision is off (text-only content); tools are off
    // (field omitted).
  };

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // LM Studio needs no authentication by default. The key stays optional
        // so the same worker serves local and auth-enabled OpenAI-compatible
        // servers alike.
        ...(env.LM_STUDIO_API_KEY ? { Authorization: `Bearer ${env.LM_STUDIO_API_KEY}` } : {}),
      },
      body: JSON.stringify(body),
      // A full batch normally takes tens of seconds, but the same request was
      // measured at 108s when the machine was thermally throttled or contending
      // for the GPU. Aborting there would throw away a nearly complete
      // generation and then pay for it again on retry, so the timeout is set
      // well clear of the observed worst case.
      signal: AbortSignal.timeout(240_000),
    });
  } catch (error) {
    const reason = `request failed: ${error instanceof Error ? error.message : String(error)}`;
    console.log(`[translate] API exception: ${reason}`);
    return { kind: "failed", reason, retryable: true, tokensUsed: 0 };
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") || "60");
    console.log(`[translate] 429 rate limited, retry-after=${retryAfter}s`);
    return { kind: "rate_limited", retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : 60 };
  }
  if (!res.ok) {
    const detail = await readErrorDetail(res);
    console.log(`[translate] API error ${res.status}: ${detail}`);
    return { kind: "failed", reason: `API error ${res.status}: ${detail}`, retryable: false, tokensUsed: 0 };
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const choice = data.choices?.[0];
  const finishReason = choice?.finish_reason ?? null;
  const raw = extractMessageText(choice?.message?.content);
  const tokensUsed = data.usage?.total_tokens
    ?? estimateTokens(request.system.length + request.prompt.length + (raw?.length ?? 0));

  if (!raw) {
    console.log("[translate] API returned empty result");
    return { kind: "failed", reason: "model returned an empty completion", retryable: true, tokensUsed };
  }

  // A completion cut off by the token limit ends mid-line, and half a
  // translation still parses as a short but plausible one. Drop the trailing
  // line so a truncated title is left pending for the next drain instead of
  // being stored as a mangled translation.
  const usable = finishReason === "length" ? raw.slice(0, raw.lastIndexOf("\n") + 1) : raw;
  const byId = parseGroupedLines(usable, request.items, request.targetLangs);
  if (byId.size === 0) {
    console.log(`[translate] failed to parse batch response (finish_reason=${finishReason ?? "unknown"})`);
    return {
      kind: "failed",
      reason: finishReason === "length"
        ? "model response was truncated before any complete entry"
        : "model response did not follow the output format",
      retryable: true,
      tokensUsed,
    };
  }

  const complete = byId.size >= request.items.length;
  if (!complete) {
    console.log(`[translate] recovered a partial batch response (entries=${byId.size}/${request.items.length})`);
  }
  return { kind: "parsed", byId, complete, tokensUsed };
}

async function readErrorDetail(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  try {
    return (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body;
  } catch {
    return body.slice(0, 200);
  }
}

const FORMAT_RETRY_INSTRUCTION =
  "The previous response did not follow the output format. Emit only `#<id><tab><language code>` header lines followed by `<language code><tab><translation>` lines; no JSON, markdown, or commentary.";

// Two requests at most to get one parseable answer for the batch: an answer
// that ignores the output format buys a single retry with a sharper
// instruction, and nothing more — requests are the scarce resource.
const FORMAT_ATTEMPTS = 2;
// Focused repairs of suspect pairs, after a parseable answer is in hand. Two,
// because the first repair can repeat the same quoted source-language fragment.
const REPAIR_ROUNDS = 2;

// Pairs whose output is worth one focused re-request. Assessed against the
// accumulated result, so a pair already fixed by an earlier round drops out.
function repairCandidates(
  byId: Map<number, TranslationResult>,
  items: TranslationRequestItem[],
  targetLangs: SupportedLanguage[],
): RepairCandidate[] {
  return items.flatMap((item) => {
    const result = byId.get(item.id);
    if (!result) return [];
    return targetLangs.flatMap((language) => {
      const candidate = result.translations[language];
      if (typeof candidate !== "string") return [];
      const assessment = assessTranslation(candidate, item.text, language, result.sourceLang);
      return assessment.repairable ? [{ id: item.id, language, candidate }] : [];
    });
  });
}

function repairRuleFor(language: SupportedLanguage): string {
  switch (language) {
    case "ja":
      return "Japanese must not contain Korean, Cyrillic, or Arabic text";
    case "zh":
      return "Chinese must not contain Japanese kana or Korean text";
    case "ko":
      return "Korean must not contain any Hiragana or Katakana; translate ordinary Japanese words and product nouns instead of copying their kana (for example, 段ボール means 골판지)";
    case "en":
      return "English must not contain Chinese, Japanese, or Korean text";
    case "es":
      return "Spanish must not contain Chinese, Japanese, or Korean text";
  }
}

// Ask again for the affected pairs only. The bad candidate is never repeated
// back to the model, but its incompatible script fragments are listed
// explicitly so it knows exactly what has to be translated.
function repairRequest(
  system: string,
  maxTokens: number,
  items: TranslationRequestItem[],
  targetLangs: SupportedLanguage[],
  candidates: RepairCandidate[],
  isRetryOfRepair: boolean,
): ModelRequest {
  const languages = [...new Set(candidates.map((candidate) => candidate.language))];
  const fragments = [...new Set(candidates.flatMap((candidate) =>
    forbiddenScriptFragments(candidate.candidate, candidate.language),
  ))];
  const quotedFragments = fragments.map((fragment) => JSON.stringify(fragment)).join(", ");
  const affectedIds = new Set(candidates.map((candidate) => candidate.id));
  const affectedItems = items.filter((item) => affectedIds.has(item.id));
  const affectedLangs = targetLangs.filter((lang) => languages.includes(lang));

  const instruction = [
    isRetryOfRepair
      ? "The previous repair was rejected again by a strict writing-system validator. Generate a fresh translation; do not repeat the previous repair."
      : "The previous completion was rejected by a strict writing-system validator.",
    "Regenerate these affected translations only, from the original titles; do not copy any previous translation.",
    fragments.length > 0
      ? `These exact source-script fragments are forbidden in the repaired output: ${quotedFragments}. Translate their meaning into the target language, even when they occur inside quotation marks.`
      : "Do not copy incompatible source-script fragments, even when they occur inside quotation marks.",
    languages.map(repairRuleFor).join(". "),
  ].join(" ");

  return {
    system: `${system} ${instruction}`,
    prompt: [
      `Target languages: ${affectedLangs.join(" ")}`,
      "Regenerate these affected translations only, naturally from the original titles, keeping the output format unchanged.",
      fragments.length > 0 ? `Forbidden source-script fragments: ${quotedFragments}` : "",
      ...candidates.map((candidate) => `- id ${candidate.id}, target ${candidate.language}`),
      "",
      ...titleLines(affectedItems),
    ].join("\n"),
    maxTokens,
    items: affectedItems,
    targetLangs: affectedLangs,
  };
}

// Adopt a repaired pair only when the new value is displayable. The first
// answer stays authoritative for every pair that was not repaired.
function applyRepairs(
  base: Map<number, TranslationResult>,
  repaired: Map<number, TranslationResult>,
  candidates: RepairCandidate[],
  items: TranslationRequestItem[],
): void {
  for (const candidate of candidates) {
    const value = repaired.get(candidate.id)?.translations[candidate.language];
    const item = items.find((entry) => entry.id === candidate.id);
    const target = base.get(candidate.id);
    if (!value || !item || !target) continue;
    const sourceLang = repaired.get(candidate.id)?.sourceLang;
    if (isDisplayableTranslation(value, item.text, candidate.language, sourceLang)) {
      target.translations[candidate.language] = value;
    }
  }
}

// Translate a batch of titles into the given target languages.
//
// Two phases, each with its own small request budget: first get one parseable
// answer for the batch, then re-request only the pairs that come back in an
// incompatible writing system. Once an answer is in hand it is never thrown
// away — a failing repair leaves the original result standing, because its
// generation has already been paid for.
export async function callTranslationApi(
  env: Env,
  items: TranslationRequestItem[],
  targetLangs: SupportedLanguage[],
): Promise<TranslationCallOutcome> {
  const system = systemPrompt(targetLangs);
  const prompt = batchPrompt(items, targetLangs);
  const maxTokens = completionTokenBudget(items, targetLangs);

  let tokensUsed = 0;
  let base: { byId: Map<number, TranslationResult>; complete: boolean } | null = null;
  let lastReason = "exhausted retries";

  for (let attempt = 0; attempt < FORMAT_ATTEMPTS && !base; attempt++) {
    const retrying = attempt > 0;
    const response = await requestTranslations(env, {
      system: retrying ? `${system} ${FORMAT_RETRY_INSTRUCTION}` : system,
      prompt: retrying ? `${FORMAT_RETRY_INSTRUCTION}\n${prompt}` : prompt,
      maxTokens,
      items,
      targetLangs,
    });
    if (response.kind === "rate_limited") {
      return {
        byId: null,
        failureReason: "rate limited",
        rateLimited: true,
        retryAfterSeconds: response.retryAfterSeconds,
        tokensUsed,
      };
    }
    tokensUsed += response.tokensUsed;
    if (response.kind === "failed") {
      lastReason = response.reason;
      if (!response.retryable) break;
      continue;
    }
    base = { byId: response.byId, complete: response.complete };
  }

  if (!base) {
    return {
      byId: null,
      failureReason: lastReason.slice(0, 200),
      rateLimited: false,
      retryAfterSeconds: null,
      tokensUsed,
    };
  }

  for (let round = 0; round < REPAIR_ROUNDS; round++) {
    const candidates = repairCandidates(base.byId, items, targetLangs);
    if (candidates.length === 0) break;
    console.log("[translate] retrying wrong-script translation output");
    const response = await requestTranslations(
      env,
      repairRequest(system, maxTokens, items, targetLangs, candidates, round > 0),
    );
    // Anything other than a usable answer ends the repair phase; the result
    // gathered so far is kept rather than discarded.
    if (response.kind !== "parsed") break;
    tokensUsed += response.tokensUsed;
    applyRepairs(base.byId, response.byId, candidates, items);
  }

  return {
    byId: base.byId,
    failureReason: base.complete ? null : "model response was incomplete; recovered complete entries",
    rateLimited: false,
    retryAfterSeconds: null,
    tokensUsed,
  };
}

// Milliseconds to wait after a request so the sustained token rate stays under
// the provider's per-minute budget.
export function pacingMsForTokens(env: Env, tokensUsed: number): number {
  const tokensPerMinute = env.TRANSLATION_TOKENS_PER_MINUTE != null
    ? Number(env.TRANSLATION_TOKENS_PER_MINUTE)
    : DEFAULT_TOKENS_PER_MINUTE;
  const floor = env.TRANSLATION_PACING_MS != null ? Number(env.TRANSLATION_PACING_MS) : DEFAULT_PACING_MS;
  if (!Number.isFinite(tokensPerMinute) || tokensPerMinute <= 0) return floor;
  const paced = Math.ceil((tokensUsed / tokensPerMinute) * 60_000);
  return Math.min(Math.max(paced, floor), MAX_PACING_MS);
}

function chunked<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

export function supportedLanguagesCte(): string {
  return `langs(lang) AS (VALUES ${SUPPORTED_LANGUAGES.map((lang) => `('${lang}')`).join(", ")})`;
}

// Insert a pending row for every missing (article, language) pair of the given
// feeds. Source language is deliberately not consulted: the AI receives every
// supported target and reports source_lang per article.
export async function enqueuePendingTranslations(env: Env, feedIds: number[]): Promise<number> {
  const now = nowIso();
  let enqueued = 0;
  for (const feedChunk of chunked(feedIds, 60)) {
    const placeholders = feedChunk.map(() => "?").join(", ");
    const inserted = await env.DB.prepare(
      `WITH ${supportedLanguagesCte()}
       INSERT INTO article_listing_translations (article_id, language, status, attempt_count, created_at, updated_at)
       SELECT a.id, langs.lang, 'pending', 0, ?, ?
       FROM articles a
       CROSS JOIN langs
       WHERE a.feed_id IN (${placeholders})
         AND a.title IS NOT NULL AND a.title != ''
         AND NOT EXISTS (
           SELECT 1 FROM article_listing_translations t
           WHERE t.article_id = a.id AND t.language = langs.lang
         )`,
    )
      .bind(now, now, ...feedChunk)
      .run();
    const retried = await env.DB.prepare(
      `UPDATE article_listing_translations
       SET status = 'pending', attempt_count = 0, error_message = NULL, updated_at = ?
       WHERE status = 'error'
         AND article_id IN (SELECT id FROM articles WHERE feed_id IN (${placeholders}))`,
    )
      .bind(now, ...feedChunk)
      .run();
    enqueued += (inserted.meta.changes ?? 0) + (retried.meta.changes ?? 0);
  }
  return enqueued;
}

export async function countPendingTranslations(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM article_listing_translations WHERE status = 'pending'",
  ).first<{ n: number }>();
  return row?.n ?? 0;
}
