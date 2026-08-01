import Testing
@testable import Filo

// 一覧タイトルのスキップ規則。
//
// **原文言語の判定はサーバーが持つ**(apps/api/test/languageDetect.test.ts)。ここでは
// 「その言語を訳す必要があるか」だけを見る。
struct TitleTranslationRulesTests {
    private let readable = ["ja"]

    @Test func sameLanguageAsDisplayIsNotTranslated() {
        #expect(!TitleTranslationRules.needsTranslation(source: "ja", target: "ja", readable: readable))
    }

    @Test func readableLanguageIsNotTranslated() {
        #expect(!TitleTranslationRules.needsTranslation(source: "en", target: "ja", readable: ["ja", "en"]))
    }

    @Test func otherLanguageIsTranslated() {
        #expect(TitleTranslationRules.needsTranslation(source: "en", target: "ja", readable: readable))
        #expect(TitleTranslationRules.needsTranslation(source: "zh-Hans", target: "ja", readable: readable))
    }

    @Test func regionalCodesAreComparedByBaseLanguage() {
        // "zh-Hans" と "zh"、"ja-JP" と "ja" は同じ言語として扱う
        #expect(!TitleTranslationRules.needsTranslation(source: "ja-JP", target: "ja", readable: readable))
        #expect(!TitleTranslationRules.needsTranslation(source: "zh-Hans", target: "zh", readable: []))
        #expect(!TitleTranslationRules.needsTranslation(source: "zh-Hant", target: "ja", readable: ["zh"]))
    }
}
