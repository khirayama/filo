import AVFoundation
import NaturalLanguage
import SwiftUI
import Translation
import WebKit

private struct ReadingArticleURLKey: Equatable {
    struct Query: Equatable { let name: String; let value: String }
    let host: String
    let port: Int?
    let path: String
    let query: [Query]
}

private func readingArticleURLKey(_ value: String) -> ReadingArticleURLKey? {
    guard let components = URLComponents(string: value), let scheme = components.scheme?.lowercased(),
          scheme == "http" || scheme == "https", let host = components.host?.lowercased() else { return nil }
    let port = (scheme == "http" && components.port == 80) || components.port == 443 ? nil : components.port
    var path = components.percentEncodedPath.isEmpty ? "/" : components.percentEncodedPath
    while path.count > 1 && path.hasSuffix("/") { path.removeLast() }
    let tracking = ["fbclid", "gclid", "yclid", "mc_cid", "mc_eid"]
    let query = (components.percentEncodedQuery ?? "").split(separator: "&", omittingEmptySubsequences: true).map { pair in
        let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
        func decode(_ value: Substring) -> String {
            let encoded = String(value).replacingOccurrences(of: "+", with: "%20")
            return encoded.removingPercentEncoding ?? encoded
        }
        return ReadingArticleURLKey.Query(name: decode(parts[0]), value: parts.count > 1 ? decode(parts[1]) : "")
    }.filter {
        let name = $0.name.lowercased()
        return !name.hasPrefix("utm_") && !tracking.contains(name)
    }
    return ReadingArticleURLKey(host: host, port: port, path: path, query: query)
}

func sameReadingArticleURL(_ first: String?, _ second: String?) -> Bool {
    guard let first, let second, let key = readingArticleURLKey(first) else { return false }
    return key == readingArticleURLKey(second)
}

private struct ReadingTranslationRequest: Equatable {
    let source: String
    let target: String
    let token: Int
}

// What "read aloud" captures from the page: the page (displayed text, then
// Readability, then the server's extraction) or the current selection.
enum ReadingCaptureKind {
    case page
    case selection
}

struct ReadingCaptureRequest: Equatable {
    let id: Int
    let kind: ReadingCaptureKind
}

@MainActor
final class ReadingPlayerStore: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published var items: [ReadingSessionItem] = []
    @Published var readingListItems: [ReadingSessionItem] = []
    @Published var index = -1
    @Published var isLoading = false
    @Published private(set) var isReadingListLoading = false
    @Published var isPlaying = false
    @Published var isReadingBrowserVisible = false
    @Published private(set) var isPreparing = false
    @Published private(set) var captureRequest: ReadingCaptureRequest?
    @Published private(set) var isPageLoaded = false
    @Published var hasSelection = false
    @Published var pageEditing = false
    @Published var errorMessage: String?
    @Published private(set) var noticeMessage: String?
    @Published private(set) var browserPageId = 0
    @Published var isAddingToReadingList = false
    @Published private(set) var removedReadingListArticleIds: Set<Int> = []
    @Published var rate: Float = UserDefaults.standard.float(forKey: "filo:readingRate") == 0
        ? 1.0 : UserDefaults.standard.float(forKey: "filo:readingRate")
    @Published var targetLanguage = "ja"
    @Published var voiceIdentifier: String? = UserDefaults.standard.string(forKey: "filo:readingVoice")
    @Published fileprivate var translationRequest: ReadingTranslationRequest?

    private let synthesizer = AVSpeechSynthesizer()
    private var chunks: [String] = []
    private var chunkIndex = 0
    private var startingAutoplay = false
    private var startSession = 0
    private var settingsLoad: Task<Void, Never>?
    private var translationToken = 0
    private var nextCaptureId = 0
    private var playbackGeneration = 0
    private var pendingOriginalText: String?
    private var speechLanguage: String?
    private var playbackArticleId: Int? = nil
    private var playbackArticleTitle: String? = nil
    private var playbackKind = ReadingCaptureKind.page
    @Published private(set) var currentPageUrl: String?
    private var pageTitle: String?
    private var sessionPageUrl: String?
    private var pageVersion = 0
    private var pageArticles: [String: Int] = [:]

    private func pageKey(_ url: String) -> String { String(url.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)[0]) }
    var currentPageArticleId: Int? {
        guard let url = currentPageUrl, let id = pageArticles[pageKey(url)], id > 0 else { return nil }
        return id
    }

    var currentItem: ReadingSessionItem? {
        guard index >= 0, index < items.count else { return nil }
        return items[index]
    }
    var isTemporary: Bool { currentItem?.articleId == 0 }
    var currentPlaybackTitle: String? { playbackArticleTitle }
    var visibleReadingListItems: [ReadingSessionItem] {
        readingListItems.filter { !removedReadingListArticleIds.contains($0.articleId) }
    }
    var availableVoices: [AVSpeechSynthesisVoice] {
        AVSpeechSynthesisVoice.speechVoices().filter { targetLanguage.isEmpty || $0.language.hasPrefix(targetLanguage) }
    }

    override init() {
        super.init()
        synthesizer.delegate = self
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    // The page never waits for the API: a known URL opens at once, and a list
    // session opens as soon as its first unread article is known. Later pages
    // only extend the list.
    func start(autoplay: Bool, temporaryUrl: String? = nil, article: ReadingSessionArticle? = nil) async {
        startSession += 1
        let session = startSession
        pause()
        errorMessage = nil
        startingAutoplay = autoplay
        removedReadingListArticleIds = []
        readingListItems = []
        isReadingListLoading = true
        settingsLoad = Task {
            if let settings = try? await APIClient.shared.getSettings(), session == startSession {
                targetLanguage = settings.language
            }
        }
        var directItem: ReadingSessionItem?
        if let article {
            directItem = ReadingSessionItem(articleId: article.id, sortOrder: 0, article: article, createdAt: nil, isRead: false)
        } else if let temporaryUrl {
            let article = ReadingSessionArticle(
                id: 0,
                title: temporaryUrl,
                sourceLanguage: nil,
                canonicalUrl: temporaryUrl,
                publishedAt: nil,
                feed: .init(id: 0, title: L10n.string("共有ページ")),
            )
            directItem = ReadingSessionItem(articleId: 0, sortOrder: 0, article: article, createdAt: nil, isRead: false)
        }
        var opened = directItem != nil
        if let directItem {
            items = [directItem]
            index = 0
            resetPage()
        } else {
            items = []
            index = -1
            isLoading = true
        }
        do {
            try await loadReadingList(session: session) { pageItems in
                readingListItems = plusNew(readingListItems, pageItems)
                if directItem == nil { items = plusNew(items, pageItems) }
                if !opened, let first = items.firstIndex(where: { !$0.isRead }) {
                    opened = true
                    index = first
                    resetPage()
                    isLoading = false
                }
                matchPageToReadingList()
            }
        } catch {
            if !opened, session == startSession { errorMessage = ErrorMessages.message(for: error) }
        }
        guard session == startSession else { return }
        if !opened, errorMessage == nil { errorMessage = L10n.string("未読の記事がありません。") }
        isLoading = false
        isReadingListLoading = false
    }

    // Links the shown page to its reading-list article. The list can arrive
    // after the page has loaded.
    private func matchPageToReadingList() {
        guard let currentPageUrl, currentPageArticleId == nil,
              let match = readingListItems.first(where: { sameReadingArticleURL($0.article.canonicalUrl, currentPageUrl) }) else { return }
        pageArticles[pageKey(currentPageUrl)] = match.articleId
        if playbackKind == .page, isPlaying || isPreparing { playbackArticleId = match.articleId }
    }

    func pageLoading() {
        if isPageLoaded { pause() }
        isPageLoaded = false
        hasSelection = false
        pageEditing = false
        currentPageUrl = nil
        pageVersion += 1
    }

    func pageLoaded(_ url: String?, _ title: String?) {
        currentPageUrl = url.flatMap { $0.hasPrefix("http://") || $0.hasPrefix("https://") ? $0 : nil }
        pageTitle = title
        if sessionPageUrl == nil, let currentPageUrl {
            sessionPageUrl = pageKey(currentPageUrl)
            if let id = currentItem?.articleId, id > 0 { pageArticles[pageKey(currentPageUrl)] = id }
        }
        matchPageToReadingList()
        isPageLoaded = true
        if startingAutoplay {
            startingAutoplay = false
            play()
        }
    }

    func pageLocationChanged(_ url: String, _ title: String) {
        guard let previous = currentPageUrl else { return }
        if pageKey(previous) != pageKey(url) { pageLoading() }
        pageLoaded(url, title)
    }

    func play() {
        requestCapture(.page)
    }

    func playSelection() {
        if hasSelection { requestCapture(.selection) }
    }

    private func requestCapture(_ kind: ReadingCaptureKind) {
        guard currentItem != nil else { return }
        pause()
        playbackKind = kind
        errorMessage = nil
        isPreparing = true
        nextCaptureId += 1
        captureRequest = ReadingCaptureRequest(id: nextCaptureId, kind: kind)
    }

    // The page's answer to a capture request. An empty page capture falls back
    // to the server's extraction for reading-list articles.
    func receiveCapture(_ request: ReadingCaptureRequest, text: String?, language: String?) {
        guard captureRequest?.id == request.id else { return }
        captureRequest = nil
        let generation = playbackGeneration
        Task {
            // The reading language comes from the settings that start() loads beside the page.
            await settingsLoad?.value
            guard generation == playbackGeneration else { return }
            if let text, !text.isEmpty {
                speak(text, language: language, kind: request.kind)
                return
            }
            guard request.kind == .page, let articleId = currentPageArticleId else {
                isPreparing = false
                errorMessage = L10n.string(request.kind == .selection ? "読み上げる文章がありません。" : "本文を抽出できませんでした。")
                return
            }
            let content = await fetchServerText(articleId)
            guard generation == playbackGeneration else { return }
            if let content {
                speak(content.text, language: content.language, kind: .page)
            } else {
                isPreparing = false
                errorMessage = L10n.string("本文を抽出できませんでした。")
            }
        }
    }

    private func fetchServerText(_ articleId: Int) async -> (text: String, language: String?)? {
        _ = try? await APIClient.shared.requestArticleContent(articleId)
        for _ in 0 ..< 12 {
            if let content = try? await APIClient.shared.getArticleContent(articleId) {
                if content.status == "ready", let text = content.text { return (text, content.sourceLanguage) }
                if content.status == "error" { return nil }
            }
            try? await Task.sleep(for: .milliseconds(500))
        }
        return nil
    }

    // Finishing the page of a reading-list article marks it read; a selection
    // or a shared page does not.
    private func speak(_ value: String, language: String?, kind: ReadingCaptureKind) {
        let text = clean(value)
        playbackArticleId = kind == .page ? currentPageArticleId : nil
        playbackArticleTitle = pageTitle ?? currentItem?.article.title
        playbackKind = kind
        let recognizer = NLLanguageRecognizer()
        recognizer.processString(String(text.prefix(3000)))
        let detected = recognizer.languageHypotheses(withMaximum: 1).first.flatMap { language, confidence in
            confidence >= 0.5 ? language.rawValue : nil
        }
        let declared = currentPageArticleId == currentItem?.articleId ? currentItem?.article.sourceLanguage : nil
        let source = detected ?? language ?? declared
        if let source, source.split(separator: "-").first != targetLanguage.split(separator: "-").first {
            pendingOriginalText = text
            translationToken += 1
            translationRequest = ReadingTranslationRequest(source: source, target: targetLanguage, token: translationToken)
            return
        }
        beginSpeaking(text, language: source)
    }

    fileprivate func runTranslation(session: TranslationSession) async {
        guard let request = translationRequest, request.token == translationToken,
              let original = pendingOriginalText else { return }
        do {
            try await session.prepareTranslation()
            let parts = Self.split(original)
            let requests = parts.enumerated().map {
                TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset))
            }
            let responses = try await session.translations(from: requests)
            guard request.token == translationToken else { return }
            let translated = responses.sorted {
                (Int($0.clientIdentifier ?? "0") ?? 0) < (Int($1.clientIdentifier ?? "0") ?? 0)
            }.map(\.targetText).joined(separator: "\n\n")
            if translated.isEmpty { noticeMessage = L10n.string("翻訳を利用できないため原文で読み上げています。") }
            beginSpeaking(translated.isEmpty ? original : translated, language: translated.isEmpty ? request.source : request.target)
        } catch {
            guard request.token == translationToken else { return }
            noticeMessage = L10n.string("翻訳を利用できないため原文で読み上げています。")
            beginSpeaking(original, language: request.source)
        }
        pendingOriginalText = nil
        translationRequest = nil
    }

    private func beginSpeaking(_ text: String, language: String?) {
        synthesizer.stopSpeaking(at: .immediate)
        speechLanguage = language
        chunks = Self.split(text)
        chunkIndex = 0
        isPreparing = false
        isPlaying = true
        speakCurrentChunk()
    }

    func pause() {
        playbackGeneration += 1
        translationToken += 1
        translationRequest = nil
        pendingOriginalText = nil
        startingAutoplay = false
        captureRequest = nil
        isPreparing = false
        noticeMessage = nil
        synthesizer.stopSpeaking(at: .immediate)
        isPlaying = false
    }

    func select(articleId: Int) {
        if let nextIndex = items.firstIndex(where: { $0.articleId == articleId }) {
            if nextIndex == index, currentPageUrl.map(pageKey) == sessionPageUrl { return }
            markArticleRead(currentPageArticleId)
            pause()
            index = nextIndex
            resetPage()
            return
        }
        guard let nextIndex = readingListItems.firstIndex(where: { $0.articleId == articleId }) else { return }
        markArticleRead(currentPageArticleId)
        pause()
        items = readingListItems
        index = nextIndex
        resetPage()
    }

    func selectNext() {
        guard index + 1 < items.count else { return }
        select(articleId: items[index + 1].articleId)
    }

    func selectPrevious() {
        guard index > 0 else { return }
        select(articleId: items[index - 1].articleId)
    }

    func setRate(_ value: Float) {
        rate = min(3, max(0.75, value))
        UserDefaults.standard.set(rate, forKey: "filo:readingRate")
        restartIfPlaying()
    }

    func setVoice(_ identifier: String?) {
        voiceIdentifier = identifier
        UserDefaults.standard.set(identifier, forKey: "filo:readingVoice")
        restartIfPlaying()
    }

    func setLanguage(_ language: String) {
        targetLanguage = language
        voiceIdentifier = nil
        UserDefaults.standard.removeObject(forKey: "filo:readingVoice")
        restartIfPlaying()
    }

    // A settings change while speaking restarts with the new settings.
    private func restartIfPlaying() {
        if isPlaying || isPreparing { requestCapture(playbackKind) }
    }

    func addCurrentPageToReadingList() {
        guard !isAddingToReadingList, let item = currentItem, let url = currentPageUrl else { return }
        let pageId = browserPageId
        let version = pageVersion
        let sessionPage = pageKey(url) == sessionPageUrl
        let title = sessionPage && item.articleId > 0 ? item.article.title : pageTitle
        isAddingToReadingList = true
        Task {
            defer { isAddingToReadingList = false }
            do {
                let saved = try await APIClient.shared.importArticle(url: url, title: title)
                let existing = (items + readingListItems).first { $0.articleId == saved.articleId }
                let savedItem = ReadingSessionItem(
                    articleId: saved.articleId,
                    sortOrder: item.sortOrder,
                    article: ReadingSessionArticle(
                        id: saved.articleId,
                        title: saved.title,
                        sourceLanguage: existing?.article.sourceLanguage ?? (sessionPage ? item.article.sourceLanguage : nil),
                        canonicalUrl: saved.url,
                        publishedAt: existing?.article.publishedAt ?? (sessionPage ? item.article.publishedAt : nil),
                        feed: existing?.article.feed ?? (sessionPage ? item.article.feed : .init(id: 0, title: L10n.string("共有ページ"))),
                    ),
                    createdAt: existing?.createdAt ?? (sessionPage ? item.createdAt : nil),
                    isRead: existing?.isRead ?? (sessionPage && item.isRead),
                )
                removedReadingListArticleIds.remove(saved.articleId)
                if let listIndex = readingListItems.firstIndex(where: { $0.articleId == saved.articleId }) {
                    readingListItems[listIndex] = savedItem
                } else {
                    readingListItems.append(savedItem)
                }
                // Saving updates metadata without replacing the browser or the session snapshot.
                if browserPageId == pageId { pageArticles[pageKey(url)] = saved.articleId }
                if browserPageId == pageId, pageVersion == version, currentPageUrl == url {
                    if sessionPage, currentItem?.articleId == item.articleId { items[index] = savedItem }
                    if playbackKind == .page, isPlaying || isPreparing {
                        playbackArticleId = saved.articleId
                        playbackArticleTitle = saved.title
                    }
                }
            } catch {
                errorMessage = ErrorMessages.message(for: error)
            }
        }
    }

    func removeFromReadingList(articleId: Int) {
        guard articleId > 0 else { return }
        Task {
            do {
                _ = try await APIClient.shared.setReadingListMembership(articleId, active: false)
                removedReadingListArticleIds.insert(articleId)
            } catch {
                errorMessage = ErrorMessages.message(for: error)
            }
        }
    }

    private func loadReadingList(session: Int, onPage: ([ReadingSessionItem]) -> Void) async throws {
        var count = 0
        var cursor: String?
        repeat {
            let page = try await APIClient.shared.listArticles(
                filters: .init(readingList: true),
                cursor: cursor,
                limit: 100,
            )
            guard session == startSession else { return }
            let startIndex = count
            count += page.articles.count
            onPage(page.articles.enumerated().map { offset, article in
                ReadingSessionItem(
                    articleId: article.id,
                    sortOrder: startIndex + offset,
                    article: ReadingSessionArticle(article),
                    createdAt: nil,
                    isRead: article.userState.isRead,
                )
            })
            cursor = page.nextCursor
        } while cursor != nil
    }

    private func plusNew(_ list: [ReadingSessionItem], _ other: [ReadingSessionItem]) -> [ReadingSessionItem] {
        let known = Set(list.map(\.articleId))
        return list + other.filter { !known.contains($0.articleId) }
    }

    private func resetPage() {
        browserPageId += 1
        currentPageUrl = nil
        pageTitle = nil
        sessionPageUrl = nil
        pageArticles.removeAll()
        pageVersion += 1
        isPageLoaded = false
        hasSelection = false
        pageEditing = false
        chunks = []
        chunkIndex = 0
    }

    private func speakCurrentChunk() {
        guard chunkIndex < chunks.count else { return }
        let utterance = AVSpeechUtterance(string: chunks[chunkIndex])
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * rate
        let language = speechLanguage ?? targetLanguage
        utterance.voice = voiceIdentifier.flatMap(AVSpeechSynthesisVoice.init(identifier:))
            .flatMap { $0.language.split(separator: "-").first == language.split(separator: "-").first ? $0 : nil }
            ?? AVSpeechSynthesisVoice(language: language)
        synthesizer.speak(utterance)
    }

    private func finishedChunk() {
        guard isPlaying else { return }
        chunkIndex += 1
        if chunkIndex < chunks.count {
            speakCurrentChunk()
            return
        }
        isPlaying = false
        markArticleRead(playbackArticleId)
    }

    private func markArticleRead(_ articleId: Int?) {
        guard let articleId, articleId > 0 else { return }
        let knownRead = (items + readingListItems).first { $0.articleId == articleId }?.isRead == true
        guard !knownRead else { return }
        items = items.map { item in
            guard item.articleId == articleId else { return item }
            return ReadingSessionItem(
                articleId: item.articleId,
                sortOrder: item.sortOrder,
                article: item.article,
                createdAt: item.createdAt,
                isRead: true,
            )
        }
        readingListItems = readingListItems.map { item in
            guard item.articleId == articleId else { return item }
            return ReadingSessionItem(
                articleId: item.articleId,
                sortOrder: item.sortOrder,
                article: item.article,
                createdAt: item.createdAt,
                isRead: true,
            )
        }
        Task { _ = try? await APIClient.shared.setArticleRead(articleId, isRead: true) }
    }

    private func clean(_ value: String) -> String {
        value.replacingOccurrences(of: #"https?://\S+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func split(_ text: String, limit: Int = 3000) -> [String] {
        var result: [String] = []
        var remaining = text
        while remaining.count > limit {
            let end = remaining.index(remaining.startIndex, offsetBy: limit)
            let prefix = String(remaining[..<end])
            let split = prefix.lastIndex(where: { ".。！？!? ".contains($0) }) ?? prefix.endIndex
            let part = String(prefix[..<split]).trimmingCharacters(in: .whitespacesAndNewlines)
            result.append(part.isEmpty ? prefix : part)
            let consumed = part.isEmpty ? end : split
            remaining = String(remaining[consumed...]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if !remaining.isEmpty { result.append(remaining) }
        return result
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.finishedChunk() }
    }

}

// The web view's page history, for the header and the edge swipe.
@MainActor
final class ReadingPageHistory: ObservableObject {
    @Published private(set) var canGoBack = false
    private weak var webView: WKWebView?
    private var observation: NSKeyValueObservation?

    func attach(_ webView: WKWebView) {
        self.webView = webView
        observation = webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] webView, _ in
            let canGoBack = webView.canGoBack
            Task { @MainActor in self?.canGoBack = canGoBack }
        }
    }

    func goBack() {
        webView?.goBack()
    }
}

struct ReadingSessionScreen: View {
    let autoplay: Bool
    let temporaryUrl: String?
    let article: ReadingSessionArticle?
    @EnvironmentObject private var player: ReadingPlayerStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @StateObject private var history = ReadingPageHistory()
    @State private var isReadingListPresented = false
    @State private var isSettingsPresented = false
    @State private var showShortcutHelp = false

    init(autoplay: Bool, temporaryUrl: String? = nil, article: ReadingSessionArticle? = nil) {
        self.autoplay = autoplay
        self.temporaryUrl = temporaryUrl
        self.article = article
    }

    var body: some View {
        let busy = player.isPlaying || player.isPreparing
        // The same layout as Android: play/stop in the header, the page, then
        // one toolbar row; voice, language and speed live in a sheet.
        FiloPage(player.currentItem?.article.title ?? L10n.string("リーディングリスト"), showsBack: true) {
            FiloIconButton(
                busy ? .pause : .play,
                label: busy ? "読み上げを停止" : "このページを読み上げ",
                color: FiloPalette.accent,
                filled: busy,
            ) {
                if busy { player.pause() } else { player.play() }
            }
            .disabled(player.currentItem == nil)
        } content: {
            VStack(spacing: 0) {
                Group {
                    if player.isLoading {
                        FiloSpinner()
                    } else if let item = player.currentItem, let url = item.article.canonicalUrl {
                        ReadingWebView(
                            url: url,
                            history: history,
                            captureRequest: player.captureRequest,
                            onLoading: player.pageLoading,
                            onLoaded: player.pageLoaded,
                            onLocationChanged: player.pageLocationChanged,
                            onCaptured: player.receiveCapture,
                            onSelectionChanged: { player.hasSelection = $0 },
                            onEditingChanged: { player.pageEditing = $0 },
                        )
                        .id(player.browserPageId)
                    } else {
                        FiloEmptyState(icon: .playlist, message: player.errorMessage ?? "未読の記事がありません。")
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                if player.currentItem != nil {
                    if let message = player.errorMessage {
                        readingMessage(message, color: FiloPalette.danger)
                    }
                    if let message = player.noticeMessage, busy {
                        readingMessage(message, color: FiloPalette.muted)
                    }
                }
                ReadingToolbar(
                    player: player,
                    onShowReadingList: { isReadingListPresented = true },
                    onShowSettings: { isSettingsPresented = true },
                )
            }
        }
        // Back walks the page history first; the first page closes the screen.
        .environment(\.filoHistoryBack, history.canGoBack ? { history.goBack() } : nil)
        .sheet(isPresented: $isSettingsPresented) {
            ReadingSettingsSheet(player: player)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
                .presentationBackground(FiloPalette.surface)
        }
        .sheet(isPresented: $isReadingListPresented) {
            ReadingListView(
                items: player.visibleReadingListItems,
                isLoading: player.isReadingListLoading,
                currentArticleId: player.currentPageArticleId ?? -1,
                onSelect: { articleId in
                    player.select(articleId: articleId)
                    isReadingListPresented = false
                },
                onRemove: player.removeFromReadingList,
                onClose: { isReadingListPresented = false },
            )
            .presentationDetents([.medium, .large])
            .presentationBackground(FiloPalette.background)
        }
        .task { await player.start(autoplay: autoplay, temporaryUrl: temporaryUrl, article: article) }
        .onAppear {
            player.isReadingBrowserVisible = true
        }
        .onDisappear { player.isReadingBrowserVisible = false }
        .modifier(ReadingTranslationTask(player: player))
        .background(
            VStack(spacing: 0) {
                Button("", action: { if player.isPlaying || player.isPreparing { player.pause() } else { player.play() } }).keyboardShortcut(.space, modifiers: [])
                Button("", action: player.selectNext).keyboardShortcut("j", modifiers: [])
                Button("", action: player.selectPrevious).keyboardShortcut("k", modifiers: [])
                Button("", action: player.addCurrentPageToReadingList).keyboardShortcut("s", modifiers: [])
                Button("", action: {
                    if let urlString = player.currentPageUrl, let url = URL(string: urlString) { openURL(url) }
                }).keyboardShortcut("v", modifiers: [])
                Button("", action: { dismiss() }).keyboardShortcut(.escape, modifiers: [])
                Button("", action: { showShortcutHelp = true }).keyboardShortcut("?", modifiers: [])
            }
            .frame(width: 1, height: 1)
            .opacity(0)
            .disabled(player.pageEditing)
            .accessibilityHidden(true)
        )
        .sheet(isPresented: $showShortcutHelp) { ShortcutHelpView() }
    }

    private func readingMessage(_ message: String, color: Color) -> some View {
        Text(message)
            .filoFont(13)
            .foregroundStyle(color)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, FiloMetrics.gutter)
            .padding(.vertical, 8)
            .background(FiloPalette.background)
    }
}

private struct ReadingTranslationTask: ViewModifier {
    @ObservedObject var player: ReadingPlayerStore
    @State private var configuration: TranslationSession.Configuration?

    func body(content: Content) -> some View {
        content
            .onChange(of: player.translationRequest, initial: true) { _, request in
                guard let request else { configuration = nil; return }
                let source = Locale.Language(identifier: request.source)
                let target = Locale.Language(identifier: request.target)
                if var existing = configuration, existing.source == source, existing.target == target {
                    existing.invalidate()
                    configuration = existing
                } else {
                    configuration = TranslationSession.Configuration(source: source, target: target)
                }
            }
            .translationTask(configuration) { session in await player.runTranslation(session: session) }
    }
}

// The reading-list actions in one row under the page (Android `ReadingToolbar`).
private struct ReadingToolbar: View {
    @ObservedObject var player: ReadingPlayerStore
    let onShowReadingList: () -> Void
    let onShowSettings: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            FiloButton("リスト", icon: .playlist, kind: .ghost, small: true, action: onShowReadingList)
            FiloButton("追加", icon: .queueAdd, kind: .ghost, small: true) {
                player.addCurrentPageToReadingList()
            }
            .disabled(player.isAddingToReadingList || player.currentItem == nil)
            FiloButton("選択範囲を読み上げ", icon: .play, kind: .ghost, small: true, action: player.playSelection)
                .disabled(!player.hasSelection)
            Spacer(minLength: 0)
            FiloIconButton(.sliders, label: "読み上げ設定", action: onShowSettings)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity)
        .background(FiloPalette.background.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { FiloDivider() }
    }
}

// Voice, language and speed are set once and rarely again, so they stay out
// of the page in a sheet (Android `ReadingSettingsSheet`).
private struct ReadingSettingsSheet: View {
    @ObservedObject var player: ReadingPlayerStore

    private static let languages: [(code: String, name: String)] = [
        ("ja", "日本語"), ("en", "English"), ("zh", "简体中文"), ("ko", "한국어"), ("es", "Español"),
    ]
    private static let rates: [Float] = [0.75, 1, 1.25, 1.5, 2, 3]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(localized: "読み上げ設定")
                .filoFont(16, .bold)
                .padding(.vertical, 12)
                .accessibilityAddTraits(.isHeader)
            setting("声") {
                FiloSelect(
                    selection: Binding(
                        get: { player.voiceIdentifier ?? "" },
                        set: { player.setVoice($0.isEmpty ? nil : $0) },
                    ),
                    options: [("", L10n.string("自動"))] + player.availableVoices.map { ($0.identifier, $0.name) },
                    label: "声",
                )
            }
            FiloDivider()
            setting("言語") {
                FiloSelect(
                    selection: Binding(get: { player.targetLanguage }, set: player.setLanguage),
                    options: Self.languages.map { ($0.code, $0.name) },
                    label: "言語",
                )
            }
            FiloDivider()
            setting("速度") {
                FiloSelect(
                    selection: Binding(get: { player.rate }, set: player.setRate),
                    options: Self.rates.map { ($0, "\($0.formatted())x") },
                    label: "速度",
                )
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(FiloPalette.text)
        .padding(.horizontal, 20)
        .padding(.top, 12)
    }

    private func setting<Control: View>(_ label: String, @ViewBuilder control: () -> Control) -> some View {
        HStack(spacing: 12) {
            Text(localized: label)
                .filoFont(14)
                .frame(maxWidth: .infinity, alignment: .leading)
            control()
                .frame(maxWidth: 200)
        }
        .frame(minHeight: 52)
    }
}

struct ReadingMiniPlayer: View {
    @ObservedObject var player: ReadingPlayerStore

    var body: some View {
        HStack(spacing: 12) {
            FiloIcon(.play, size: 14, color: FiloPalette.accent, filled: true)
            Text(player.currentPlaybackTitle ?? player.currentItem?.article.title ?? L10n.string("読み上げ中"))
                .filoFont(14)
                .foregroundStyle(FiloPalette.text)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            FiloButton("停止", icon: .pause, kind: .ghost, small: true) {
                player.pause()
            }
        }
        .padding(.leading, FiloMetrics.gutter)
        .padding(.trailing, FiloMetrics.gutter - 8)
        .padding(.vertical, 8)
        .background(FiloPalette.surface.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { FiloDivider() }
    }
}

private struct ReadingListView: View {
    let items: [ReadingSessionItem]
    let isLoading: Bool
    let currentArticleId: Int
    let onSelect: (Int) -> Void
    let onRemove: (Int) -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(localized: "リーディングリスト")
                    .filoFont(16, .bold)
                    .frame(maxWidth: .infinity, alignment: .leading)
                FiloIconButton(.close, label: "閉じる", action: onClose)
            }
            .padding(.leading, FiloMetrics.gutter)
            .padding(.trailing, FiloMetrics.gutter - 8)
            .frame(height: FiloMetrics.headerHeight)
            .overlay(alignment: .bottom) { FiloDivider() }
            if items.isEmpty {
                if isLoading {
                    FiloSpinner()
                } else {
                    FiloEmptyState(icon: .playlist, message: "リーディングリストに記事がありません。")
                }
                Spacer(minLength: 0)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(items) { item in
                            row(item)
                        }
                    }
                }
            }
        }
        .foregroundStyle(FiloPalette.text)
    }

    private func row(_ item: ReadingSessionItem) -> some View {
        let isCurrent = item.articleId == currentArticleId
        return HStack(spacing: 8) {
            Button {
                onSelect(item.articleId)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.article.title)
                        .filoFont(15, isCurrent ? .semibold : .regular)
                        .lineSpacing(4)
                        .lineLimit(2)
                    Text(verbatim: "\(L10n.string(item.isRead ? "既読" : "未読")) · \(item.article.feed.title)")
                        .filoFont(12)
                        .foregroundStyle(FiloPalette.muted)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(item.article.canonicalUrl == nil)
            FiloIconButton(.trash, label: "リーディングリストから削除", size: 16, danger: true) {
                onRemove(item.articleId)
            }
            .disabled(item.articleId <= 0)
            .padding(.trailing, -10)
        }
        .padding(.horizontal, FiloMetrics.gutter)
        .padding(.vertical, 12)
        .background(isCurrent ? FiloPalette.rowHover : .clear)
        .overlay(alignment: .leading) {
            if isCurrent { Rectangle().fill(FiloPalette.accent).frame(width: 3) }
        }
        .overlay(alignment: .bottom) { FiloDivider() }
    }
}

private struct ReadingWebView: UIViewRepresentable {
    let url: String
    let history: ReadingPageHistory
    let captureRequest: ReadingCaptureRequest?
    let onLoading: () -> Void
    let onLoaded: (String?, String?) -> Void
    let onLocationChanged: (String, String) -> Void
    let onCaptured: (ReadingCaptureRequest, String?, String?) -> Void
    let onSelectionChanged: (Bool) -> Void
    let onEditingChanged: (Bool) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onLoading: onLoading, onLoaded: onLoaded, onLocationChanged: onLocationChanged, onCaptured: onCaptured, onSelectionChanged: onSelectionChanged, onEditingChanged: onEditingChanged)
    }

    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "filoSelection")
        controller.add(context.coordinator, name: "filoLocation")
        controller.add(context.coordinator, name: "filoEditing")
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.scrollView.isScrollEnabled = true
        webView.scrollView.alwaysBounceVertical = true
        for edge in [UIRectEdge.left, .right] {
            let swipe = UIScreenEdgePanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.edgeSwiped))
            swipe.edges = edge
            swipe.delegate = context.coordinator
            webView.addGestureRecognizer(swipe)
        }
        webView.navigationDelegate = context.coordinator
        context.coordinator.webView = webView
        history.attach(webView)
        if let value = URL(string: url) { webView.load(URLRequest(url: value)) }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.request(captureRequest)
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, UIGestureRecognizerDelegate {
        weak var webView: WKWebView?
        private let onLoading: () -> Void
        private let onLoaded: (String?, String?) -> Void
        private let onLocationChanged: (String, String) -> Void
        private let onCaptured: (ReadingCaptureRequest, String?, String?) -> Void
        private let onSelectionChanged: (Bool) -> Void
        private let onEditingChanged: (Bool) -> Void
        private var loaded = false
        private var pending: ReadingCaptureRequest?
        private var handledId: Int?
        private var navigationVersion = 0

        private static let swipeDistance: CGFloat = 60

        private static let scripts: String = ["Readability", "FiloCapture"]
            .compactMap { name in
                Bundle.main.path(forResource: name, ofType: "js").flatMap { try? String(contentsOfFile: $0, encoding: .utf8) }
            }
            .joined(separator: ";\n")

        init(
            onLoading: @escaping () -> Void,
            onLoaded: @escaping (String?, String?) -> Void,
            onLocationChanged: @escaping (String, String) -> Void,
            onCaptured: @escaping (ReadingCaptureRequest, String?, String?) -> Void,
            onSelectionChanged: @escaping (Bool) -> Void,
            onEditingChanged: @escaping (Bool) -> Void,
        ) {
            self.onLoading = onLoading
            self.onLoaded = onLoaded
            self.onLocationChanged = onLocationChanged
            self.onCaptured = onCaptured
            self.onSelectionChanged = onSelectionChanged
            self.onEditingChanged = onEditingChanged
        }

        // Edge swipes step through the page history. WKWebView's own gesture
        // does not navigate inside this screen, and without history the swipe
        // falls through to the navigation stack, which closes the screen.
        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let swipe = gestureRecognizer as? UIScreenEdgePanGestureRecognizer, let webView else { return true }
            return swipe.edges == .left ? webView.canGoBack : webView.canGoForward
        }

        @objc func edgeSwiped(_ swipe: UIScreenEdgePanGestureRecognizer) {
            guard swipe.state == .ended, let webView else { return }
            let distance = swipe.translation(in: webView).x
            if swipe.edges == .left, distance > Self.swipeDistance {
                webView.goBack()
            } else if swipe.edges == .right, distance < -Self.swipeDistance {
                webView.goForward()
            }
        }

        // Capture when asked, once the page has loaded.
        func request(_ request: ReadingCaptureRequest?) {
            guard let request, request.id != handledId else { return }
            pending = request
            if loaded { capturePending() }
        }

        private func capturePending() {
            guard let request = pending, let webView else { return }
            pending = nil
            handledId = request.id
            let kind = request.kind == .selection ? "selection" : "page"
            Task {
                var captured = await Self.capture(webView, kind: kind)
                // A page that renders after load gets one more try.
                if captured == nil, request.kind == .page {
                    try? await Task.sleep(for: .milliseconds(800))
                    captured = await Self.capture(webView, kind: kind)
                }
                onCaptured(request, captured?.text, captured?.language)
            }
        }

        private static func capture(_ webView: WKWebView, kind: String) async -> (text: String, language: String?)? {
            let result = try? await webView.evaluateJavaScript("window.__filoCapture ? window.__filoCapture('\(kind)') : null")
            guard let body = result as? [String: Any], let text = body["text"] as? String, !text.isEmpty else { return nil }
            return (text, body["lang"] as? String)
        }

        private func finishLoading(_ webView: WKWebView) {
            let version = navigationVersion
            let script = Self.scripts + """
            ;(() => {
              const report = () => window.webkit.messageHandlers.filoSelection.postMessage(window.__filoHasSelection());
              document.addEventListener('selectionchange', report);
              report();
              const editing = () => {
                const e = document.activeElement;
                window.webkit.messageHandlers.filoEditing.postMessage(!!e && (e.matches('input, textarea, select') || e.isContentEditable));
              };
              document.addEventListener('focusin', editing);
              document.addEventListener('focusout', () => setTimeout(editing, 0));
              editing();
              if (!window.__filoLocationHook) {
                window.__filoLocationHook = true;
                let last = location.href;
                const changed = () => {
                  if (last === location.href) return;
                  last = location.href;
                  window.webkit.messageHandlers.filoLocation.postMessage({url: last, title: document.title || ''});
                };
                for (const name of ['pushState', 'replaceState']) {
                  const original = history[name];
                  history[name] = function(...args) { const result = original.apply(this, args); changed(); return result; };
                }
                addEventListener('popstate', changed);
                addEventListener('hashchange', changed);
              }
            })();
            """
            webView.evaluateJavaScript(script) { [weak self] _, _ in
                guard let self else { return }
                guard version == navigationVersion else { return }
                loaded = true
                onLoaded(webView.url?.absoluteString, webView.title)
                capturePending()
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            finishLoading(webView)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            navigationVersion += 1
            loaded = false
            pending = nil
            onLoading()
        }

        // A failed load still lets the reader fall back to the server's extraction.
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            finishLoading(webView)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            finishLoading(webView)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            if message.name == "filoLocation", let body = message.body as? [String: String], let url = body["url"] {
                onLocationChanged(url, body["title"] ?? "")
            } else if message.name == "filoSelection" {
                onSelectionChanged(message.body as? Bool ?? false)
            } else if message.name == "filoEditing" {
                onEditingChanged(message.body as? Bool ?? false)
            }
        }
    }
}
