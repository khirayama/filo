import { describe, expect, it } from "vitest";
import {
  detectArticleLanguage,
  detectFeedLanguage,
  detectLanguage,
  scriptClassOf,
} from "../src/lib/languageDetect";

const enTitles = [
  "A quick look at the new Swift concurrency model",
  "How we cut our build time in half",
  "Xcode 26 released with new features",
  "Understanding structured concurrency in depth",
  "Reducing app launch time by measuring first",
];

const jaTitles = [
  "Claude Codeの新機能、iOSシミュレータ連携機能はこう使う",
  "モバイルアプリでFirebaseとSAMLを使って認証する",
  "大規模iOSアプリのビルドを速くする — 計測して、分割計画を立てた話",
];

const enArticle =
  "Understanding structured concurrency in depth. In this post we walk through task groups, " +
  "cancellation, and how structured concurrency changes the way you think about background work.";

describe("scriptClassOf", () => {
  it("仮名があれば kana", () => {
    expect(scriptClassOf("SwiftUI の Observation を使う")).toBe("kana");
    expect(scriptClassOf("アップル・クック")).toBe("kana");
  });

  it("ハングルがあれば hangul", () => {
    expect(scriptClassOf("애플, 새로운 아이폰을 공개했다")).toBe("hangul");
  });

  it("漢字だけなら han（日本語か中国語かは決めない）", () => {
    expect(scriptClassOf("苹果发布了新一代开发工具")).toBe("han");
  });

  it("ラテン文字だけなら latin", () => {
    expect(scriptClassOf("Xcode 26 released")).toBe("latin");
  });

  it("空文字は none", () => {
    expect(scriptClassOf("   ")).toBe("none");
  });
});

describe("detectLanguage", () => {
  it("日本語に英単語が混ざっても日本語と判定する", () => {
    for (const title of jaTitles) {
      expect(detectLanguage(title)).toEqual({ language: "ja", confidence: "high" });
    }
    // 統計的判定に任せると fra になっていたケース
    expect(detectLanguage("SwiftUI の Observation を使う").language).toBe("ja");
  });

  it("韓国語は文字体系で確定する", () => {
    expect(detectLanguage("애플, 새로운 아이폰을 공개했다")).toEqual({ language: "ko", confidence: "high" });
  });

  it("短いラテン文字のテキストは low として返す", () => {
    // 17 字の英語は franc が nld と誤判定する。値は返すが信用しない印を付ける
    const result = detectLanguage("Xcode 26 released");
    expect(result.confidence).toBe("low");
  });

  it("十分な長さのラテン文字テキストは high で正しく判定する", () => {
    expect(detectLanguage(enArticle)).toEqual({ language: "en", confidence: "high" });
  });
});

describe("detectFeedLanguage", () => {
  it("宣言された言語を最優先する", () => {
    const result = detectFeedLanguage("ja", enTitles.map((title) => ({ title })));
    expect(result).toEqual({ language: "ja", confidence: "high" });
  });

  it("宣言が無ければ全 item を連結して判定する", () => {
    // 単独のタイトルでは 10 件中 2 件を誤判定するが、連結すれば当たる
    const result = detectFeedLanguage(null, enTitles.map((title) => ({ title })));
    expect(result).toEqual({ language: "en", confidence: "high" });
  });

  it("日本語のフィードを日本語と判定する", () => {
    const result = detectFeedLanguage(null, jaTitles.map((title) => ({ title })));
    expect(result.language).toBe("ja");
  });

  it("item が無ければ判定しない", () => {
    expect(detectFeedLanguage(null, [])).toEqual({ language: null, confidence: "low" });
  });

  it("ISO 639-3 や地域つきの宣言を 639-1 に正規化する", () => {
    expect(detectFeedLanguage("en-US", []).language).toBe("en");
    expect(detectFeedLanguage("jpn", []).language).toBe("ja");
  });
});

describe("detectArticleLanguage", () => {
  it("フィードと同じ文字体系ならフィード言語をそのまま使う", () => {
    // 記事単位で言語を当て直すと誤判定が増えるだけなので上書きしない
    expect(detectArticleLanguage("Xcode 26 released", "en")).toEqual({
      language: "en",
      confidence: "high",
    });
  });

  it("英語フィードの日本語記事は文字体系で上書きする", () => {
    expect(detectArticleLanguage("SwiftUI の Observation を使う", "en")).toEqual({
      language: "ja",
      confidence: "high",
    });
  });

  it("日本語フィードの英語記事は、十分な長さがあれば上書きする", () => {
    expect(detectArticleLanguage(enArticle, "ja")).toEqual({ language: "en", confidence: "high" });
  });

  it("日本語フィードの短い英語記事は言語を決めない", () => {
    // オランダ語やドイツ語から翻訳してしまうより、分からないままにする
    expect(detectArticleLanguage("Xcode 26 released", "ja")).toEqual({
      language: null,
      confidence: "low",
    });
  });

  it("日本語フィードの漢字だけの記事は日本語のままにする", () => {
    const result = detectArticleLanguage("新機能追加、性能改善", "ja");
    expect(result.language).toBe("ja");
  });

  it("中国語フィードの漢字記事は中国語のままにする", () => {
    expect(detectArticleLanguage("苹果发布了新一代开发工具", "zh").language).toBe("zh");
  });

  it("フィード言語が不明でも仮名があれば日本語と判定する", () => {
    expect(detectArticleLanguage("アップルが新製品を発表", null).language).toBe("ja");
  });

  it("本文が空ならフィード言語を返す", () => {
    expect(detectArticleLanguage("   ", "en").language).toBe("en");
  });
});
