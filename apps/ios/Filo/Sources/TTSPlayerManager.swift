import AVFoundation
import MediaPlayer
import SwiftUI
import WebKit

private extension Float {
    var nonZero: Float? { self == 0 ? nil : self }
}

// MARK: - Shared TTS player manager with queue support

@MainActor
final class TTSPlayerManager: NSObject, ObservableObject {
    enum PlayState { case idle, playing, paused }
    enum ExtractionState { case idle, loading, ready, failed }

    struct QueueItem: Identifiable {
        let id = UUID()
        let url: String
        let title: String
        var extractionState: ExtractionState = .loading
        var chunks: [String] = []
        var lang: String?
        // サーバー playback-queue 上の記事 id。未解決(サーバー未同期)の項目は nil。
        var articleId: Int?
    }

    @Published var playState: PlayState = .idle
    @Published var currentChunk = 0
    @Published var totalChunks = 0
    @Published var rate: Float = UserDefaults.standard.float(forKey: "ttsRate").nonZero ?? 1.5
    // 言語ごとの読み上げ音声設定 (例: ["ja": voice identifier])。未設定なら自動。
    // web の PlayerContext (filo:ttsVoices) と同じ方針でローカル保存する
    @Published var voicePrefs: [String: String] = (UserDefaults.standard.dictionary(forKey: "ttsVoices") as? [String: String]) ?? [:]
    @Published var queue: [QueueItem] = []
    @Published var currentIndex: Int = -1
    @Published var showQueue = false

    @Published var viewingArticleUrl: String?
    @Published var viewingArticleTitle: String?
    @Published var viewingArticleText: String?
    @Published var viewingArticleLang: String?
    @Published var viewingArticleExtractionFailed = false

    static let rateOptions: [Float] = [0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0]

    private let synthesizer = AVSpeechSynthesizer()
    // 再生位置のサーバー保存はおよそ10秒間隔に間引く(SPEC/API.md playback-queue/state)
    private static let positionSyncInterval: TimeInterval = 10
    private var lastPositionSyncAt = Date.distantPast

    var hasArticle: Bool { !queue.isEmpty }
    var currentItem: QueueItem? {
        guard currentIndex >= 0, currentIndex < queue.count else { return nil }
        return queue[currentIndex]
    }
    var articleTitle: String? { currentItem?.title }
    var currentExtractionState: ExtractionState { currentItem?.extractionState ?? .idle }

    var isViewingUnqueuedArticle: Bool {
        guard let url = viewingArticleUrl else { return false }
        return !queue.contains(where: { $0.url == url })
    }
    var shouldShowPlayerBar: Bool { hasArticle || viewingArticleUrl != nil }

    override init() {
        super.init()
        synthesizer.delegate = self
        setupAudioSession()
        setupRemoteCommands()
    }

    private func setupAudioSession() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    private func setupRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.play() }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.pause() }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if self.playState == .playing { self.pause() } else { self.play() }
            }
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self, self.currentIndex + 1 < self.queue.count else { return }
                self.skipToItem(at: self.currentIndex + 1)
            }
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self, self.currentIndex > 0 else { return }
                self.skipToItem(at: self.currentIndex - 1)
            }
            return .success
        }
    }

    private func updateNowPlaying() {
        guard hasArticle else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        var info = [String: Any]()
        info[MPMediaItemPropertyTitle] = articleTitle ?? "Filo"
        info[MPMediaItemPropertyArtist] = "Filo"
        info[MPNowPlayingInfoPropertyPlaybackRate] = playState == .playing ? 1.0 : 0.0
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = Double(currentChunk)
        info[MPMediaItemPropertyPlaybackDuration] = Double(max(totalChunks, 1))
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info

        let center = MPRemoteCommandCenter.shared()
        center.nextTrackCommand.isEnabled = currentIndex + 1 < queue.count
        center.previousTrackCommand.isEnabled = currentIndex > 0
    }

    func markArticleActive(url: String, title: String) {
        if queue.contains(where: { $0.url == url }) { return }
        queue.append(QueueItem(url: url, title: title))
        if currentIndex < 0 { currentIndex = 0 }
        pushAddedItemToServer(url: url)
    }

    func isQueued(articleId: Int) -> Bool {
        queue.contains { $0.articleId == articleId }
    }

    // 記事一覧からの「音読キューへ追加」。サーバーへ追加してから本文を解決する。
    func addToQueue(articleId: Int, title: String, url: String?) {
        guard !isQueued(articleId: articleId) else { return }
        var item = QueueItem(url: url ?? "", title: title)
        item.articleId = articleId
        queue.append(item)
        if currentIndex < 0 { currentIndex = 0 }
        Task {
            try? await APIClient.shared.addPlaybackQueueItems([articleId])
            // 音読キュー追加時に必要な範囲で本文を取得・解決する(CONCEPT.md 読み上げ方針)
            try? await APIClient.shared.requestArticleContent(articleId)
            let speech = await Self.fetchSpeechText(articleId: articleId)
            guard let index = queue.firstIndex(where: { $0.articleId == articleId }) else { return }
            if let speech {
                queue[index].lang = speech.lang
                queue[index].chunks = Self.splitIntoChunks(Self.cleanTextForSpeech(speech.text))
                queue[index].extractionState = .ready
                if index == currentIndex, playState == .idle {
                    totalChunks = queue[index].chunks.count
                    currentChunk = 0
                }
            } else {
                queue[index].extractionState = .failed
            }
            updateNowPlaying()
        }
    }

    func removeFromQueue(articleId: Int) {
        guard let index = queue.firstIndex(where: { $0.articleId == articleId }) else { return }
        removeFromQueue(at: index)
    }

    // MARK: - Server queue sync

    private static func normalizeUrl(_ url: String?) -> String? {
        guard let url, var components = URLComponents(string: url) else { return url }
        components.fragment = nil
        return components.string ?? url
    }

    // ローカル追加をサーバー playback-queue へ反映する(記事解決は URL lookup)
    private func pushAddedItemToServer(url: String) {
        Task {
            guard let lookup = try? await APIClient.shared.lookupArticle(url: url) else { return }
            if !lookup.inQueue {
                try? await APIClient.shared.addPlaybackQueueItems([lookup.id])
                // 音読キュー追加時に必要な範囲で本文を取得・解決する(他端末の連続再生用)
                try? await APIClient.shared.requestArticleContent(lookup.id)
            }
            if let index = queue.firstIndex(where: { $0.url == url }) {
                queue[index].articleId = lookup.id
            }
        }
    }

    // サーバー共有キューの取り込み: 他端末(Web / Android / Extension)で追加された記事を
    // ローカルキューへ反映し、サーバー側で消えた項目を取り除く。
    func syncWithServer() async {
        guard let data = try? await APIClient.shared.getPlaybackQueue() else { return }

        // URL 一致でローカル項目に articleId を付与する
        var byUrl: [String: Int] = [:]
        for entry in data.items {
            if let normalized = Self.normalizeUrl(entry.article.canonicalUrl) {
                byUrl[normalized] = entry.articleId
            }
        }
        for index in queue.indices where queue[index].articleId == nil {
            if let match = Self.normalizeUrl(queue[index].url).flatMap({ byUrl[$0] }) {
                queue[index].articleId = match
            }
        }

        // 停止中のみ削除・並び替えを適用する(再生中はローカルを優先)
        let serverIds = Set(data.items.map(\.articleId))
        if playState == .idle {
            let currentId = currentItem?.id
            queue.removeAll { item in
                guard let articleId = item.articleId else { return false }
                return !serverIds.contains(articleId)
            }
            if let currentId, let index = queue.firstIndex(where: { $0.id == currentId }) {
                currentIndex = index
            } else if queue.isEmpty {
                currentIndex = -1
            } else if currentIndex >= queue.count || currentIndex < 0 {
                currentIndex = 0
            }
        }

        // サーバーにあってローカルにない記事は本文を取得して追加する
        for entry in data.items where !queue.contains(where: { $0.articleId == entry.articleId }) {
            guard let speech = await Self.fetchSpeechText(articleId: entry.articleId) else { continue }
            var item = QueueItem(url: entry.article.canonicalUrl ?? "", title: entry.article.title)
            item.articleId = entry.articleId
            item.lang = speech.lang
            item.chunks = Self.splitIntoChunks(Self.cleanTextForSpeech(speech.text))
            item.extractionState = .ready
            queue.append(item)
            if currentIndex < 0 { currentIndex = 0 }
        }

        if playState == .idle {
            // サーバーの並び順を優先し、サーバー未同期のローカル項目は末尾に置く
            let orderMap = Dictionary(uniqueKeysWithValues: data.items.enumerated().map { ($0.element.articleId, $0.offset) })
            let currentId = currentItem?.id
            queue = queue.enumerated().sorted { lhs, rhs in
                let lhsOrder = lhs.element.articleId.flatMap { orderMap[$0] } ?? Int.max
                let rhsOrder = rhs.element.articleId.flatMap { orderMap[$0] } ?? Int.max
                if lhsOrder != rhsOrder { return lhsOrder < rhsOrder }
                return lhs.offset < rhs.offset
            }.map(\.element)
            if let currentId, let index = queue.firstIndex(where: { $0.id == currentId }) {
                currentIndex = index
            }

            // サーバー保存の再生位置から再開できるようにする
            if let state = data.playbackState,
               let currentArticleId = state.currentArticleId,
               let index = queue.firstIndex(where: { $0.articleId == currentArticleId }) {
                currentIndex = index
                let item = queue[index]
                if item.extractionState == .ready, !item.chunks.isEmpty {
                    totalChunks = item.chunks.count
                    currentChunk = min(Int(state.positionPercent * Double(item.chunks.count)), item.chunks.count - 1)
                }
            }
        }
        updateNowPlaying()
    }

    // 読み上げ対象本文の解決: 抽出本文 > RSS本文。本文翻訳は扱わない(プラットフォーム翻訳に委ねる)
    private static func fetchSpeechText(articleId: Int) async -> (text: String, lang: String?)? {
        if let content = try? await APIClient.shared.getArticleContent(articleId), content.status == "ready",
           let text = content.text ?? content.html {
            return (text, content.sourceLanguage)
        }
        if let detail = try? await APIClient.shared.getArticle(articleId),
           let raw = detail.rssContentHtml ?? detail.rssSummary {
            return (raw, detail.sourceLanguage)
        }
        return nil
    }

    // 読み上げ開始: 既読化 + 再生中記事・言語としてサーバーへ保存
    private func notifyPlaybackStarted() {
        guard let item = currentItem, let articleId = item.articleId else { return }
        let fraction = totalChunks > 0 ? Double(currentChunk) / Double(totalChunks) : 0
        let lang = item.lang
        lastPositionSyncAt = Date()
        Task {
            _ = try? await APIClient.shared.setArticleRead(articleId, isRead: true)
            try? await APIClient.shared.updatePlaybackState(currentArticleId: articleId, contentLanguage: lang, positionPercent: fraction)
        }
    }

    private func syncPositionIfNeeded(force: Bool = false) {
        guard let item = currentItem, item.articleId != nil, totalChunks > 0 else { return }
        guard force || Date().timeIntervalSince(lastPositionSyncAt) >= Self.positionSyncInterval else { return }
        lastPositionSyncAt = Date()
        let fraction = min(max(Double(currentChunk) / Double(totalChunks), 0), 1)
        Task { try? await APIClient.shared.updatePlaybackState(positionPercent: fraction) }
    }

    func prepareArticle(url: String, title: String, text: String, lang: String?) {
        guard let index = queue.firstIndex(where: { $0.url == url }) else { return }
        guard queue[index].chunks.isEmpty else { return }
        let cleaned = Self.cleanTextForSpeech(text)
        let newChunks = Self.splitIntoChunks(cleaned)
        queue[index].lang = lang
        queue[index].chunks = newChunks
        queue[index].extractionState = .ready
        if index == currentIndex {
            totalChunks = newChunks.count
            currentChunk = 0
        }
    }

    func markExtractionFailed(url: String) {
        guard let index = queue.firstIndex(where: { $0.url == url }) else { return }
        guard queue[index].extractionState == .loading else { return }
        queue[index].extractionState = .failed
    }

    func setViewingArticle(url: String, title: String) {
        viewingArticleUrl = url
        viewingArticleTitle = title
        viewingArticleText = nil
        viewingArticleLang = nil
        viewingArticleExtractionFailed = false
    }

    func clearViewingArticle() {
        viewingArticleUrl = nil
        viewingArticleTitle = nil
        viewingArticleText = nil
        viewingArticleLang = nil
        viewingArticleExtractionFailed = false
    }

    func addViewingArticleToQueue() {
        guard let url = viewingArticleUrl, let title = viewingArticleTitle else { return }
        markArticleActive(url: url, title: title)
        if let text = viewingArticleText {
            prepareArticle(url: url, title: title, text: text, lang: viewingArticleLang)
        } else if viewingArticleExtractionFailed {
            markExtractionFailed(url: url)
        }
    }

    func play() {
        guard let item = currentItem, item.extractionState == .ready, !item.chunks.isEmpty else { return }
        switch playState {
        case .idle:
            totalChunks = item.chunks.count
            if currentChunk >= totalChunks { currentChunk = 0 }
            playState = .playing
            speakCurrentChunk()
            notifyPlaybackStarted()
        case .paused:
            if synthesizer.isPaused {
                synthesizer.continueSpeaking()
                playState = .playing
            } else {
                playState = .playing
                speakCurrentChunk()
            }
        case .playing:
            break
        }
        updateNowPlaying()
    }

    func pause() {
        guard playState == .playing else { return }
        synthesizer.pauseSpeaking(at: .word)
        playState = .paused
        syncPositionIfNeeded(force: true)
        updateNowPlaying()
    }

    func dismiss() {
        synthesizer.stopSpeaking(at: .immediate)
        queue.removeAll()
        currentIndex = -1
        playState = .idle
        currentChunk = 0
        totalChunks = 0
        updateNowPlaying()
        Task { try? await APIClient.shared.clearPlaybackQueue() }
    }

    func setRate(_ newRate: Float) {
        rate = newRate
        UserDefaults.standard.set(newRate, forKey: "ttsRate")
        guard playState == .playing else { return }
        synthesizer.stopSpeaking(at: .immediate)
        speakCurrentChunk()
    }

    static func voiceLangKey(_ lang: String) -> String {
        String(lang.prefix(2)).lowercased()
    }

    // 音声メニューの対象言語。再生中(または表示中)記事の言語に従う
    var currentSpeechLang: String {
        currentItem?.lang ?? viewingArticleLang ?? "ja"
    }

    func voiceOptions(for lang: String) -> [AVSpeechSynthesisVoice] {
        let key = Self.voiceLangKey(lang)
        return AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.lowercased().hasPrefix(key) }
            .sorted { $0.name < $1.name }
    }

    // identifier が nil なら「自動(デフォルト音声)」に戻す
    func setVoice(lang: String, identifier: String?) {
        let key = Self.voiceLangKey(lang)
        if let identifier {
            voicePrefs[key] = identifier
        } else {
            voicePrefs.removeValue(forKey: key)
        }
        UserDefaults.standard.set(voicePrefs, forKey: "ttsVoices")
        guard playState == .playing else { return }
        synthesizer.stopSpeaking(at: .immediate)
        speakCurrentChunk()
    }

    private func resolveVoice(for lang: String) -> AVSpeechSynthesisVoice? {
        if let id = voicePrefs[Self.voiceLangKey(lang)], let voice = AVSpeechSynthesisVoice(identifier: id) {
            return voice
        }
        return AVSpeechSynthesisVoice(language: lang == "ja" ? "ja-JP" : lang)
    }

    func skipToItem(at index: Int) {
        guard index >= 0, index < queue.count else { return }
        synthesizer.stopSpeaking(at: .immediate)
        currentIndex = index
        let item = queue[index]
        if item.extractionState == .ready && !item.chunks.isEmpty {
            totalChunks = item.chunks.count
            currentChunk = 0
            playState = .playing
            speakCurrentChunk()
            notifyPlaybackStarted()
        } else {
            playState = .idle
            totalChunks = 0
            currentChunk = 0
        }
        updateNowPlaying()
    }

    func removeFromQueue(at index: Int) {
        guard index >= 0, index < queue.count else { return }
        if let articleId = queue[index].articleId {
            Task { try? await APIClient.shared.removePlaybackQueueItem(articleId) }
        }
        if index == currentIndex {
            synthesizer.stopSpeaking(at: .immediate)
            queue.remove(at: index)
            if queue.isEmpty {
                currentIndex = -1
                playState = .idle
                currentChunk = 0
                totalChunks = 0
            } else {
                currentIndex = min(index, queue.count - 1)
                playState = .idle
                if let item = currentItem, item.extractionState == .ready {
                    totalChunks = item.chunks.count
                    currentChunk = 0
                } else {
                    totalChunks = 0
                    currentChunk = 0
                }
            }
        } else {
            queue.remove(at: index)
            if index < currentIndex { currentIndex -= 1 }
        }
    }

    private func speakCurrentChunk() {
        guard let item = currentItem,
              currentChunk < item.chunks.count,
              playState == .playing else {
            if playState == .playing { advanceToNext() }
            return
        }
        let utterance = AVSpeechUtterance(string: item.chunks[currentChunk])
        utterance.rate = min(AVSpeechUtteranceDefaultSpeechRate * rate, AVSpeechUtteranceMaximumSpeechRate)
        utterance.pitchMultiplier = 1.0
        if let lang = item.lang {
            utterance.voice = resolveVoice(for: lang)
        }
        synthesizer.speak(utterance)
        updateNowPlaying()
    }

    private func advanceToNext() {
        // 読み上げ完了した記事はキュー(サーバー含む)から取り除き、次の記事へ進む
        if currentIndex >= 0, currentIndex < queue.count {
            let finished = queue[currentIndex]
            if let articleId = finished.articleId {
                Task { try? await APIClient.shared.removePlaybackQueueItem(articleId) }
            }
            queue.remove(at: currentIndex)
        }
        guard currentIndex < queue.count else {
            playState = .idle
            currentChunk = 0
            totalChunks = 0
            currentIndex = queue.isEmpty ? -1 : queue.count - 1
            Task { try? await APIClient.shared.updatePlaybackState(clearCurrentArticle: true, positionPercent: 0) }
            updateNowPlaying()
            return
        }
        let item = queue[currentIndex]
        if item.extractionState == .ready && !item.chunks.isEmpty {
            totalChunks = item.chunks.count
            currentChunk = 0
            speakCurrentChunk()
            notifyPlaybackStarted()
        } else {
            playState = .idle
        }
        updateNowPlaying()
    }

    func moveInQueue(fromOffsets: IndexSet, toOffset: Int) {
        let currentId = currentItem?.id
        queue.move(fromOffsets: fromOffsets, toOffset: toOffset)
        if let currentId, let index = queue.firstIndex(where: { $0.id == currentId }) {
            currentIndex = index
        }
        // サーバーの PUT order は全件一致が必要なため、全項目が同期済みのときだけ送る
        let articleIds = queue.compactMap(\.articleId)
        if articleIds.count == queue.count, !articleIds.isEmpty {
            Task { try? await APIClient.shared.reorderPlaybackQueue(articleIds) }
        }
    }

    // MARK: - Text preparation (ported from extension ttsTextPrep.ts)

    static func cleanTextForSpeech(_ text: String) -> String {
        var t = text
        t = t.replacingOccurrences(of: "```[\\s\\S]*?```", with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: "`[^`]+`", with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: "https?://[^\\s)\\}\\]>]+", with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: "[\\w.+\\-]+@[\\w\\-]+\\.[\\w.\\-]+", with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: "\\[(image|photo|img|figure|caption|ad|advertisement|banner|nav|menu|sidebar|footer|header)\\]", with: "", options: [.regularExpression, .caseInsensitive])
        t = t.replacingOccurrences(of: "[^\\S\\n]{2,}", with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: "\\n{3,}", with: "\n\n", options: .regularExpression)
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func splitIntoChunks(_ text: String, maxLength: Int = 3000) -> [String] {
        let paragraphs = text.components(separatedBy: "\n\n")
        var chunks: [String] = []
        var current = ""
        for para in paragraphs {
            let trimmed = para.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            if current.count + trimmed.count + 1 <= maxLength {
                current += (current.isEmpty ? "" : "\n\n") + trimmed
                continue
            }
            if !current.isEmpty { chunks.append(current); current = "" }
            if trimmed.count <= maxLength { current = trimmed; continue }
            splitLongText(trimmed, maxLength: maxLength, out: &chunks)
        }
        if !current.isEmpty { chunks.append(current) }
        return chunks.isEmpty ? [text.trimmingCharacters(in: .whitespacesAndNewlines)] : chunks
    }

    private static func splitLongText(_ text: String, maxLength: Int, out: inout [String]) {
        var remaining = text
        while remaining.count > maxLength {
            let slice = String(remaining.prefix(maxLength))
            var splitAt = findLastMatch(slice, pattern: "[。.!?！？]\\s*")
            if splitAt < maxLength * 3 / 10 { splitAt = findLastMatch(slice, pattern: "[、,;；]\\s*") }
            if splitAt < maxLength * 3 / 10, let idx = slice.lastIndex(of: " ") {
                splitAt = slice.distance(from: slice.startIndex, to: idx) + 1
            }
            if splitAt < maxLength * 3 / 10 { splitAt = maxLength }
            out.append(String(remaining.prefix(splitAt)).trimmingCharacters(in: .whitespacesAndNewlines))
            remaining = String(remaining.dropFirst(splitAt)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if !remaining.isEmpty { out.append(remaining) }
    }

    private static func findLastMatch(_ text: String, pattern: String) -> Int {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return -1 }
        let range = NSRange(text.startIndex..., in: text)
        var last = -1
        regex.enumerateMatches(in: text, range: range) { match, _, _ in
            if let m = match { last = m.range.location + m.range.length }
        }
        return last
    }
}

extension TTSPlayerManager: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            guard self.playState == .playing else { return }
            self.currentChunk += 1
            self.syncPositionIfNeeded()
            self.speakCurrentChunk()
        }
    }
}
