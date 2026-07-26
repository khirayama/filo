import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { runTranslateDrain } from "../src/jobs/translateDrain";
import { matchesTargetLanguage, normalizeSourceLanguage, SUPPORTED_LANGUAGES } from "../src/lib/languages";
import { enqueuePendingTranslations, isDisplayableTranslation } from "../src/lib/translate";

interface FakeArticle {
  id: number;
  feed_id: number;
  title: string | null;
  // What the fake model reports as the title's language. The drain writes it
  // back to `source_language`, which starts out unknown like in production.
  seed_source_language: string | null;
  source_language?: string | null;
}

interface FakeTranslation {
  article_id: number;
  language: string;
  status: string;
  title: string | null;
  attempt_count: number;
  error_message: string | null;
  processing_at?: string | null;
}

// In-memory stand-in for the two tables the translation pipeline touches.
// Statements are dispatched on distinctive SQL fragments and mutate the same
// state a real D1 would, so tests can assert on end-state rather than on the
// exact statement sequence.
class FakeDb {
  constructor(
    public articles: FakeArticle[],
    public translations: FakeTranslation[] = [],
  ) {}

  translation(articleId: number, language: string): FakeTranslation | undefined {
    return this.translations.find((row) => row.article_id === articleId && row.language === language);
  }

  sourceLanguage(articleId: number): string | null | undefined {
    return this.articles.find((a) => a.id === articleId)?.source_language;
  }

  prepare(sql: string) {
    return new FakePreparedStatement(this, sql);
  }

  async batch(statements: FakePreparedStatement[]): Promise<Array<{ meta: { changes: number } }>> {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  async all<T>(sql: string, values: unknown[]): Promise<{ results: T[] }> {
    if (sql.includes("WHERE t.status = 'pending'")) {
      const rows = this.translations
        .filter((row) => row.status === "pending")
        .map((row) => {
          const article = this.articles.find((a) => a.id === row.article_id)!;
          return {
            article_id: row.article_id,
            language: row.language,
            attempt_count: row.attempt_count,
            title: article.title,
          };
        })
        .sort((a, b) => b.article_id - a.article_id)
        .slice(0, 200);
      return { results: rows as T[] };
    }
    throw new Error(`Unexpected all() SQL: ${sql}`);
  }

  async first<T>(sql: string, _values: unknown[]): Promise<T | null> {
    if (sql.includes("COUNT(*) AS n") && sql.includes("status = 'pending'")) {
      return { n: this.translations.filter((row) => row.status === "pending").length } as T;
    }
    throw new Error(`Unexpected first() SQL: ${sql}`);
  }

  run(sql: string, values: unknown[]): { meta: { changes: number } } {
    if (sql.includes("INSERT INTO article_listing_translations") && sql.includes("CROSS JOIN langs")) {
      const feedIds = new Set(values.slice(2) as number[]);
      let changes = 0;
      for (const article of this.articles) {
        if (!feedIds.has(article.feed_id) || !article.title) continue;
        for (const lang of SUPPORTED_LANGUAGES) {
          if (this.translation(article.id, lang)) continue;
          this.translations.push({
            article_id: article.id,
            language: lang,
            status: "pending",
            title: null,
            attempt_count: 0,
            error_message: null,
          });
          changes++;
        }
      }
      return { meta: { changes } };
    }
    if (sql.includes("SET processing_at = NULL WHERE status = 'pending'")) {
      // drain-start clear of stale in-flight marks
      let changes = 0;
      for (const row of this.translations) {
        if (row.status === "pending" && row.processing_at) {
          row.processing_at = null;
          changes++;
        }
      }
      return { meta: { changes } };
    }
    if (sql.includes("SET processing_at = ?, updated_at = ?")) {
      const [processingAt, , articleId, language] = values as [string | null, string, number, string];
      const row = this.translation(articleId, language);
      if (row) row.processing_at = processingAt;
      return { meta: { changes: 1 } };
    }
    if (sql.includes("UPDATE articles SET source_language = ?")) {
      const [sourceLang, , articleId] = values as [string, string, number];
      const article = this.articles.find((a) => a.id === articleId);
      if (article) article.source_language = sourceLang;
      return { meta: { changes: 1 } };
    }
    if (sql.includes("SET status = 'pending', attempt_count = 0")) {
      const feedIds = new Set(values.slice(1) as number[]);
      let changes = 0;
      for (const row of this.translations) {
        const article = this.articles.find((a) => a.id === row.article_id);
        if (row.status === "error" && article && feedIds.has(article.feed_id)) {
          row.status = "pending";
          row.attempt_count = 0;
          row.error_message = null;
          changes++;
        }
      }
      return { meta: { changes } };
    }
    if (sql.includes("DELETE FROM article_listing_translations")) {
      const [articleId, language] = values as [number, string];
      this.translations = this.translations.filter(
        (row) => !(row.article_id === articleId && row.language === language),
      );
      return { meta: { changes: 1 } };
    }
    if (sql.includes("SET title = ?, status = 'ready'")) {
      const [title, , articleId, language] = values as [string, string, number, string];
      const row = this.translation(articleId, language);
      if (row) {
        row.title = title;
        row.status = "ready";
        row.attempt_count = 0;
        row.error_message = null;
        row.processing_at = null;
      }
      return { meta: { changes: 1 } };
    }
    if (sql.includes("SET attempt_count = ?, status = ?")) {
      const [attempts, status, errorMessage, , articleId, language] =
        values as [number, string, string, string, number, string];
      const row = this.translation(articleId, language);
      if (row) {
        row.attempt_count = attempts;
        row.status = status;
        row.error_message = errorMessage;
        row.processing_at = null;
      }
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unexpected run() SQL: ${sql}`);
  }
}

class FakePreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: FakeDb,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return this.db.first<T>(this.sql, this.values);
  }

  async all<T>(): Promise<{ results: T[] }> {
    return this.db.all<T>(this.sql, this.values);
  }

  async run(): Promise<{ meta: { changes: number } }> {
    return this.db.run(this.sql, this.values);
  }
}

function makeEnv(db: FakeDb): Env & { sentDrains: Array<{ delaySeconds?: number }> } {
  const sentDrains: Array<{ delaySeconds?: number }> = [];
  return {
    DB: db as unknown as D1Database,
    JOBS: {} as Env["JOBS"],
    TRANSLATE_JOBS: {
      send: async (_msg: unknown, options?: { delaySeconds?: number }) => {
        sentDrains.push({ delaySeconds: options?.delaySeconds });
      },
    } as unknown as Env["TRANSLATE_JOBS"],
    // The drain never arms the watchdog; a bare stub satisfies the type.
    TRANSLATION_WATCHDOG: {} as Env["TRANSLATION_WATCHDOG"],
    CLERK_SECRET_KEY: "test",
    CURSOR_SECRET: "secret",
    ADMIN_CLERK_USER_IDS: "",
    LM_STUDIO_API_URL: "http://lm-studio.test/v1",
    LM_STUDIO_API_KEY: "token",
    TRANSLATION_MODEL: "model",
    TRANSLATION_PACING_MS: "0",
    // effectively disables token pacing so tests never sleep
    TRANSLATION_TOKENS_PER_MINUTE: "1000000000",
    CRON_SECRET: "cron",
    sentDrains,
  };
}

describe("supported target languages", () => {
  it("keeps all app locales in the translation pipeline", () => {
    expect(SUPPORTED_LANGUAGES).toEqual(["ja", "en", "zh", "ko", "es"]);
    expect(matchesTargetLanguage("这是一个中文标题", "zh")).toBe(true);
    expect(matchesTargetLanguage("한국어로 번역된 제목입니다", "ko")).toBe(true);
    expect(matchesTargetLanguage("Este es un título traducido", "es")).toBe(true);
  });
});

describe("isDisplayableTranslation", () => {
  it("rejects an echo of the source title", () => {
    expect(isDisplayableTranslation("こんにちは世界", "こんにちは世界", "en")).toBe(false);
  });

  it("displays output that came back in the wrong language", () => {
    // A language judgement never discards a non-echo: it only asks for one
    // repair. Whatever survives the repair is shown rather than dropped.
    expect(isDisplayableTranslation("女性の吐き気の原因となっていた胃石", "元タイトル", "en")).toBe(true);
    expect(isDisplayableTranslation("The gallstone was dissolved", "元タイトル", "ja")).toBe(true);
  });

  it("displays a correct translation left mostly in product names and digits", () => {
    // JSer.info titles are almost entirely ASCII, so a correct translation can
    // leave a single character of the target script behind. A strict
    // target-script check would discard exactly this shape.
    expect(isDisplayableTranslation(
      "2026-07-05의 JS: Deno 2.9, Vite 8.1, ES2026",
      "2026-07-05のJS: Deno 2.9, Vite 8.1, ES2026",
      "ko",
      "ja",
    )).toBe(true);
  });

  it("accepts output in the target language", () => {
    expect(isDisplayableTranslation("The gallstone was dissolved by diet cola", "胃石をダイエットコーラで溶かした", "en")).toBe(true);
    expect(isDisplayableTranslation("胃石をダイエットコーラで溶かした事例", "The gallstone case", "ja")).toBe(true);
  });

  it("displays output that came back in an unrequested language", () => {
    // Korean text where English was requested: still a translation, still shown.
    expect(isDisplayableTranslation("여성의 메스꺼움의 원인", "女性の吐き気の原因", "en")).toBe(true);
  });

  it("accepts output with no detectable language (numbers, proper nouns)", () => {
    expect(isDisplayableTranslation("PhotoshopVIP 2026", "PhotoshopVIP 2026 特集", "en")).toBe(true);
  });

  it("accepts a usable translation when the script heuristic is uncertain", () => {
    // A Chinese translation may intentionally retain one Japanese place-name
    // character. This is a warning-level signal, not a display-blocking error.
    expect(isDisplayableTranslation(
      "白驹池｜北八ヶ岳森林中的美丽苔藓与红叶",
      "白駒池 | 北八ヶ岳森林中美丽的苔藓与红叶！",
      "zh",
      "ja",
    )).toBe(true);
  });

  it("accepts English translations that trigram detectors misread", () => {
    // Plausible English outputs for production titles. A trigram language
    // detector reads these as Luxembourgish/Norwegian/French/Scots/Danish/Dutch,
    // so they must not be judged on a detector's verdict.
    const outputs = [
      '"Apple AirTag 4-pack" now 23% off at 13,120 yen',
      '"UGREEN 16-Port Switching Hub" on sale for 5,824 yen',
      "EU General Court dismisses Apple's challenge to gatekeeper designation",
      "A record of creating an IAM user on AWS",
      "MIRA: an AI model that generates video in real time",
      "The moment you get home, the room is cool: a smart plug that controls your aircon",
      "15 recommended shoulder pouches for hiking in 2026",
      // Shared stopwords must not misclassify: "in"+"es" (ES2026) hit de,
      // romaji "no" plus the article "a" hit pt.
      "JS in 2026-04-06: TypeScript 6.0, ES2026 RC, axios supply chain attack",
      "Imaizumi opens 'Hibi no Udon Sanzo', a udon izakaya restaurant",
    ];
    for (const output of outputs) {
      expect(isDisplayableTranslation(output, "元の日本語タイトル", "en"), output).toBe(true);
    }
  });

  it("accepts an echo when the title is already in the target language", () => {
    // A Japanese-language article can carry an English title; translating it
    // ja→en correctly returns the title unchanged.
    expect(isDisplayableTranslation("Tuna", "Tuna", "en")).toBe(true);
    expect(isDisplayableTranslation("On Being Playful", "On Being Playful", "en")).toBe(true);
    expect(isDisplayableTranslation(
      "How to Write an Effective Software Design Document",
      "How to Write an Effective Software Design Document",
      "en",
    )).toBe(true);
  });

  it("accepts unchanged named entities and rejects plain echoes", () => {
    expect(isDisplayableTranslation("Google I/O 2026", "Google I/O 2026", "ja")).toBe(true);
    expect(isDisplayableTranslation("iPhone", "iPhone", "ja")).toBe(true);
    expect(isDisplayableTranslation("eBay", "eBay", "ja")).toBe(true);
    expect(isDisplayableTranslation("C++", "C++", "ja")).toBe(true);
    expect(isDisplayableTranslation("macOS", "macOS", "ja")).toBe(true);
    expect(isDisplayableTranslation("Hello", "Hello", "ja")).toBe(false);
  });
});

describe("enqueuePendingTranslations", () => {
  it("inserts a pending row for every missing pair and resets error rows", async () => {
    const db = new FakeDb(
      [
        { id: 1, feed_id: 7, title: "Hello", seed_source_language: "en" },
        { id: 2, feed_id: 7, title: "今日新闻", seed_source_language: "zh" },
        { id: 3, feed_id: 7, title: null, seed_source_language: "en" },
        { id: 4, feed_id: 7, title: "No source", seed_source_language: null },
        { id: 5, feed_id: 8, title: "Other feed", seed_source_language: "en" },
      ],
      [
        { article_id: 1, language: "ja", status: "error", title: null, attempt_count: 3, error_message: "boom" },
        { article_id: 2, language: "ja", status: "ready", title: "既訳", attempt_count: 0, error_message: null },
      ],
    );

    const enqueued = await enqueuePendingTranslations(makeEnv(db), [7]);

    // All five target languages are enqueued without source-language filtering.
    expect(enqueued).toBe(14);
    expect(db.translation(1, "ja")).toMatchObject({ status: "pending", attempt_count: 0, error_message: null });
    expect(db.translation(2, "en")).toMatchObject({ status: "pending" });
    expect(db.translation(2, "ja")).toMatchObject({ status: "ready", title: "既訳" });
    expect(db.translation(3, "ja")).toBeUndefined();
    expect(db.translation(4, "ja")).toMatchObject({ status: "pending" });
    expect(db.translation(5, "ja")).toBeUndefined();
  });
});

describe("runTranslateDrain", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Valid target-language strings, so results pass the output-language check.
  const VALID: Record<string, string> = { en: "english title", ja: "翻訳された題名", zh: "翻译后的标题", ko: "번역된 제목", es: "título traducido" };

  function promptOf(init?: RequestInit): string {
    const messages = (JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }).messages;
    return messages[messages.length - 1]!.content;
  }
  function systemOf(init?: RequestInit): string {
    const messages = (JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> }).messages;
    return messages.find((message) => message.role === "system")?.content ?? "";
  }
  // The prompt is a `Target languages:` header followed by one `id<TAB>title`
  // line per item. A retry prepends instructions, so both helpers locate the
  // header rather than assuming a fixed position.
  const HEADER = "Target languages:";
  function langsOf(prompt: string): string[] {
    const line = prompt.split("\n").find((l) => l.startsWith(HEADER)) ?? "";
    return line.slice(HEADER.length).trim().split(/\s+/).filter(Boolean);
  }
  function itemsOf(prompt: string): Array<{ id: number; text: string }> {
    const lines = prompt.split("\n");
    return lines
      .slice(lines.findIndex((l) => l.startsWith(HEADER)) + 1)
      .filter((line) => /^\d+\t/.test(line))
      .map((line) => {
        const [id, ...rest] = line.split("\t");
        return { id: Number(id), text: rest.join("\t") };
      });
  }
  function ok(content: string): Response {
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }
  // Reproduce what the model is asked to emit: a `#id<TAB>source` header per
  // title, then one line per requested target language other than the title's
  // own. valueFor returning null drops that language from the answer.
  function linesFor(
    items: Array<{ id: number; text: string }>,
    langs: string[],
    valueFor: (lang: string, text: string) => string | null,
    sourceLang: string,
  ): string[] {
    return items.flatMap((item) => [
      `#${item.id}\t${sourceLang}`,
      ...langs.flatMap((lang) => {
        if (lang === sourceLang) return [];
        const value = valueFor(lang, item.text);
        return value === null ? [] : [`${lang}\t${value}`];
      }),
    ]);
  }
  function mockTranslator(
    valueFor: (lang: string, text: string) => string | null,
    { sourceLang = "en", transform = (lines: string[]) => lines.join("\n") } = {},
  ) {
    return vi.fn(async (_url: string, init?: RequestInit) => {
      const prompt = promptOf(init);
      return ok(transform(linesFor(itemsOf(prompt), langsOf(prompt), valueFor, sourceLang)));
    });
  }

  function pendingDb(articles: FakeArticle[]): FakeDb {
    const db = new FakeDb(articles);
    for (const article of articles) {
      const languages = article.seed_source_language === "zh"
        ? ["ja", "en"]
        : article.seed_source_language === "ja"
          ? ["en"]
          : ["ja"];
      for (const language of languages) {
        db.translations.push({
          article_id: article.id,
          language,
          status: "pending",
          title: null,
          attempt_count: 0,
          error_message: null,
        });
      }
    }
    return db;
  }

  it("uses the LM Studio endpoint and allows unauthenticated local servers", async () => {
    const db = pendingDb([{ id: 1, feed_id: 7, title: "Hello", seed_source_language: "en" }]);
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("http://lm-studio.test/v1/chat/completions");
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.reasoning_effort).toBe("none");
      expect(systemOf(init)).toContain("Treat quotation marks such as");
      expect(systemOf(init)).toContain("Quoted names are not an exception");
      expect(systemOf(init)).toContain("use an English rendering rather than copying the original");
      expect(systemOf(init)).toContain("use `mixed`");
      expect(systemOf(init)).toContain("For `mixed` or `und`, output one line for every requested target language");
      // The output shape is prompted, not enforced: strict json_schema
      // decoding is slower and intermittently crashes the local Gemma engine,
      // so the request relies on the prompt plus the response parser instead.
      expect(body.response_format).toBeUndefined();
      expect(body.tools).toBeUndefined();
      return ok(`#1\ten\nja\t${VALID.ja}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const env = makeEnv(db);
    env.LM_STUDIO_API_URL = "http://lm-studio.test/v1///";
    env.LM_STUDIO_API_KEY = undefined;
    const result = await runTranslateDrain(env);

    expect(result.translated).toBe(1);
  });

  it("translates pending pairs across feeds in one batch and saves ready rows", async () => {
    const db = pendingDb([
      { id: 1, feed_id: 7, title: "Hello", seed_source_language: "en" },
      { id: 2, feed_id: 8, title: "World", seed_source_language: "en" },
    ]);
    const fetchSpy = mockTranslator((lang) => VALID[lang]!);
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runTranslateDrain(makeEnv(db));

    expect(result).toEqual({ translated: 2, failed: 0, remaining: 0, rateLimited: false });
    expect(db.sourceLanguage(1)).toBe("en");
    // same source language ⇒ one cross-feed request
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(db.translation(1, "ja")).toMatchObject({ status: "ready", title: "翻訳された題名" });
    expect(db.translation(2, "ja")).toMatchObject({ status: "ready", title: "翻訳された題名" });
  });

  it("requests only the union of pending languages in a batch, in supported order", async () => {
    const db = pendingDb([
      { id: 1, feed_id: 7, title: "Hello", seed_source_language: "en" }, // pending: [ja]
      { id: 2, feed_id: 7, title: "Bonjour", seed_source_language: "ja" }, // pending: [en]
    ]);
    let requestedLangs: string[] = [];
    // French source: neither requested target is the titles' own language, so
    // both are genuinely translated rather than filled in from the original.
    const fetchSpy = mockTranslator((lang) => VALID[lang]!, { sourceLang: "fr" });
    const spy = vi.fn(async (url: string, init?: RequestInit) => {
      requestedLangs = langsOf(promptOf(init));
      return fetchSpy(url, init);
    });
    vi.stubGlobal("fetch", spy);

    const result = await runTranslateDrain(makeEnv(db));

    // Only ja and en are pending across the batch; zh/ko/es are already done
    // for these articles and must never be requested (no wasted generation).
    expect(requestedLangs).toEqual(["ja", "en"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.translated).toBe(2);
  });

  it("marks a batch in flight during the model call and clears it afterward", async () => {
    const db = pendingDb([{ id: 1, feed_id: 7, title: "Hello", seed_source_language: "en" }]); // pending: [ja]
    let processingDuringCall: string | null | undefined = "unset";
    vi.stubGlobal("fetch", vi.fn(async () => {
      // The pair must be claimed (処理中) before the model call is made.
      processingDuringCall = db.translation(1, "ja")?.processing_at;
      return ok(`#1\ten\nja\t${VALID.ja}`);
    }));

    const result = await runTranslateDrain(makeEnv(db));

    expect(processingDuringCall).toBeTruthy();
    expect(result.translated).toBe(1);
    // Once done, the pair is 完了, no longer 翻訳中.
    expect(db.translation(1, "ja")?.processing_at ?? null).toBeNull();
  });

  it("matches a shuffled response by id, not by position", async () => {
    const db = pendingDb([
      { id: 1, feed_id: 7, title: "Alpha release", seed_source_language: "en" },
      { id: 2, feed_id: 7, title: "Beta release", seed_source_language: "en" },
    ]);
    const JA_BY_ID: Record<number, string> = { 1: "アルファ版がリリースされました", 2: "ベータ版がリリースされました" };
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const groups = itemsOf(promptOf(init))
        .map((item) => `#${item.id}\ten\nja\t${JA_BY_ID[item.id]!}`)
        .reverse();
      return ok(groups.join("\n"));
    }));

    const result = await runTranslateDrain(makeEnv(db));

    expect(result.translated).toBe(2);
    expect(db.translation(1, "ja")?.title).toBe("アルファ版がリリースされました");
    expect(db.translation(2, "ja")?.title).toBe("ベータ版がリリースされました");
  });

  it("stores the original title for the language the title is already written in", async () => {
    // The model omits the title's own language instead of echoing it back, so
    // the row is filled from the input — the stored value must be identical to
    // what an echoed answer would have produced.
    const db = pendingDb([{ id: 1, feed_id: 7, title: "On Being Playful", seed_source_language: "ja" }]);
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      // en is requested but deliberately absent from the answer.
      expect(langsOf(promptOf(init))).toEqual(["en"]);
      return ok("#1\ten");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runTranslateDrain(makeEnv(db));

    expect(result).toMatchObject({ translated: 1, failed: 0, remaining: 0 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(db.translation(1, "en")).toMatchObject({ status: "ready", title: "On Being Playful" });
    expect(db.sourceLanguage(1)).toBe("en");
  });

  it("ignores prose around the translation lines", async () => {
    const db = pendingDb([{ id: 1, feed_id: 7, title: "Hello", seed_source_language: "en" }]);
    vi.stubGlobal("fetch", vi.fn(async () => ok(
      ["Sure, here you go:", "```", "#1\ten", `ja\t${VALID.ja}`, "```", "Anything else?"].join("\n"),
    )));

    const result = await runTranslateDrain(makeEnv(db));

    expect(result.translated).toBe(1);
    expect(db.translation(1, "ja")).toMatchObject({ status: "ready", title: VALID.ja });
  });

  it("keeps a translation that itself contains tabs", async () => {
    const db = pendingDb([{ id: 1, feed_id: 7, title: "Hello", seed_source_language: "en" }]);
    vi.stubGlobal("fetch", vi.fn(async () => ok(`#1\ten\nja\t${VALID.ja}\t追記`)));

    const result = await runTranslateDrain(makeEnv(db));

    expect(result.translated).toBe(1);
    expect(db.translation(1, "ja")?.title).toBe(`${VALID.ja}\t追記`);
  });

  it("never files lines under the previous title when a header names an unknown id", async () => {
    const db = pendingDb([{ id: 1, feed_id: 7, title: "Hello", seed_source_language: "en" }]);
    vi.stubGlobal("fetch", vi.fn(async () => ok(
      ["#1\ten", `ja\t${VALID.ja}`, "#999\ten", "ja\t取り違えた題名"].join("\n"),
    )));

    const result = await runTranslateDrain(makeEnv(db));

    expect(result.translated).toBe(1);
    expect(db.translation(1, "ja")?.title).toBe(VALID.ja);
  });

  it("keeps complete entries when a batch response is truncated", async () => {
    const db = pendingDb([
      { id: 1, feed_id: 7, title: "Alpha", seed_source_language: "en" },
      { id: 2, feed_id: 7, title: "Beta", seed_source_language: "en" },
    ]);
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      calls++;
      const items = itemsOf(promptOf(init));
      const titleFor = (id: number) => (id === 2 ? "ベータ" : "アルファ");
      if (calls === 1) {
        // Generation stopped part-way through the second group.
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "length",
            message: { content: `#${items[0]!.id}\ten\nja\t${titleFor(items[0]!.id)}\n#${items[1]!.id}\ten\nja\tベ` },
          }],
        }), { status: 200 });
      }
      return ok(items.map((item) => `#${item.id}\ten\nja\t${titleFor(item.id)}`).join("\n"));
    }));

    const result = await runTranslateDrain(makeEnv(db));

    expect(result).toMatchObject({ translated: 2, failed: 0, remaining: 0 });
    expect(calls).toBe(2);
    expect(db.translation(1, "ja")).toMatchObject({ status: "ready", title: "アルファ" });
    expect(db.translation(2, "ja")).toMatchObject({ status: "ready", title: "ベータ" });
  });

  it("strengthens the prompt after an unparseable response", async () => {
    const db = pendingDb([{ id: 1, feed_id: 7, title: "Hello", seed_source_language: "en" }]);
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      calls++;
      if (calls === 1) return ok("I cannot comply with that format.");
      expect(systemOf(init)).toContain("previous response did not follow the output format");
      expect(promptOf(init)).toContain("previous response did not follow the output format");
      return ok(`#1\ten\nja\t${VALID.ja}`);
    }));

    const result = await runTranslateDrain(makeEnv(db));

    expect(result).toMatchObject({ translated: 1, failed: 0, remaining: 0 });
    expect(calls).toBe(2);
  });

  it("translates non-target source languages into both supported targets", async () => {
    const db = pendingDb([{ id: 1, feed_id: 7, title: "今日新闻", seed_source_language: "zh" }]);
    vi.stubGlobal("fetch", mockTranslator((lang) => VALID[lang]!, { sourceLang: "zh" }));

    const result = await runTranslateDrain(makeEnv(db));

    expect(result).toEqual({ translated: 2, failed: 0, remaining: 0, rateLimited: false });
    expect(db.translation(1, "ja")).toMatchObject({ status: "ready", title: "翻訳された題名" });
    expect(db.translation(1, "en")).toMatchObject({ status: "ready", title: "english title" });
  });

  it("allows unchanged named entities to pass as ready translations", async () => {
    const db = pendingDb([{ id: 1, feed_id: 7, title: "Google I/O 2026", seed_source_language: "ja" }]);
    vi.stubGlobal("fetch", mockTranslator((_lang, text) => text, { sourceLang: "ja" }));

    const result = await runTranslateDrain(makeEnv(db));

    expect(result.translated).toBe(1);
    expect(db.translation(1, "en")).toMatchObject({ status: "ready", title: "Google I/O 2026" });
  });

  it("accepts an echoed English title on a Japanese-language article", async () => {
    const db = pendingDb([{ id: 1, feed_id: 7, title: "On Being Playful", seed_source_language: "ja" }]);
    vi.stubGlobal("fetch", mockTranslator((lang, text) => (lang === "en" ? text : VALID.ja!), { sourceLang: "ja" }));

    const result = await runTranslateDrain(makeEnv(db));

    expect(result.failed).toBe(0);
    expect(db.translation(1, "en")).toMatchObject({ status: "ready", title: "On Being Playful" });
  });

  it("repairs an English translation that contains a stray CJK fragment", async () => {
    const db = pendingDb([{
      id: 1,
      feed_id: 7,
      title: "Googleの完全無人自動運転タクシー「Waymo」、新たに4都市で運行拡大へ",
      seed_source_language: "ja",
    }]);
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      calls++;
      if (calls === 2) {
        expect(systemOf(init)).toContain("Do not mix writing systems");
        expect(promptOf(init)).toContain("Regenerate these affected translations");
        expect(promptOf(init)).toContain("無人");
      }
      const value = calls === 1
        ? "Google's fully无人 autonomous taxi 'Waymo' to expand driverless operations to 4 new cities"
        : "Google's fully autonomous taxi 'Waymo' to expand driverless operations to 4 new cities";
      return ok(itemsOf(promptOf(init)).map((item) => `#${item.id}\tja\nen\t${value}`).join("\n"));
    }));

    const result = await runTranslateDrain(makeEnv(db));

    expect(result).toMatchObject({ translated: 1, failed: 0, remaining: 0 });
    expect(calls).toBe(2);
    expect(db.translation(1, "en")).toMatchObject({ status: "ready", title: "Google's fully autonomous taxi 'Waymo' to expand driverless operations to 4 new cities" });
  });

  it("repairs a Korean translation that contains a stray Japanese fragment", async () => {
    const db = new FakeDb(
      [{ id: 1, feed_id: 7, title: "段ボールストッカー", seed_source_language: "ja" }],
      [{
        article_id: 1,
        language: "ko",
        status: "pending",
        title: null,
        attempt_count: 0,
        error_message: null,
      }],
    );
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      calls++;
      if (calls === 2) {
        expect(systemOf(init)).toContain("Korean must not contain any Hiragana or Katakana");
        expect(promptOf(init)).toContain("段ボールストッカー");
        expect(promptOf(init)).not.toContain("단ボール 스토커");
      }
      const value = calls === 1
        ? "야마자키 주교의 '단ボール 스토커'로 간소화. 세워두기·끈으로 묶기·버리러 가기, 이 제품 하나로 편리하게!"
        : "야마자키 주교의 '골판지 스토커'로 간소화. 세워두기·끈으로 묶기·버리러 가기, 이 제품 하나로 편리하게!";
      return ok(`#1\tja\nko\t${value}`);
    }));

    const result = await runTranslateDrain(makeEnv(db));

    expect(result).toMatchObject({ translated: 1, failed: 0, remaining: 0 });
    expect(calls).toBe(2);
    expect(db.translation(1, "ko")).toMatchObject({ status: "ready", title: "야마자키 주교의 '골판지 스토커'로 간소화. 세워두기·끈으로 묶기·버리러 가기, 이 제품 하나로 편리하게!" });
  });

  it("repairs Chinese output containing Japanese title text and Korean words", async () => {
    const db = new FakeDb(
      [{
        id: 1,
        feed_id: 7,
        title: "家事問屋の下ごしらえボウルで「玉子焼き」が劇的に上達。お弁当作りの救世主、7月31日まで参加者募集中",
        seed_source_language: "ja",
      }],
      [{
        article_id: 1,
        language: "zh",
        status: "pending",
        title: null,
        attempt_count: 0,
        error_message: null,
      }],
    );
    let calls = 0;
    let repairPrompt = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      calls++;
      if (calls === 2) {
        repairPrompt = promptOf(init);
      }
      const value = calls === 1
        ? "多亏了家事問屋的下ごしらえボウル，“玉子烧”的成功率大幅提升。它是制作便当的救世主，截止7月31日招募 참가者。"
        : calls === 2
          ? "多亏了家事問屋的备料碗，“玉子烧”的成功率大幅提升。它是制作便当的救世主，截止7月31日招募 참가者。"
          : "多亏了家事问屋的备料碗，“玉子烧”的成功率大幅提升。它是制作便当的救世主，截止7月31日招募参加者。";
      return ok(`#1\tja\nzh\t${value}`);
    }));

    const result = await runTranslateDrain(makeEnv(db));

    expect(result).toMatchObject({ translated: 1, failed: 0, remaining: 0 });
    expect(calls).toBe(3);
    expect(repairPrompt).toContain("Forbidden source-script fragments");
    expect(repairPrompt).toContain("참가");
    // The full invalid output is not repeated as a repair prompt.
    expect(repairPrompt).not.toContain("多亏了家事問屋");
    expect(db.translation(1, "zh")).toMatchObject({ status: "ready", title: "多亏了家事问屋的备料碗，“玉子烧”的成功率大幅提升。它是制作便当的救世主，截止7月31日招募参加者。" });
  });

  it("repairs an exact echo from a mixed-language title misreported as Chinese", async () => {
    const title = "白駒池 | 北八ヶ岳森林中美丽的苔藓与红叶！享受徒步与山小屋之旅";
    const db = new FakeDb(
      [{ id: 1, feed_id: 7, title, seed_source_language: null }],
      [{
        article_id: 1,
        language: "zh",
        status: "pending",
        title: null,
        attempt_count: 0,
        error_message: null,
      }],
    );
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      calls++;
      const value = calls === 1
        ? title
        : "白驹池｜北八岳森林中的美丽苔藓与红叶！享受徒步与山屋之旅";
      return ok(`#1\tzh\nzh\t${value}`);
    }));

    const result = await runTranslateDrain(makeEnv(db));

    expect(result).toMatchObject({ translated: 1, failed: 0, remaining: 0 });
    expect(calls).toBe(2);
    expect(db.translation(1, "zh")).toMatchObject({
      status: "ready",
      title: "白驹池｜北八岳森林中的美丽苔藓与红叶！享受徒步与山屋之旅",
    });
  });

  it("marks persistent echoes as errors after exhausting attempts", async () => {
    const db = pendingDb([{ id: 1, feed_id: 7, title: "こんにちは", seed_source_language: "ja" }]);
    const fetchSpy = mockTranslator((_lang, text) => text, { sourceLang: "ja" });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runTranslateDrain(makeEnv(db));

    expect(result).toEqual({ translated: 0, failed: 1, remaining: 0, rateLimited: false });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(db.translation(1, "en")).toMatchObject({
      status: "error",
      attempt_count: 3,
      error_message: 'model returned untranslated echo: "こんにちは"',
    });
  });

  it("records hard API errors on every pair after exhausting attempts", async () => {
    const db = pendingDb([{ id: 1, feed_id: 7, title: "Hello", seed_source_language: "en" }]);
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ error: { message: "model overloaded" } }),
      { status: 500 },
    ));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runTranslateDrain(makeEnv(db));

    expect(result).toEqual({ translated: 0, failed: 1, remaining: 0, rateLimited: false });
    // one request per attempt — hard errors are not retried inside a call
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(db.translation(1, "ja")).toMatchObject({
      status: "error",
      error_message: "API error 500: model overloaded",
    });
  });

  it("stops immediately on 429 and reschedules the drain with a delay", async () => {
    const db = pendingDb([{ id: 1, feed_id: 7, title: "Hello", seed_source_language: "en" }]);
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ error: { message: "rate limit exceeded" } }),
      { status: 429, headers: { "retry-after": "45" } },
    ));
    vi.stubGlobal("fetch", fetchSpy);

    const env = makeEnv(db);
    const result = await runTranslateDrain(env);

    expect(result).toEqual({ translated: 0, failed: 0, remaining: 1, rateLimited: true });
    // no in-call retry, no sleeping: exactly one request
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(db.translation(1, "ja")).toMatchObject({ status: "pending", attempt_count: 0 });
    expect(env.sentDrains).toEqual([{ delaySeconds: 45 }]);
  });

  it("does nothing when no rows are pending", async () => {
    const db = new FakeDb([{ id: 1, feed_id: 7, title: "Hello", seed_source_language: "en" }]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const env = makeEnv(db);
    const result = await runTranslateDrain(env);

    expect(result).toEqual({ translated: 0, failed: 0, remaining: 0, rateLimited: false });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(env.sentDrains).toEqual([]);
  });

  it("packs oversized backlogs into multiple batches", async () => {
    const articles: FakeArticle[] = Array.from({ length: 45 }, (_, i) => ({
      id: i + 1,
      feed_id: 7,
      title: `Article title number ${i + 1}`,
      seed_source_language: "en",
    }));
    const db = pendingDb(articles);
    const fetchSpy = mockTranslator(() => VALID.ja!);
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runTranslateDrain(makeEnv(db));

    expect(result.translated).toBe(45);
    expect(fetchSpy).toHaveBeenCalledTimes(12);
    const sizes = fetchSpy.mock.calls.map(([, init]) => itemsOf(promptOf(init as RequestInit)).length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(4);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(45);
  });
});
