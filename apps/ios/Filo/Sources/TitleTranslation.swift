import Foundation
import SwiftUI
import Translation

// MARK: - 一覧タイトルの端末内翻訳 (SPEC/APP.md)
//
// OS の Translation framework だけを使い、翻訳エンジンは自前で持たない。翻訳結果は
// サーバーへ保存しない。手動トグルでのみ起動し、言語判定による自動翻訳は行わない。
//
// Web の src/lib/titleTranslator.ts と Android の TitleTranslator.kt が同じ役割を
// 担う。片方だけ直すとプラットフォーム間で挙動がずれるので、必ず全部を更新する。

// MARK: - スキップ規則
//
// **原文言語の判定はサーバーが行う**(apps/api/src/lib/languageDetect.ts)。フィード全体を
// 連結した長文とフィード言語を事前確率にして決めており、端末側の短いタイトル 1 本より
// はるかに材料が多い。判定器を端末ごとに持つと挙動が揃わないので、ここでは
// `article.sourceLanguage` をそのまま使う。
enum TitleTranslationRules {
    // 読める言語の記事は原文のまま出す(SPEC/DATABASE.md の表示規則と同じ)
    static func needsTranslation(source: String, target: String, readable: [String]) -> Bool {
        let base = baseCode(source)
        guard base != baseCode(target) else { return false }
        return !readable.contains(where: { baseCode($0) == base })
    }

    // "zh-Hans" のような地域つきコードを ja/en/zh/ko/es と比べられる形にする
    static func baseCode(_ code: String) -> String {
        String(code.split(separator: "-").first ?? "")
    }
}

// Translation framework は 1 セッション 1 言語ペアなので、原文言語ごとに実行する。
struct TitleTranslationBatch: Equatable {
    let source: String
    let target: String
    // 同じ言語ペアが連続しても新しいセッションとして扱うための識別子
    let token: Int
    // 準備(言語モデルの取得)だけを行い、翻訳はしない
    let isPreparation: Bool
}

// 言語ペアごとの準備状態。翻訳が動かないときにユーザーが原因を見られるようにする。
struct TitleTranslationLanguage: Identifiable, Equatable {
    enum Status: Equatable {
        case installed      // ダウンロード済み。すぐ翻訳できる
        case downloadable   // 対応しているが未ダウンロード
        case unsupported    // この端末ではこの言語ペアを翻訳できない
        case unknown
    }

    let code: String
    var status: Status

    var id: String { code }

    var displayName: String {
        Locale.current.localizedString(forIdentifier: code)
            ?? Locale.current.localizedString(forLanguageCode: String(code.split(separator: "-").first ?? ""))
            ?? code
    }
}

@MainActor
final class TitleTranslationStore: ObservableObject {
    static let shared = TitleTranslationStore()

    private static let enabledKey = "filo.translateTitles"

    @Published private(set) var titles: [Int: String] = [:]
    @Published private(set) var isTranslating = false
    @Published private(set) var isEnabled: Bool
    @Published private(set) var batch: TitleTranslationBatch?
    @Published private(set) var lastError: String?
    // 準備画面（オンボーディング）の状態
    @Published var isShowingSetup = false
    @Published private(set) var languages: [TitleTranslationLanguage] = []
    @Published private(set) var isPreparing = false
    // 端末そのものが端末内翻訳に対応しているか（シミュレータでは false になる）
    @Published private(set) var isDeviceSupported = true
    @Published private(set) var hasCheckedLanguages = false

    // 候補がないときは、端末が対応していても翻訳操作を表示しない。
    // Android / Web と同じく、候補の再計算中は確認前として表示する。
    var isSupported: Bool {
        !candidates.isEmpty && (!hasCheckedLanguages || isDeviceSupported)
    }

    // 原文言語 -> 未翻訳のタイトル
    private var pending: [String: [(id: Int, title: String)]] = [:]
    // 対応しているが未ダウンロードの言語ペア。準備完了後に pending へ戻す。
    private var waitingForPreparation: [String: [(id: Int, title: String)]] = [:]
    // 同じ記事を二度投げないための記録
    private var requested: Set<Int> = []
    private var token = 0
    // 実行中のバッチ。セッションが二重に張られても、後から来た方は何もしない
    private var runningToken: Int?
    private var target = "ja"
    private var readableLanguages = ["ja"]
    // ダウンロード済みの原文言語。準備画面の表示に使う
    private var installedLanguages: [String] = []
    // 準備画面の候補。購読に実在する言語だけを並べる
    private var candidates: [String] = []
    // 設定変更時に候補を再計算できるよう、絞り込み前の言語も保持する。
    private var subscriptionLanguages: [String] = []

    private init() {
        isEnabled = UserDefaults.standard.object(forKey: Self.enabledKey) as? Bool ?? true
    }

    func title(for articleId: Int) -> String? { titles[articleId] }

    func toggle() {
        isEnabled.toggle()
        UserDefaults.standard.set(isEnabled, forKey: Self.enabledKey)
        if !isEnabled {
            reset()
            return
        }
        // ON にした時点で準備状況を確かめ、1つも使えないなら準備画面へ誘導する。
        // 一覧をスクロールしている最中に OS のダウンロード確認が割り込むのを避ける。
        Task {
            await refreshLanguages()
            if !languages.contains(where: { $0.status == .installed }) {
                isShowingSetup = true
            }
        }
    }

    // MARK: - 準備（オンボーディング）

    // 準備画面の候補を購読の言語から作る。訳す必要がない言語は除く。
    // Web は対応言語を列挙できないため、3 プラットフォームで同じ出所にしてある。
    func setCandidates(_ subscriptions: [Subscription]) {
        let next = subscriptions
            .compactMap { $0.feed.language }
            .reduce(into: [String]()) { unique, code in
                if !unique.contains(code) { unique.append(code) }
            }
            .sorted()
        let changed = subscriptionLanguages != next
        subscriptionLanguages = next
        updateCandidates()
        if changed {
            languages = []
            installedLanguages = []
            hasCheckedLanguages = false
            isDeviceSupported = true
        }
    }

    // 候補の言語ごとに、表示言語へ翻訳できるかを OS へ問い合わせる
    func refreshLanguages() async {
        let availability = LanguageAvailability()
        let targetLanguage = Locale.Language(identifier: target)

        var result: [TitleTranslationLanguage] = []
        for code in candidates {
            let status = await availability.status(from: Locale.Language(identifier: code), to: targetLanguage)
            switch status {
            case .installed: result.append(TitleTranslationLanguage(code: code, status: .installed))
            case .supported: result.append(TitleTranslationLanguage(code: code, status: .downloadable))
            case .unsupported: result.append(TitleTranslationLanguage(code: code, status: .unsupported))
            @unknown default: result.append(TitleTranslationLanguage(code: code, status: .unknown))
            }
        }

        languages = result.sorted { $0.displayName < $1.displayName }
        isDeviceSupported = candidates.isEmpty || result.contains { $0.status == .installed || $0.status == .downloadable }
        installedLanguages = result.filter { $0.status == .installed }.map(\.code)
        resumePreparedTitles()
        hasCheckedLanguages = true
        #if DEBUG
        print("[title-translation] target=\(target) supported=\(isDeviceSupported) installed=\(installedLanguages)")
        #endif
    }

    // 指定した原文言語の言語モデルを取得する。実際の取得はセッション側で行うため、
    // ここでは準備用のバッチを立てるだけ。
    func prepare(source: String) {
        guard !isPreparing, batch == nil else { return }
        isPreparing = true
        lastError = nil
        token += 1
        batch = TitleTranslationBatch(source: source, target: target, token: token, isPreparation: true)
    }

    // 表示言語と「原文のまま読む言語」を反映する。表示言語が変われば翻訳結果は使えない。
    func configure(language: String, readableLanguages: [String]) {
        let readableChanged = self.readableLanguages != readableLanguages
        self.readableLanguages = readableLanguages
        guard language != target || readableChanged else { return }
        target = language
        reset()
        updateCandidates()
    }

    // 表示中の記事を翻訳対象として登録する。トグル ON の間はスクロールで増えた分も翻訳する。
    func register(_ articles: [ArticleListItem]) {
        guard isEnabled else { return }
        let waitingIds = Set(waitingForPreparation.values.flatMap { $0.map(\.id) })
        for article in articles where !requested.contains(article.id) {
            guard !waitingIds.contains(article.id) else { continue }
            let title = article.title.trimmingCharacters(in: .whitespacesAndNewlines)
            // 原文言語はサーバーが決めている。不明な記事は原文のまま出す
            guard !title.isEmpty, let source = article.sourceLanguage else { continue }
            guard TitleTranslationRules.needsTranslation(source: source, target: target, readable: readableLanguages)
            else { continue }
            requested.insert(article.id)
            pending[source, default: []].append((id: article.id, title: title))
        }
        #if DEBUG
        print("[title-translation] register: pending=\(pending.mapValues(\.count)) readable=\(readableLanguages)")
        #endif
        startNextBatchIfIdle()
    }

    // View 側の translationTask から呼ばれる。1 バッチ = 1 言語ペア。
    func run(session: TranslationSession) async {
        // 同じバッチに対して二重にセッションが張られた場合、後から来た方は
        // 状態に触れずに戻る。触ると先行セッションを畳んでしまう。
        guard let current = batch, current.token != runningToken else { return }
        runningToken = current.token

        // 準備バッチは言語モデルを取るだけで、翻訳はしない
        if current.isPreparation {
            do {
                try await session.prepareTranslation()
                guard batch?.token == current.token else { return }
                lastError = nil
            } catch {
                guard batch?.token == current.token else { return }
                lastError = error.localizedDescription
                #if DEBUG
                print("[title-translation] prepare \(current.source) -> \(current.target): \(error)")
                #endif
            }
            await refreshLanguages()
            isPreparing = false
            finish(token: current.token)
            return
        }

        let items = pending.removeValue(forKey: current.source) ?? []
        guard !items.isEmpty else {
            finish(token: current.token)
            return
        }

        // 未ダウンロードの言語をここで取りに行くと、一覧のスクロール中に OS の確認
        // ダイアログが割り込む。取得は準備画面（明示操作）だけで行い、ここでは
        // 準備できていない言語を素通しする。
        let availability = await LanguageAvailability().status(
            from: Locale.Language(identifier: current.source),
            to: Locale.Language(identifier: current.target),
        )
        guard batch?.token == current.token else { return }
        guard availability == .installed else {
            let sourceName = LanguageManager.shared.locale.localizedString(forLanguageCode: Self.baseCode(current.source)) ?? current.source
            lastError = L10n.format("%@は準備できていません。設定の「翻訳の準備」からダウンロードしてください。", sourceName)
            requested.subtract(items.map(\.id))
            if availability == .supported {
                waitingForPreparation[current.source, default: []].append(contentsOf: items)
            }
            await refreshLanguages()
            finish(token: current.token)
            return
        }

        do {
            let requests = items.map {
                TranslationSession.Request(sourceText: $0.title, clientIdentifier: String($0.id))
            }
            // 応答順は保証されないので clientIdentifier で戻す
            let responses = try await session.translations(from: requests)
            guard batch?.token == current.token else { return }
            for response in responses {
                guard let identifier = response.clientIdentifier, let id = Int(identifier) else { continue }
                let text = response.targetText.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { continue }
                titles[id] = text
            }
            lastError = nil
        } catch {
            guard batch?.token == current.token else { return }
            // このバッチは原文のまま残す。黙って落ちると原因が追えないので理由は残す
            lastError = error.localizedDescription
            #if DEBUG
            print("[title-translation] \(current.source) -> \(current.target): \(error)")
            #endif
        }
        finish(token: current.token)
    }

    // バッチを終えて次へ進む。自分が担当したバッチのときだけ動く。
    private func finish(token: Int) {
        guard batch?.token == token else { return }
        batch = nil
        startNextBatchIfIdle()
    }

    private func reset() {
        titles.removeAll()
        pending.removeAll()
        waitingForPreparation.removeAll()
        requested.removeAll()
        // 表示言語が変われば言語ペアの可否も変わるので、確認からやり直す
        hasCheckedLanguages = false
        languages = []
        installedLanguages = []
        isDeviceSupported = true
        batch = nil
        runningToken = nil
        lastError = nil
        isTranslating = false
    }

    private func startNextBatchIfIdle() {
        guard isEnabled, batch == nil else { return }
        guard let source = pending.first(where: { !$0.value.isEmpty })?.key else {
            isTranslating = false
            return
        }
        token += 1
        isTranslating = true
        batch = TitleTranslationBatch(source: source, target: target, token: token, isPreparation: false)
    }

    private func resumePreparedTitles() {
        for source in installedLanguages {
            guard let items = waitingForPreparation.removeValue(forKey: source) else { continue }
            pending[source, default: []].append(contentsOf: items)
            requested.formUnion(items.map(\.id))
        }
        startNextBatchIfIdle()
    }

    private func updateCandidates() {
        let targetBase = Self.baseCode(target)
        candidates = subscriptionLanguages.filter { code in
            let base = Self.baseCode(code)
            return base != targetBase && !readableLanguages.contains(where: { Self.baseCode($0) == base })
        }
    }

    private static func baseCode(_ code: String) -> String { TitleTranslationRules.baseCode(code) }
}

// MARK: - セッションの取り付け
//
// TranslationSession は SwiftUI のビューに紐づくため、この modifier を付けて初めて
// 翻訳が走る。バックグラウンドでの一括翻訳はできない。
//
// **アプリ全体で 1 箇所にだけ付ける**(ContentView の NavigationStack)。一覧画面と
// 購読詳細の両方に付けると、購読詳細を開いている間は同じバッチに 2 つのセッションが
// 張られ、互いを畳み合って翻訳が落ちる。

extension View {
    func titleTranslation(store: TitleTranslationStore) -> some View {
        modifier(TitleTranslationTask(store: store))
    }
}

private struct TitleTranslationTask: ViewModifier {
    @ObservedObject var store: TitleTranslationStore
    @State private var configuration: TranslationSession.Configuration?

    func body(content: Content) -> some View {
        content
            .onChange(of: store.batch, initial: true) { _, newValue in
                guard let newValue else {
                    configuration = nil
                    return
                }
                let source = Locale.Language(identifier: newValue.source)
                let target = Locale.Language(identifier: newValue.target)
                // 同じ言語ペアが続くと Configuration の値が変わらず translationTask が
                // 再実行されない。invalidate() で明示的に次のセッションを起こす。
                if var existing = configuration, existing.source == source, existing.target == target {
                    existing.invalidate()
                    configuration = existing
                } else {
                    configuration = TranslationSession.Configuration(source: source, target: target)
                }
            }
            // 初回は言語モデルのダウンロードが要る。トグルという明示操作が起点なので
            // ここでダウンロードの確認が出るのは自然なタイミングになる。
            .translationTask(configuration) { session in
                await store.run(session: session)
            }
    }
}

// 一覧のツールバーに置く翻訳トグル
struct TitleTranslationToggle: View {
    @ObservedObject var store: TitleTranslationStore

    var body: some View {
        if store.isSupported {
            Button {
                store.toggle()
            } label: {
                FiloIcon(.translate, size: 18)
            }
            .accessibilityLabel(L10n.string(store.isEnabled ? "原文タイトルに戻す" : "タイトルを翻訳"))
        }
    }
}

// MARK: - 準備画面（オンボーディング）
//
// 端末内翻訳は言語モデルの取得が要る。取得を一覧のスクロール中に暗黙で走らせると、
// OS の確認ダイアログが不意に割り込むうえ、失敗しても理由が分からない。
// ここで言語ごとの状態を見せ、明示的に取得させる。

struct TitleTranslationSetupView: View {
    @ObservedObject var store: TitleTranslationStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("タイトルの翻訳は端末の中で行います。はじめに、翻訳したい言語をダウンロードしてください。ダウンロードは Wi-Fi 接続時をおすすめします。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("原文の言語") {
                    if !store.hasCheckedLanguages {
                        HStack {
                            ProgressView()
                            Text("確認しています…")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    } else if store.languages.isEmpty, store.isDeviceSupported {
                        Text("購読しているフィードに、翻訳が必要な言語はありません。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else if !store.isDeviceSupported {
                        // 端末に翻訳用の言語モデルが用意されていない。言語ペアの問題では
                        // ないので、言語を並べても誤解を招くだけ。
                        VStack(alignment: .leading, spacing: 6) {
                            Text("この端末では端末内翻訳を利用できません。")
                                .font(.footnote)
                            Text("シミュレータには翻訳用の言語モデルが用意されていません。実機でお試しください。")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        ForEach(store.languages) { language in
                            row(language)
                        }
                    }
                }

                if let error = store.lastError {
                    Section("最後のエラー") {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }

                if store.isSupported {
                    Section {
                        Text("ここに無い言語の記事は、翻訳せず原文のまま表示します。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("翻訳の準備")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("閉じる") { dismiss() }
                }
            }
            .task { await store.refreshLanguages() }
        }
    }

    @ViewBuilder
    private func row(_ language: TitleTranslationLanguage) -> some View {
        HStack {
            Text(language.displayName)
            Spacer()
            switch language.status {
            case .installed:
                HStack(spacing: 6) {
                    FiloIcon(.checkCircle, size: 16, color: .green, filled: true)
                    Text("準備済み")
                }
                    .font(.footnote)
                    .foregroundStyle(.green)
            case .downloadable:
                Button("ダウンロード") { store.prepare(source: language.code) }
                    .buttonStyle(.borderless)
                    .font(.footnote)
                    // 翻訳バッチが走っている間はセッションを取り合うので押させない
                    .disabled(store.isPreparing || store.isTranslating)
            case .unsupported:
                Text("この端末では非対応")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            case .unknown:
                Text("不明")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
