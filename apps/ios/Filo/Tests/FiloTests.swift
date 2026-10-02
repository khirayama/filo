import Foundation
import Testing
@testable import Filo

@MainActor
struct FiloTests {
    private func item(_ id: Int) -> ReadingSessionItem {
        ReadingSessionItem(
            articleId: id,
            sortOrder: 0,
            article: .init(
                id: id,
                title: "Article \(id)",
                sourceLanguage: "en",
                canonicalUrl: "https://example.com/\(id)",
                publishedAt: nil,
                feed: .init(id: 0, title: "Example"),
            ),
            createdAt: nil,
            isRead: true,
        )
    }

    @Test func sharedPageCanSwitchToASavedArticle() {
        let player = ReadingPlayerStore()
        player.items = [item(0)]
        player.index = 0
        player.readingListItems = [item(42)]
        #expect(player.isTemporary)
        let pageId = player.browserPageId

        player.select(articleId: 42)

        #expect(player.currentItem?.articleId == 42)
        #expect(!player.isTemporary)
        #expect(player.browserPageId != pageId)
        #expect(player.visibleReadingListItems.count == 1)
    }

    @Test func settingsChangesReplacePendingCaptureAndIgnoreItsOldResult() throws {
        let defaults = UserDefaults.standard
        let previousVoice = defaults.object(forKey: "filo:readingVoice")
        let previousRate = defaults.object(forKey: "filo:readingRate")
        defer {
            defaults.set(previousVoice, forKey: "filo:readingVoice")
            defaults.set(previousRate, forKey: "filo:readingRate")
        }
        let player = ReadingPlayerStore()
        defer { player.pause() }
        player.items = [item(0)]
        player.index = 0
        player.hasSelection = true
        player.playSelection()
        let oldRequest = try #require(player.captureRequest)

        player.setLanguage("ja")
        let languageRequest = try #require(player.captureRequest)
        player.setVoice(nil)
        let voiceRequest = try #require(player.captureRequest)
        player.setRate(1.5)
        let rateRequest = try #require(player.captureRequest)
        #expect(oldRequest.id != languageRequest.id)
        #expect(languageRequest.id != voiceRequest.id)
        #expect(voiceRequest.id != rateRequest.id)
        #expect(rateRequest.kind == .selection)

        player.receiveCapture(oldRequest, text: "Stale captured text", language: "en")
        #expect(player.captureRequest == rateRequest)
        #expect(player.isPreparing)
        #expect(!player.isPlaying)
    }
}
