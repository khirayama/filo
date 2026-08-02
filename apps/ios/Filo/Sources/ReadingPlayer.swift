import AVFoundation
import MediaPlayer
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
    @Published var index = -1
    @Published var isLoading = false
    @Published var isPlaying = false
    @Published var extractedText: String?
    @Published var extractedLanguage: String?
    @Published var errorMessage: String?
    @Published var rate: Float = UserDefaults.standard.float(forKey: "filo:readingRate") == 0
        ? 1.0 : UserDefaults.standard.float(forKey: "filo:readingRate")
    @Published var targetLanguage = "ja"
    @Published var voiceIdentifier: String? = UserDefaults.standard.string(forKey: "filo:readingVoice")
    @Published fileprivate var translationRequest: ReadingTranslationRequest?

    private let synthesizer = AVSpeechSynthesizer()
    private var chunks: [String] = []
    private var chunkIndex = 0
    private var continuousRead = false
    private var startingAutoplay = false
    private var progressSyncAt = Date.distantPast
    private var translationToken = 0
    private var pendingOriginalText: String?

    var currentItem: ReadingSessionItem? {
        guard index >= 0, index < items.count else { return nil }
        return items[index]
    }
    var canPrevious: Bool { index > 0 }
    var canNext: Bool { index >= 0 && index + 1 < items.count }
    var availableVoices: [AVSpeechSynthesisVoice] {
        AVSpeechSynthesisVoice.speechVoices().filter { targetLanguage.isEmpty || $0.language.hasPrefix(targetLanguage) }
    }

    override init() {
        super.init()
        synthesizer.delegate = self
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        configureRemoteCommands()
    }

    func start(autoplay: Bool) async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        startingAutoplay = autoplay
        continuousRead = autoplay
        do {
            async let sessionTask = APIClient.shared.startReadingSession()
            async let settingsTask = APIClient.shared.getSettings()
            let session = try await sessionTask
            let settings = try? await settingsTask
            targetLanguage = settings?.language ?? targetLanguage
            items = session.items
            if let currentId = session.playbackState?.currentArticleId,
               let currentIndex = items.firstIndex(where: { $0.articleId == currentId }) {
                index = currentIndex
            } else {
                index = -1
                errorMessage = "未読の記事がありません。"
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
        continuousRead = true
        let source = extractedLanguage ?? currentItem?.article.sourceLanguage
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
        if synthesizer.isPaused {
            synthesizer.continueSpeaking()
            isPlaying = true
            updateNowPlaying()
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
        synthesizer.pauseSpeaking(at: .word)
        isPlaying = false
        updateNowPlaying()
    }

    func previous() { Task { await move(to: index - 1, markCurrentRead: true) } }
    func next() { Task { await move(to: index + 1, markCurrentRead: true) } }

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

    private func move(to destination: Int, markCurrentRead: Bool) async {
        guard destination >= 0, destination < items.count else {
            synthesizer.stopSpeaking(at: .immediate)
            isPlaying = false
            await syncProgress(1)
            return
        }
        if markCurrentRead, let current = currentItem {
            _ = try? await APIClient.shared.setArticleRead(current.articleId, isRead: true)
        }
        synthesizer.stopSpeaking(at: .immediate)
        index = destination
        resetExtractedContent()
        await syncProgress(0)
    }

    private func resetExtractedContent() {
        extractedText = nil
        extractedLanguage = nil
        chunks = []
        chunkIndex = 0
        isPlaying = false
        startingAutoplay = continuousRead
        updateNowPlaying()
    }

    private func speakCurrentChunk() {
        guard chunkIndex < chunks.count else { return }
        let utterance = AVSpeechUtterance(string: chunks[chunkIndex])
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * rate
        let language = extractedLanguage ?? currentItem?.article.sourceLanguage ?? targetLanguage
        utterance.voice = voiceIdentifier.flatMap(AVSpeechSynthesisVoice.init(identifier:))
            ?? AVSpeechSynthesisVoice(language: language)
        synthesizer.speak(utterance)
        updateNowPlaying()
    }

    private func finishedChunk() {
        chunkIndex += 1
        if chunkIndex < chunks.count {
            speakCurrentChunk()
            return
        }
        isPlaying = false
        Task {
            if let current = currentItem {
                _ = try? await APIClient.shared.setArticleRead(current.articleId, isRead: true)
            }
            await syncProgress(1)
            await move(to: index + 1, markCurrentRead: false)
        }
    }

    private func syncProgress(_ value: Double) async {
        guard let current = currentItem else { return }
        _ = try? await APIClient.shared.updatePlaybackState(
            currentArticleId: current.articleId,
            contentLanguage: extractedLanguage ?? current.article.sourceLanguage,
            positionPercent: value
        )
    }

    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in Task { @MainActor in self?.play() }; return .success }
        center.pauseCommand.addTarget { [weak self] _ in Task { @MainActor in self?.pause() }; return .success }
        center.nextTrackCommand.addTarget { [weak self] _ in Task { @MainActor in self?.next() }; return .success }
        center.previousTrackCommand.addTarget { [weak self] _ in Task { @MainActor in self?.previous() }; return .success }
    }

    private func updateNowPlaying() {
        guard let item = currentItem else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: item.article.title,
            MPMediaItemPropertyArtist: item.article.feed.title,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1 : 0,
        ]
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

    nonisolated func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        willSpeakRangeOfSpeechString characterRange: NSRange,
        utterance: AVSpeechUtterance
    ) {
        Task { @MainActor in
            guard Date().timeIntervalSince(self.progressSyncAt) >= 10 else { return }
            self.progressSyncAt = Date()
            let base = Double(self.chunkIndex) / Double(max(self.chunks.count, 1))
            let within = Double(characterRange.location) / Double(max(utterance.speechString.utf16.count, 1))
            await self.syncProgress(min(1, base + within / Double(max(self.chunks.count, 1))))
        }
    }
}

struct ReadingSessionScreen: View {
    let autoplay: Bool
    @EnvironmentObject private var player: ReadingPlayerStore

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
                ReadingControlBar(player: player)
            } else {
                EmptyStateView { Text(player.errorMessage ?? "未読の記事がありません。") }
            }
        }
        .navigationTitle(player.currentItem?.article.title ?? "リーディングリスト")
        .navigationBarTitleDisplayMode(.inline)
        .task { await player.start(autoplay: autoplay) }
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

private struct ReadingControlBar: View {
    @ObservedObject var player: ReadingPlayerStore

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Button("前へ", action: player.previous).disabled(!player.canPrevious)
                Spacer()
                Button(player.isPlaying ? "一時停止" : "読み上げ") {
                    player.isPlaying ? player.pause() : player.play()
                }
                Spacer()
                Button("次へ", action: player.next).disabled(!player.canNext)
            }
            HStack {
                Text("\(max(player.index + 1, 0))/\(player.items.count)").font(.caption)
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
              // 短い誤抽出を避けつつ、取りこぼしより本文ノイズを許容する設定。
              const article = new Readability(document.cloneNode(true), { charThreshold: 100 }).parse();
              window.webkit.messageHandlers.filoReader.postMessage(article && article.textContent && article.textContent.trim().length >= 100
                ? { text: article.textContent.trim(), lang: article.lang || document.documentElement.lang || null }
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
