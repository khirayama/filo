import AVFoundation
import SwiftUI
import Translation
import WebKit

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
    @Published var isPlaying = false
    @Published var isReadingBrowserVisible = false
    @Published private(set) var isPreparing = false
    @Published private(set) var captureRequest: ReadingCaptureRequest?
    @Published private(set) var isPageLoaded = false
    @Published var hasSelection = false
    @Published var errorMessage: String?
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
    private var temporary = false
    private var translationToken = 0
    private var nextCaptureId = 0
    private var playbackGeneration = 0
    private var pendingOriginalText: String?
    private var speechLanguage: String?
    private var playbackArticleId: Int? = nil
    private var playbackArticleTitle: String? = nil
    private var playbackKind = ReadingCaptureKind.page

    var currentItem: ReadingSessionItem? {
        guard index >= 0, index < items.count else { return nil }
        return items[index]
    }
    var isTemporary: Bool { temporary }
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

    func start(autoplay: Bool, temporaryUrl: String? = nil, article: ReadingSessionArticle? = nil) async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        startingAutoplay = autoplay
        removedReadingListArticleIds = []
        do {
            async let settingsTask = APIClient.shared.getSettings()
            let settings = try? await settingsTask
            targetLanguage = settings?.language ?? targetLanguage
            if let article {
                temporary = false
                items = [ReadingSessionItem(
                    articleId: article.id,
                    sortOrder: 0,
                    article: article,
                    createdAt: nil,
                    isRead: false,
                )]
                index = 0
                readingListItems = (try? await loadReadingList()) ?? []
            } else if let temporaryUrl {
                temporary = true
                readingListItems = []
                let article = ReadingSessionArticle(
                    id: 0,
                    title: temporaryUrl,
                    sourceLanguage: nil,
                    canonicalUrl: temporaryUrl,
                    publishedAt: nil,
                    feed: .init(id: 0, title: L10n.string("共有ページ")),
                )
                items = [ReadingSessionItem(articleId: 0, sortOrder: 0, article: article, createdAt: nil, isRead: false)]
                index = 0
            } else {
                temporary = false
                let readingList = try await loadReadingList()
                items = readingList
                readingListItems = readingList
                index = items.firstIndex(where: { !$0.isRead }) ?? -1
                if index < 0 { errorMessage = L10n.string("未読の記事がありません。") }
            }
            resetPage()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isLoading = false
    }

    func pageLoaded() {
        isPageLoaded = true
        if startingAutoplay {
            startingAutoplay = false
            play()
        }
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
        if let text, !text.isEmpty {
            speak(text, language: language, kind: request.kind)
            return
        }
        guard request.kind == .page, !temporary, let articleId = currentItem?.articleId, articleId > 0 else {
            isPreparing = false
            errorMessage = L10n.string(request.kind == .selection ? "読み上げる文章がありません。" : "本文を抽出できませんでした。")
            return
        }
        Task {
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
        playbackArticleId = kind == .page && !temporary ? currentItem?.articleId : nil
        playbackArticleTitle = currentItem?.article.title
        playbackKind = kind
        let source = language ?? currentItem?.article.sourceLanguage
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
            beginSpeaking(translated.isEmpty ? original : translated, language: translated.isEmpty ? request.source : request.target)
        } catch {
            guard request.token == translationToken else { return }
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
        synthesizer.stopSpeaking(at: .immediate)
        isPlaying = false
    }

    func select(articleId: Int) {
        if let nextIndex = items.firstIndex(where: { $0.articleId == articleId }) {
            guard nextIndex != index else { return }
            markArticleRead(currentItem?.articleId)
            pause()
            index = nextIndex
            resetPage()
            return
        }
        guard let nextIndex = readingListItems.firstIndex(where: { $0.articleId == articleId }) else { return }
        markArticleRead(currentItem?.articleId)
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
        if isPlaying { requestCapture(playbackKind) }
    }

    func addCurrentPageToReadingList() {
        guard !isAddingToReadingList, let item = currentItem, let url = item.article.canonicalUrl else { return }
        isAddingToReadingList = true
        Task {
            defer { isAddingToReadingList = false }
            do {
                _ = try await APIClient.shared.importArticle(url: url, title: item.article.title)
                if !temporary, item.articleId > 0,
                   !readingListItems.contains(where: { $0.articleId == item.articleId }) {
                    readingListItems.append(item)
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

    private func loadReadingList() async throws -> [ReadingSessionItem] {
        var result: [ReadingSessionItem] = []
        var cursor: String?
        repeat {
            let page = try await APIClient.shared.listArticles(
                filters: .init(readingList: true),
                cursor: cursor,
                limit: 100,
            )
            let startIndex = result.count
            let pageItems = page.articles.enumerated().map { offset, article in
                ReadingSessionItem(
                    articleId: article.id,
                    sortOrder: startIndex + offset,
                    article: ReadingSessionArticle(article),
                    createdAt: nil,
                    isRead: article.userState.isRead,
                )
            }
            result.append(contentsOf: pageItems)
            cursor = page.nextCursor
        } while cursor != nil
        return result
    }

    private func resetPage() {
        isPageLoaded = false
        hasSelection = false
        chunks = []
        chunkIndex = 0
    }

    private func speakCurrentChunk() {
        guard chunkIndex < chunks.count else { return }
        let utterance = AVSpeechUtterance(string: chunks[chunkIndex])
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * rate
        let language = speechLanguage ?? targetLanguage
        utterance.voice = voiceIdentifier.flatMap(AVSpeechSynthesisVoice.init(identifier:))
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

struct ReadingSessionScreen: View {
    let autoplay: Bool
    let temporaryUrl: String?
    let article: ReadingSessionArticle?
    @EnvironmentObject private var player: ReadingPlayerStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var isReadingListPresented = false
    @State private var showShortcutHelp = false

    init(autoplay: Bool, temporaryUrl: String? = nil, article: ReadingSessionArticle? = nil) {
        self.autoplay = autoplay
        self.temporaryUrl = temporaryUrl
        self.article = article
    }

    var body: some View {
        FiloPage(player.currentItem?.article.title ?? L10n.string("リーディングリスト"), showsBack: true) {
            if player.isLoading {
                FiloSpinner().frame(maxHeight: .infinity)
            } else if let item = player.currentItem, let url = item.article.canonicalUrl {
                ReadingWebView(
                    url: url,
                    captureRequest: player.captureRequest,
                    onLoaded: player.pageLoaded,
                    onCaptured: player.receiveCapture,
                    onSelectionChanged: { player.hasSelection = $0 },
                )
                .id(item.articleId)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                FiloEmptyState(icon: .playlist, message: player.errorMessage ?? "未読の記事がありません。")
            }
        }
        .sheet(isPresented: $isReadingListPresented) {
            ReadingListView(
                items: player.visibleReadingListItems,
                currentArticleId: player.currentItem?.articleId ?? -1,
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
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ReadingSettingsPanel(player: player) {
                isReadingListPresented = true
            }
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
                    if let urlString = player.currentItem?.article.canonicalUrl, let url = URL(string: urlString) { openURL(url) }
                }).keyboardShortcut("v", modifiers: [])
                Button("", action: { dismiss() }).keyboardShortcut(.escape, modifiers: [])
                Button("", action: { showShortcutHelp = true }).keyboardShortcut("?", modifiers: [])
            }
            .frame(width: 1, height: 1)
            .opacity(0)
            .accessibilityHidden(true)
        )
        .sheet(isPresented: $showShortcutHelp) { ShortcutHelpView() }
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

// The native counterpart of the extension popup controls: one primary action,
// the reading-list actions, then labelled voice/language/speed settings.
private struct ReadingSettingsPanel: View {
    @ObservedObject var player: ReadingPlayerStore
    let onShowReadingList: () -> Void

    private static let languages: [(code: String, name: String)] = [
        ("ja", "日本語"), ("en", "English"), ("zh", "简体中文"), ("ko", "한국어"), ("es", "Español"),
    ]
    private static let rates: [Float] = [0.75, 1, 1.25, 1.5, 2, 3]

    var body: some View {
        let busy = player.isPlaying || player.isPreparing
        VStack(spacing: 10) {
            FiloButton(
                busy ? "読み上げを停止" : "このページを読み上げ",
                icon: busy ? .pause : .play,
                kind: .primary,
                fullWidth: true,
            ) {
                if busy { player.pause() } else { player.play() }
            }
            .disabled(player.currentItem == nil)
            if let message = player.errorMessage, player.currentItem != nil {
                Text(message)
                    .filoFont(13)
                    .foregroundStyle(FiloPalette.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(spacing: 8) {
                FiloButton("リスト", icon: .playlist, small: true, fullWidth: true, action: onShowReadingList)
                    .disabled(player.isTemporary)
                FiloButton("追加", icon: .queueAdd, small: true, fullWidth: true) {
                    player.addCurrentPageToReadingList()
                }
                .disabled(player.isAddingToReadingList || player.currentItem == nil)
                FiloButton("選択範囲を読み上げ", icon: .play, small: true, fullWidth: true, action: player.playSelection)
                    .disabled(!player.hasSelection)
            }
            HStack(spacing: 8) {
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
                setting("言語") {
                    FiloSelect(
                        selection: Binding(get: { player.targetLanguage }, set: player.setLanguage),
                        options: Self.languages.map { ($0.code, $0.name) },
                        label: "言語",
                    )
                }
                .frame(maxWidth: 120)
                setting("速度") {
                    FiloSelect(
                        selection: Binding(get: { player.rate }, set: player.setRate),
                        options: Self.rates.map { ($0, "\($0.formatted())x") },
                        label: "速度",
                    )
                }
                .frame(maxWidth: 88)
            }
        }
        .padding(.horizontal, FiloMetrics.gutter)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity)
        .background(FiloPalette.surface.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { FiloDivider() }
    }

    private func setting<Control: View>(_ label: String, @ViewBuilder control: () -> Control) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(localized: label)
                .filoFont(12, .semibold)
                .foregroundStyle(FiloPalette.muted)
            control()
        }
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
                FiloEmptyState(icon: .playlist, message: "リーディングリストに記事がありません。")
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
    let captureRequest: ReadingCaptureRequest?
    let onLoaded: () -> Void
    let onCaptured: (ReadingCaptureRequest, String?, String?) -> Void
    let onSelectionChanged: (Bool) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onLoaded: onLoaded, onCaptured: onCaptured, onSelectionChanged: onSelectionChanged)
    }

    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "filoSelection")
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.scrollView.isScrollEnabled = true
        webView.scrollView.alwaysBounceVertical = true
        webView.navigationDelegate = context.coordinator
        context.coordinator.webView = webView
        if let value = URL(string: url) { webView.load(URLRequest(url: value)) }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.request(captureRequest)
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        private let onLoaded: () -> Void
        private let onCaptured: (ReadingCaptureRequest, String?, String?) -> Void
        private let onSelectionChanged: (Bool) -> Void
        private var loaded = false
        private var pending: ReadingCaptureRequest?
        private var handledId: Int?

        private static let scripts: String = ["Readability", "FiloCapture"]
            .compactMap { name in
                Bundle.main.path(forResource: name, ofType: "js").flatMap { try? String(contentsOfFile: $0, encoding: .utf8) }
            }
            .joined(separator: ";\n")

        init(
            onLoaded: @escaping () -> Void,
            onCaptured: @escaping (ReadingCaptureRequest, String?, String?) -> Void,
            onSelectionChanged: @escaping (Bool) -> Void,
        ) {
            self.onLoaded = onLoaded
            self.onCaptured = onCaptured
            self.onSelectionChanged = onSelectionChanged
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
            let script = Self.scripts + """
            ;(() => {
              const report = () => window.webkit.messageHandlers.filoSelection.postMessage(window.__filoHasSelection());
              document.addEventListener('selectionchange', report);
              report();
            })();
            """
            webView.evaluateJavaScript(script) { [weak self] _, _ in
                guard let self else { return }
                loaded = true
                onLoaded()
                capturePending()
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            finishLoading(webView)
        }

        // A failed load still lets the reader fall back to the server's extraction.
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            finishLoading(webView)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            finishLoading(webView)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            onSelectionChanged(message.body as? Bool ?? false)
        }
    }
}
