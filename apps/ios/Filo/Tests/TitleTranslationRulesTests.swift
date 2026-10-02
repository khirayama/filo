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

    // 以下の失敗例は ML Kit で実際に返ってきたもの(2026-09-30 確認)
    @Test func nearlyUnchangedResultIsNotATranslation() {
        let original = "Apple announces new MacBook Pro with M5 chip"
        #expect(!TitleTranslationRules.isUsableTranslation(original: original, translated: original, target: "en"))
        #expect(!TitleTranslationRules.isUsableTranslation(original: original, translated: "Apple Announces New MacBook Pro With M5 Chip", target: "en"))
        #expect(!TitleTranslationRules.isUsableTranslation(
            original: "Die Bundesregierung plant neue Regeln für KI",
            translated: "Die BundesRegierung Plant NeueRegelnFürKi",
            target: "es"
        ))
        #expect(!TitleTranslationRules.isUsableTranslation(original: "GitHub Copilot CLI 1.2.0", translated: "Github Copilot CLI 1.2.0", target: "ja"))
    }

    @Test func resultWithoutTargetScriptIsNotATranslation() {
        #expect(!TitleTranslationRules.isUsableTranslation(
            original: "El gobierno anuncia nuevas medidas económicas",
            translated: "The Government announces new economic measures",
            target: "ja"
        ))
        #expect(!TitleTranslationRules.isUsableTranslation(original: "Hello world", translated: "Hola mundo", target: "ko"))
    }

    @Test func realTranslationIsKept() {
        #expect(TitleTranslationRules.isUsableTranslation(
            original: "Why we moved our backend from Node.js to Rust",
            translated: "なぜ私たちはNode.jsから錆にバックエンドを引っ越しました",
            target: "ja"
        ))
        #expect(TitleTranslationRules.isUsableTranslation(original: "The State of JS 2026", translated: "JS2026の状態", target: "ja-JP"))
        #expect(TitleTranslationRules.isUsableTranslation(original: "苹果发布新款 MacBook Pro", translated: "Apple releases new MacBook Pro", target: "en"))
        #expect(TitleTranslationRules.isUsableTranslation(original: "Apple 发布", translated: "애플 출시", target: "ko"))
    }
}
