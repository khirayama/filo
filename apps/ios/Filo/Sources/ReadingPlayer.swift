import AVFoundation
import SwiftUI
import Translation
import WebKit

private struct ReadingTranslationRequest: Equatable {
    let source: String
    let target: String
    let token: Int
}

@MainActor
final class ReadingPlayerStore: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published var items: [ReadingSessionItem] = []
    @Published var readingListItems: [ReadingSessionItem] = []
    @Published var index = -1
    @Published var isLoading = false
    @Published var isPlaying = false
    @Published var isReadingBrowserVisible = false
    @Published var extractedText: String?
    @Published var extractedLanguage: String?
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
    private var pendingOriginalText: String?
    private var playbackArticleId: Int? = nil
    private var playbackArticleTitle: String? = nil
    private var playbackTemporary = false

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
                    feed: .init(id: 0, title: "共有ページ", faviconUrl: nil),
                )
                items = [ReadingSessionItem(articleId: 0, sortOrder: 0, article: article, createdAt: nil, isRead: false)]
                index = 0
            } else {
                temporary = false
                let readingList = try await loadReadingList()
                items = readingList
                readingListItems = readingList
                index = items.firstIndex(where: { !$0.isRead }) ?? -1
                if index < 0 { errorMessage = "未読の記事がありません。" }
            }
            resetExtractedContent()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isLoading = false
    }

    func receiveExtracted(text: String, language: String?) {
        extractedText = clean(text)
        extractedLanguage = language ?? currentItem?.article.sourceLanguage
        if startingAutoplay {
            startingAutoplay = false
            play()
        }
    }

    func extractionFailed() {
        if temporary {
            errorMessage = "本文を抽出できませんでした。"
            return
        }
        guard let articleId = currentItem?.articleId else { return }
        Task {
            _ = try? await APIClient.shared.requestArticleContent(articleId)
            for _ in 0 ..< 12 {
                try? await Task.sleep(for: .milliseconds(500))
                guard let content = try? await APIClient.shared.getArticleContent(articleId) else { continue }
                if content.status == "ready", let text = content.text {
                    receiveExtracted(text: text, language: content.sourceLanguage)
                    return
                }
                if content.status == "error" { break }
            }
            errorMessage = "本文を抽出できませんでした。"
        }
    }

    func play() {
        guard let text = extractedText, !text.isEmpty else {
            extractionFailed()
            return
        }
        let source = extractedLanguage ?? currentItem?.article.sourceLanguage
        if let source, source.split(separator: "-").first != targetLanguage.split(separator: "-").first {
            playbackArticleId = currentItem?.articleId
            playbackArticleTitle = currentItem?.article.title
            playbackTemporary = temporary
            pendingOriginalText = text
            translationToken += 1
            translationRequest = ReadingTranslationRequest(source: source, target: targetLanguage, token: translationToken)
            return
        }
        playbackArticleId = currentItem?.articleId
        playbackArticleTitle = currentItem?.article.title
        playbackTemporary = temporary
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
        if synthesizer.isPaused {
            synthesizer.continueSpeaking()
            isPlaying = true
            return
        }
        synthesizer.stopSpeaking(at: .immediate)
        extractedLanguage = language
        chunks = Self.split(text)
        chunkIndex = 0
        isPlaying = true
        speakCurrentChunk()
    }

    func pause() {
        translationToken += 1
        translationRequest = nil
        pendingOriginalText = nil
        synthesizer.stopSpeaking(at: .immediate)
        isPlaying = false
    }

    func select(articleId: Int) {
        if let nextIndex = items.firstIndex(where: { $0.articleId == articleId }) {
            guard nextIndex != index else { return }
            pause()
            index = nextIndex
            resetExtractedContent()
            return
        }
        guard let nextIndex = readingListItems.firstIndex(where: { $0.articleId == articleId }) else { return }
        pause()
        items = readingListItems
        index = nextIndex
        resetExtractedContent()
    }

    func setRate(_ value: Float) {
        rate = min(3, max(0.75, value))
        UserDefaults.standard.set(rate, forKey: "filo:readingRate")
        if isPlaying { play() }
    }

    func setVoice(_ identifier: String?) {
        voiceIdentifier = identifier
        UserDefaults.standard.set(identifier, forKey: "filo:readingVoice")
        if isPlaying { play() }
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

    private func resetExtractedContent() {
        let preservePlayback = isPlaying
        extractedText = nil
        extractedLanguage = nil
        if !preservePlayback {
            chunks = []
            chunkIndex = 0
        }
    }

    private func speakCurrentChunk() {
        guard chunkIndex < chunks.count else { return }
        let utterance = AVSpeechUtterance(string: chunks[chunkIndex])
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * rate
        let language = extractedLanguage ?? currentItem?.article.sourceLanguage ?? targetLanguage
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
        Task {
            if !playbackTemporary, let playbackArticleId {
                _ = try? await APIClient.shared.setArticleRead(playbackArticleId, isRead: true)
            }
        }
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
    @State private var isReadingListPresented = false

    init(autoplay: Bool, temporaryUrl: String? = nil, article: ReadingSessionArticle? = nil) {
        self.autoplay = autoplay
        self.temporaryUrl = temporaryUrl
        self.article = article
    }

    var body: some View {
        VStack(spacing: 0) {
            if player.isLoading {
                ProgressView("読み込み中…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let item = player.currentItem, let url = item.article.canonicalUrl {
                ReadingWebView(url: url) { text, language in
                    player.receiveExtracted(text: text, language: language)
                } onFailure: {
                    player.extractionFailed()
                }
                .id(item.articleId)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                EmptyStateView { Text(player.errorMessage ?? "未読の記事がありません。") }
            }
        }
        .navigationTitle(player.currentItem?.article.title ?? "リーディングリスト")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $isReadingListPresented) {
            NavigationStack {
                ReadingListView(
                    items: player.visibleReadingListItems,
                    currentArticleId: player.currentItem?.articleId ?? -1,
                    onSelect: { articleId in
                        player.select(articleId: articleId)
                        isReadingListPresented = false
                    },
                    onRemove: player.removeFromReadingList,
                )
                .navigationTitle("リーディングリスト")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("閉じる") { isReadingListPresented = false }
                    }
                }
            }
            .presentationDetents([.medium, .large])
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ReadingSettingsPanel(player: player) {
                isReadingListPresented = true
            }
        }
        .task { await player.start(autoplay: autoplay, temporaryUrl: temporaryUrl, article: article) }
        .onAppear { player.isReadingBrowserVisible = true }
        .onDisappear { player.isReadingBrowserVisible = false }
        .modifier(ReadingTranslationTask(player: player))
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

private struct ReadingSettingsPanel: View {
    @ObservedObject var player: ReadingPlayerStore
    let onShowReadingList: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            Button(player.isPlaying ? "停止" : "このページを読み上げ") {
                if player.isPlaying { player.pause() } else { player.play() }
            }
            .buttonStyle(.borderedProminent)
            HStack {
                Button {
                    onShowReadingList()
                } label: {
                    Label("リスト", systemImage: "list.bullet")
                }
                .disabled(player.isTemporary)
                Button("リストに追加") { player.addCurrentPageToReadingList() }
                    .disabled(player.isAddingToReadingList)
            }
            HStack {
                Picker("声", selection: Binding(
                    get: { player.voiceIdentifier ?? "" },
                    set: { player.setVoice($0.isEmpty ? nil : $0) }
                )) {
                    Text("自動").tag("")
                    ForEach(player.availableVoices, id: \.identifier) { Text($0.name).tag($0.identifier) }
                }.labelsHidden()
                Picker("言語", selection: $player.targetLanguage) {
                    ForEach(["ja", "en", "zh", "ko", "es"], id: \.self) { Text($0).tag($0) }
                }.labelsHidden()
                Picker("速度", selection: Binding(get: { player.rate }, set: player.setRate)) {
                    ForEach([Float(0.75), 1, 1.25, 1.5, 2, 3], id: \.self) { Text("\($0, specifier: "%.2g")x").tag($0) }
                }.labelsHidden()
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
    }
}

struct ReadingMiniPlayer: View {
    @ObservedObject var player: ReadingPlayerStore

    var body: some View {
        HStack(spacing: 12) {
            Text(player.currentPlaybackTitle ?? player.currentItem?.article.title ?? "読み上げ中")
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button("停止") { player.pause() }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

private struct ReadingListView: View {
    let items: [ReadingSessionItem]
    let currentArticleId: Int
    let onSelect: (Int) -> Void
    let onRemove: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if items.isEmpty {
                Text("リーディングリストに記事がありません。")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 16)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(items) { item in
                            HStack(spacing: 8) {
                                Button {
                                    onSelect(item.articleId)
                                } label: {
                                    HStack(spacing: 8) {
                                        Image(systemName: item.articleId == currentArticleId ? "circle.fill" : "circle")
                                            .font(.system(size: 7))
                                            .foregroundStyle(item.articleId == currentArticleId ? Color.accentColor : Color.secondary)
                                        Text(item.article.title)
                                            .font(.body)
                                            .lineLimit(2)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                    }
                                }
                                .buttonStyle(.plain)
                                .disabled(item.article.canonicalUrl == nil)
                                Button {
                                    onRemove(item.articleId)
                                } label: {
                                    Label("削除", systemImage: "trash")
                                        .labelStyle(.iconOnly)
                                }
                                .buttonStyle(.borderless)
                                .foregroundStyle(.secondary)
                                .disabled(item.articleId <= 0)
                            }
                            .padding(.vertical, 8)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}

private struct ReadingWebView: UIViewRepresentable {
    let url: String
    let onExtracted: (String, String?) -> Void
    let onFailure: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onExtracted: onExtracted, onFailure: onFailure) }

    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "filoReader")
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.scrollView.isScrollEnabled = true
        webView.scrollView.alwaysBounceVertical = true
        webView.navigationDelegate = context.coordinator
        if let value = URL(string: url) { webView.load(URLRequest(url: value)) }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let onExtracted: (String, String?) -> Void
        let onFailure: () -> Void

        init(onExtracted: @escaping (String, String?) -> Void, onFailure: @escaping () -> Void) {
            self.onExtracted = onExtracted
            self.onFailure = onFailure
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard let path = Bundle.main.path(forResource: "Readability", ofType: "js"),
                  let readability = try? String(contentsOfFile: path, encoding: .utf8) else {
                onFailure(); return
            }
            let script = """
            \(readability)
            (() => {
              const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
              const article = new Readability(document.cloneNode(true), { charThreshold: 100 }).parse();
              const text = (() => {
                if (!article) return '';
                const root = document.implementation.createHTMLDocument('').body;
                root.innerHTML = article.content || '';
                const blocks = new Set(['H1','H2','H3','H4','H5','H6','P','LI','BLOCKQUOTE','PRE','FIGCAPTION','DT','DD']);
                const lines = [];
                const visit = node => Array.from(node.children).forEach(child => {
                  if (blocks.has(child.tagName)) { const value = normalize(child.textContent); if (value) lines.push(value); }
                  else visit(child);
                });
                visit(root);
                if (!lines.length) lines.push(...normalize(article.textContent).split(/\\n+/).filter(Boolean));
                const title = normalize(article.title) || normalize(document.title);
                return [title, ...(lines[0] === title ? lines.slice(1) : lines)].filter(Boolean).join('\\n\\n');
              })();
              window.webkit.messageHandlers.filoReader.postMessage(text.length >= 100
                ? { text, lang: article.lang || document.documentElement.lang || null }
                : { error: true });
            })();
            """
            webView.evaluateJavaScript(script) { _, error in if error != nil { self.onFailure() } }
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let text = body["text"] as? String else {
                onFailure(); return
            }
            onExtracted(text, body["lang"] as? String)
        }
    }
}
