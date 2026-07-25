import AVFoundation
import MediaPlayer
import SwiftUI
import WebKit

private extension Float {
    var nonZero: Float? { self == 0 ? nil : self }
}

// MARK: - TTS player bar (placed in AppNavigationView)

struct TTSPlayerBar: View {
    @ObservedObject var tts: TTSPlayerManager

    private var displayUrl: String? {
        if let url = tts.viewingArticleUrl { return url }
        return tts.currentItem?.url
    }

    private var displayTitle: String {
        if tts.viewingArticleUrl != nil { return tts.viewingArticleTitle ?? "" }
        return tts.articleTitle ?? ""
    }

    private var faviconURL: URL? {
        guard let urlStr = displayUrl,
              let url = URL(string: urlStr),
              let host = url.host else { return nil }
        return URL(string: "https://www.google.com/s2/favicons?domain=\(host)&sz=32")
    }

    private var canPlay: Bool {
        if tts.isViewingUnqueuedArticle {
            return tts.viewingArticleText != nil
        }
        if let viewingUrl = tts.viewingArticleUrl,
           let item = tts.queue.first(where: { $0.url == viewingUrl }) {
            return item.extractionState == .ready
        }
        return tts.currentExtractionState == .ready
    }

    private var isPlaying: Bool {
        guard let url = displayUrl,
              tts.currentItem?.url == url else { return false }
        return tts.playState == .playing
    }

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            VStack(spacing: 6) {
                HStack(spacing: 10) {
                    AsyncImage(url: faviconURL) { image in
                        image.resizable().aspectRatio(contentMode: .fit)
                    } placeholder: {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color(uiColor: .tertiarySystemFill))
                            .overlay {
                                Image(systemName: "doc.text")
                                    .font(.system(size: 10))
                                    .foregroundStyle(.secondary)
                            }
                    }
                    .frame(width: 20, height: 20)
                    .clipShape(RoundedRectangle(cornerRadius: 4))

                    ScrollView(.horizontal, showsIndicators: false) {
                        Text(displayTitle)
                            .font(.callout.weight(.medium))
                            .lineLimit(1)
                            .fixedSize()
                    }

                    Spacer(minLength: 0)

                    Button { handlePlay() } label: {
                        Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                            .font(.title3)
                            .frame(width: 36, height: 36)
                            .contentShape(Rectangle())
                    }
                    .disabled(!canPlay)
                }

                HStack(spacing: 8) {
                    Button { tts.showQueue = true } label: {
                        Text("\(tts.queue.count)件")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(Color(uiColor: .tertiarySystemFill))
                            .clipShape(Capsule())
                    }

                    if tts.isViewingUnqueuedArticle && !tts.viewingArticleExtractionFailed {
                        Button { tts.addViewingArticleToQueue() } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "plus")
                                    .font(.caption2.weight(.bold))
                                Text("追加")
                            }
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(Color(uiColor: .tertiarySystemFill))
                            .clipShape(Capsule())
                        }
                    }

                    Spacer()

                    voiceMenu

                    Button {
                        let options = TTSPlayerManager.rateOptions
                        let idx = options.firstIndex(of: tts.rate) ?? 0
                        tts.setRate(options[(idx + 1) % options.count])
                    } label: {
                        Text(rateLabel(tts.rate))
                            .font(.caption.weight(.semibold))
                            .monospacedDigit()
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(Color(uiColor: .tertiarySystemFill))
                            .clipShape(Capsule())
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(Color(uiColor: .secondarySystemBackground))
    }

    private func handlePlay() {
        if tts.isViewingUnqueuedArticle {
            tts.addViewingArticleToQueue()
            if let url = tts.viewingArticleUrl,
               let index = tts.queue.firstIndex(where: { $0.url == url }) {
                tts.skipToItem(at: index)
            }
            return
        }
        if let viewingUrl = tts.viewingArticleUrl,
           let index = tts.queue.firstIndex(where: { $0.url == viewingUrl }) {
            if index == tts.currentIndex {
                if tts.playState == .playing { tts.pause() } else { tts.play() }
            } else {
                tts.skipToItem(at: index)
            }
            return
        }
        if tts.playState == .playing { tts.pause() } else { tts.play() }
    }

    private func rateLabel(_ r: Float) -> String {
        r.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(r)).0x" : String(format: "%.2gx", r)
    }

    // 再生中記事の言語の読み上げ音声を選ぶ。「自動」でデフォルト音声に戻す
    @ViewBuilder
    private var voiceMenu: some View {
        let lang = tts.currentSpeechLang
        let key = TTSPlayerManager.voiceLangKey(lang)
        let options = tts.voiceOptions(for: lang)
        if !options.isEmpty {
            Menu {
                Button {
                    tts.setVoice(lang: lang, identifier: nil)
                } label: {
                    if tts.voicePrefs[key] == nil {
                        Label("自動", systemImage: "checkmark")
                    } else {
                        Text("自動")
                    }
                }
                ForEach(options, id: \.identifier) { voice in
                    Button {
                        tts.setVoice(lang: lang, identifier: voice.identifier)
                    } label: {
                        if tts.voicePrefs[key] == voice.identifier {
                            Label(voice.name, systemImage: "checkmark")
                        } else {
                            Text(voice.name)
                        }
                    }
                }
            } label: {
                Image(systemName: "person.wave.2")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Color(uiColor: .tertiarySystemFill))
                    .clipShape(Capsule())
                    .accessibilityLabel("読み上げ音声 (\(key))")
            }
        }
    }
}

// MARK: - Queue sheet

struct TTSQueueSheet: View {
    @ObservedObject var tts: TTSPlayerManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(Array(tts.queue.enumerated()), id: \.element.id) { index, item in
                    Button { tts.skipToItem(at: index) } label: {
                        HStack(spacing: 12) {
                            if index == tts.currentIndex {
                                Image(systemName: tts.playState == .playing ? "speaker.wave.2.fill" : "speaker.fill")
                                    .foregroundStyle(.tint)
                                    .frame(width: 24)
                            } else {
                                Text("\(index + 1)")
                                    .font(.callout)
                                    .foregroundStyle(.secondary)
                                    .frame(width: 24)
                            }

                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.title)
                                    .font(.body)
                                    .lineLimit(2)
                                    .fontWeight(index == tts.currentIndex ? .semibold : .regular)
                                    .foregroundStyle(.primary)

                                switch item.extractionState {
                                case .loading:
                                    Label("読み込み中", systemImage: "arrow.circlepath")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                case .failed:
                                    Label("取得失敗", systemImage: "exclamationmark.triangle")
                                        .font(.caption)
                                        .foregroundStyle(.red)
                                case .ready:
                                    EmptyView()
                                case .idle:
                                    EmptyView()
                                }
                            }
                        }
                    }
                }
                .onDelete { offsets in
                    for index in offsets.sorted(by: >) {
                        tts.removeFromQueue(at: index)
                    }
                    if tts.queue.isEmpty { dismiss() }
                }
                .onMove { offsets, destination in
                    tts.moveInQueue(fromOffsets: offsets, toOffset: destination)
                }
            }
            .navigationTitle("再生キュー")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if tts.queue.count > 1 {
                        Button("すべて削除", role: .destructive) {
                            tts.dismiss()
                            dismiss()
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("閉じる") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
