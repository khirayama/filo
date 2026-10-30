import Foundation
import Testing
@testable import Filo

@MainActor
struct FiloTests {
    @Test func savedPageMatchingIgnoresTrackingButKeepsMeaningfulParameters() {
        #expect(sameReadingArticleURL("http://EXAMPLE.com/story/?utm_source=x&view=full#top", "https://example.com/story?view=full"))
        #expect(sameReadingArticleURL("https://example.com/story?q=hello+world", "https://example.com/story?q=hello%20world"))
        #expect(!sameReadingArticleURL("https://example.com/story?view=short", "https://example.com/story?view=full"))
        #expect(!sameReadingArticleURL(nil, nil))
    }
    private func article(_ id: Int, read: Bool = false, bookmark: Bool = false) -> ArticleListItem {
        ArticleListItem(
            id: id, title: "Article \(id)", fetchedAt: "",
            feed: .init(id: 1, title: "Feed"),
            subscriptionContext: .init(subscriptionIds: [1], tagIds: []),
            userState: .init(isRead: read, inReadingList: false, isBookmarked: bookmark)
        )
    }

    @Test func failedBulkReadRestoresHiddenRowsWithoutAnotherRequest() {
        let previous = [article(1), article(2), article(3)]
        #expect(restoringArticleReadStates([], from: previous) == previous)
        #expect(restoringArticleReadStates([article(2, read: true)], from: previous) == previous)
    }

    @Test func bulkReadRollbackPreservesRowsRemovedByOtherOperations() {
        #expect(restoringArticleReadStates([article(2, read: true)], from: [article(1), article(2)], restoreHidden: false) == [article(2)])
    }

    @Test func bulkReadRollbackPreservesOtherEditsAndNewRows() {
        let previous = [article(1), article(2, read: true)]
        let current = [article(1, read: true, bookmark: true), article(2, read: true), article(3)]
        #expect(restoringArticleReadStates(current, from: previous) == [article(1, bookmark: true), article(2, read: true), article(3)])
        #expect(current[0].userState.isRead)
    }

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

    @Test func linkedPageDoesNotInheritTheOriginalArticleIdentity() throws {
        let player = ReadingPlayerStore()
        player.items = [item(42)]
        player.index = 0
        player.pageLoading()
        player.pageLoaded("https://example.com/redirected", "Original")
        #expect(player.currentPageArticleId == 42)

        player.play()
        let oldRequest = try #require(player.captureRequest)
        player.pageLoading()
        #expect(player.currentPageArticleId == nil)
        #expect(player.captureRequest == nil)
        player.pageLoaded("https://example.com/linked", "Linked")
        #expect(player.currentPageArticleId == nil)
        player.receiveCapture(oldRequest, text: "Old text", language: "en")
        #expect(!player.isPlaying)

        player.pageLoading()
        player.pageLoaded("https://example.com/redirected#section", "Original")
        #expect(player.currentPageArticleId == 42)
    }

    @Test func choosingCurrentSessionArticleFromLinkedPageReopensIt() {
        let player = ReadingPlayerStore()
        player.items = [item(42)]
        player.index = 0
        player.pageLoading()
        player.pageLoaded("https://example.com/42", "Original")
        player.pageLoading()
        player.pageLoaded("https://example.com/linked", "Linked")
        let oldPageId = player.browserPageId
        player.select(articleId: 42)
        #expect(player.browserPageId != oldPageId)
        #expect(player.currentPageUrl == nil)
    }

    @Test func sameDocumentNavigationChangesThePageIdentity() {
        let player = ReadingPlayerStore()
        player.items = [item(42)]
        player.index = 0
        player.pageLoading()
        player.pageLoaded("https://example.com/42", "Original")
        player.pageLocationChanged("https://example.com/linked", "Linked")
        #expect(player.currentPageUrl == "https://example.com/linked")
        #expect(player.currentPageArticleId == nil)
        player.pageLocationChanged("https://example.com/42#part", "Original")
        #expect(player.currentPageArticleId == 42)
    }
}
