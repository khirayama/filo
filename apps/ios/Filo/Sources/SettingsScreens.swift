import SwiftUI
import UniformTypeIdentifiers

struct SettingsScreen: View {
    @State private var settings: UserSettings?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var importJob: OpmlImportJob?
    @State private var showImporter = false
    @State private var exportedFileURL: URL?
    @State private var showDeleteConfirm = false
    @State private var deletionToken: String?
    @State private var navigateToDeletion = false
    @State private var pollTask: Task<Void, Never>?
    @ObservedObject private var languageManager = LanguageManager.shared
    @ObservedObject private var titleTranslations = TitleTranslationStore.shared

    @Environment(\.filoIsDesktop) private var isDesktop

    private static let languages: [(code: String, name: String)] = [
        ("ja", "日本語"), ("en", "English"), ("zh", "简体中文"), ("ko", "한국어"), ("es", "Español"),
    ]

    var body: some View {
        FiloPage("設定") {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    if let errorMessage {
                        FiloErrorBox(message: errorMessage) { Task { await load() } }
                    }
                    if isLoading || settings == nil {
                        if errorMessage == nil { FiloSpinner() }
                    } else if let settings {
                        displaySection(settings)
                        translationSection(settings)
                        opmlSection
                        section("既読履歴について") {
                            Text(localized: "閲覧履歴は既読記事として扱われます。記事一覧の絞り込みから既読記事を確認できます。")
                                .filoFont(13)
                                .lineSpacing(4)
                                .foregroundStyle(FiloPalette.muted)
                                .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 10)
                        }
                        section("セッション") {
                            FiloCardRow {
                                FiloButton("サインアウト") { BetterAuth.shared.signOut() }
                                Spacer(minLength: 0)
                            }
                        }
                        section("危険な操作", danger: true) {
                            FiloCardRow(stacked: !isDesktop) {
                                Text(localized: "アカウントを削除すると購読・タグ・記事の状態がすべて削除され、再ログインしても復元されません。")
                                    .filoFont(13)
                                    .lineSpacing(4)
                                    .foregroundStyle(FiloPalette.muted)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                FiloButton("アカウント削除", kind: .danger) { showDeleteConfirm = true }
                            }
                        }
                    }
                }
                .frame(maxWidth: FiloMetrics.contentWidth, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, isDesktop ? FiloMetrics.desktopGutter : FiloMetrics.gutter)
                .padding(.top, 24)
                .padding(.bottom, 64)
            }
        }
        .task { await load() }
        .onDisappear { pollTask?.cancel() }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.xml, UTType(filenameExtension: "opml") ?? .xml]) { result in
            if case .success(let url) = result {
                Task { await importOpml(url) }
            }
        }
        .confirmationDialog("アカウントを削除しますか？この操作は取り消せません。", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("削除する", role: .destructive) {
                Task { await deleteAccount() }
            }
        }
        .navigationDestination(isPresented: $navigateToDeletion) {
            AccountDeletionStatusScreen(deletionToken: deletionToken)
        }
    }

    private func section<Content: View>(_ title: String, danger: Bool = false, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            FiloSectionTitle(title: title, danger: danger)
            FiloCard(danger: danger) { content() }
        }
    }

    @ViewBuilder
    private func displaySection(_ settings: UserSettings) -> some View {
        section("表示設定") {
            FiloCardRow("テーマ", stacked: !isDesktop) {
                FiloSelect(selection: binding(\.theme, patch: { ($0, nil, nil, nil) }), options: [
                    ("system", L10n.string("システムに合わせる")),
                    ("light", L10n.string("ライト")),
                    ("dark", L10n.string("ダーク")),
                ], label: "テーマ", minWidth: isDesktop ? 200 : nil)
            }
            FiloCardRow("言語", hint: "一覧の翻訳トグルは、タイトルをこの言語へ翻訳します。", stacked: !isDesktop) {
                FiloSelect(
                    selection: binding(\.language, patch: { (nil, $0, nil, nil) }),
                    options: Self.languages.map { ($0.code, $0.name) },
                    label: "言語",
                    minWidth: isDesktop ? 200 : nil,
                )
            }
            FiloCardRow("記事の並び順", stacked: !isDesktop) {
                FiloSelect(selection: binding(\.articleSortOrder, patch: { (nil, nil, $0, nil) }), options: [
                    ("published_at_desc", L10n.string("公開日時が新しい順")),
                    ("fetched_at_desc", L10n.string("取得日時が新しい順")),
                ], label: "記事の並び順", minWidth: isDesktop ? 200 : nil)
            }
            FiloCardRow("リンクを常にブラウザで開く") {
                FiloToggle(label: "リンクを常にブラウザで開く", isOn: Binding(
                    get: { self.settings?.openInBrowserByDefault ?? false },
                    set: { value in Task { await update(openInBrowserByDefault: value) } },
                ))
            }
        }
    }

    @ViewBuilder
    private func translationSection(_ settings: UserSettings) -> some View {
        section("翻訳") {
            if titleTranslations.isSupported {
                FiloCardRow("翻訳の準備") {
                    FiloButton("言語を確認", small: true) { titleTranslations.isShowingSetup = true }
                }
            }
            FiloCardRow("原文のまま読む言語", stacked: true) {
                FlowLayout(spacing: 6) {
                    ForEach(Self.languages, id: \.code) { language in
                        let isOn = settings.readableLanguages.contains(language.code)
                        FiloChip(label: language.name, isOn: isOn, localize: false) {
                            let next = isOn
                                ? settings.readableLanguages.filter { $0 != language.code }
                                : settings.readableLanguages + [language.code]
                            Task { await update(readableLanguages: next) }
                        }
                    }
                }
            }
        }
    }

    private func binding(_ keyPath: KeyPath<UserSettings, String>, patch: @escaping (String) -> (String?, String?, String?, Bool?)) -> Binding<String> {
        Binding(
            get: { settings?[keyPath: keyPath] ?? "" },
            set: { value in
                let (theme, language, sort, browser) = patch(value)
                Task { await update(theme: theme, language: language, articleSortOrder: sort, openInBrowserByDefault: browser) }
            }
        )
    }

    private var opmlSection: some View {
        section("OPML") {
            FiloCardRow {
                HStack(spacing: 8) {
                    FiloButton("インポート") { showImporter = true }
                    FiloButton("エクスポート") { Task { await exportOpml() } }
                    if let exportedFileURL {
                        ShareLink(item: exportedFileURL) {
                            FiloButtonLabel(title: "エクスポートしたファイルを共有", icon: .externalLink)
                        }
                        .buttonStyle(FiloButtonStyle(kind: .ghost))
                    }
                }
                Spacer(minLength: 0)
            }
            if let importJob {
                VStack(alignment: .leading, spacing: 8) {
                    switch importJob.status {
                    case "pending", "running":
                        FiloBadge(label: "インポート処理中…")
                    case "completed":
                        FiloBadge(label: "インポート完了", tone: .ok)
                        Text(L10n.format("追加 %ld / スキップ %ld / 失敗 %ld", importJob.created ?? 0, importJob.skipped ?? 0, importJob.failed ?? 0))
                            .filoFont(13)
                            .foregroundStyle(FiloPalette.muted)
                        if let failures = importJob.failures, !failures.isEmpty {
                            ForEach(failures.prefix(5), id: \.feedUrl) { failure in
                                Text(verbatim: "• \(failure.feedUrl)")
                                    .filoFont(12)
                                    .foregroundStyle(FiloPalette.muted)
                                    .lineLimit(1)
                            }
                        }
                    default:
                        FiloBadge(label: "インポート失敗", tone: .danger)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
        }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            settings = try await APIClient.shared.getSettings()
            if let settings {
                // @Published re-renders the whole app on every assignment, even
                // an unchanged one; skip it so the push animation stays smooth.
                if ThemeManager.shared.theme != settings.theme { ThemeManager.shared.theme = settings.theme }
                if languageManager.language != settings.language { languageManager.language = settings.language }
                TitleTranslationStore.shared.configure(
                    language: settings.language,
                    readableLanguages: settings.readableLanguages
                )
            }
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isLoading = false
    }

    private func update(theme: String? = nil, language: String? = nil, readableLanguages: [String]? = nil, articleSortOrder: String? = nil, openInBrowserByDefault: Bool? = nil) async {
        let previous = settings
        if let current = previous {
            // Keep the screen and the app locale responsive while the server
            // persists the change.
            settings = UserSettings(
                theme: theme ?? current.theme,
                language: language ?? current.language,
                readableLanguages: readableLanguages ?? current.readableLanguages,
                articleSortOrder: articleSortOrder ?? current.articleSortOrder,
                openInBrowserByDefault: openInBrowserByDefault ?? current.openInBrowserByDefault,
                createdAt: current.createdAt,
                updatedAt: current.updatedAt,
            )
        }
        if let language { languageManager.language = language }
        if let theme { ThemeManager.shared.theme = theme }
        do {
            settings = try await APIClient.shared.updateSettings(
                theme: theme,
                language: language,
                readableLanguages: readableLanguages,
                articleSortOrder: articleSortOrder,
                openInBrowserByDefault: openInBrowserByDefault
            )
            if let theme { FiloAnalytics.track("settings_change", parameters: ["setting": "theme", "value": theme]) }
            if let language { FiloAnalytics.track("settings_change", parameters: ["setting": "language", "value": language]) }
            if let readableLanguages { FiloAnalytics.track("settings_change", parameters: ["setting": "readable_languages", "value": readableLanguages.count]) }
            if let articleSortOrder { FiloAnalytics.track("settings_change", parameters: ["setting": "article_sort_order", "value": articleSortOrder]) }
            if let openInBrowserByDefault { FiloAnalytics.track("settings_change", parameters: ["setting": "open_in_browser_by_default", "value": openInBrowserByDefault]) }
            if let settings {
                ThemeManager.shared.theme = settings.theme
                TitleTranslationStore.shared.configure(
                    language: settings.language,
                    readableLanguages: settings.readableLanguages
                )
            }
        } catch {
            settings = previous
            if let previous { languageManager.language = previous.language; ThemeManager.shared.theme = previous.theme }
            errorMessage = ErrorMessages.message(for: error)
        }
    }

    private func importOpml(_ url: URL) async {
        errorMessage = nil
        do {
            let accessing = url.startAccessingSecurityScopedResource()
            defer { if accessing { url.stopAccessingSecurityScopedResource() } }
            let data = try Data(contentsOf: url)
            let job = try await APIClient.shared.importOpml(fileData: data, fileName: url.lastPathComponent)
            FiloAnalytics.track("import_opml", parameters: ["file_type": url.pathExtension.lowercased()])
            importJob = job
            pollImport(job.jobId)
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }

    private func pollImport(_ jobId: String) {
        pollTask?.cancel()
        pollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3))
                guard !Task.isCancelled else { break }
                if let job = try? await APIClient.shared.getOpmlImport(jobId) {
                    importJob = job
                    if job.status == "completed" || job.status == "failed" { break }
                }
            }
        }
    }

    private func exportOpml() async {
        errorMessage = nil
        do {
            let data = try await APIClient.shared.exportOpml()
            FiloAnalytics.track("export_opml")
            let url = FileManager.default.temporaryDirectory.appending(path: "filo-subscriptions.opml")
            try data.write(to: url)
            exportedFileURL = url
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }

    private func deleteAccount() async {
        errorMessage = nil
        do {
            let accepted = try await APIClient.shared.deleteAccount()
            deletionToken = accepted.deletionToken
            navigateToDeletion = true
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }
}

// MARK: - Account deletion progress

struct AccountDeletionStatusScreen: View {
    let deletionToken: String?

    @State private var status: DeletionStatus?
    @State private var pollTask: Task<Void, Never>?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        FiloPage("アカウント削除", showsBack: status?.status != "completed") {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    FiloSectionTitle(title: "削除の進行状況")
                    FiloCard {
                        VStack(alignment: .leading, spacing: 10) {
                            content
                        }
                        .filoFont(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                    }
                }
                .frame(maxWidth: FiloMetrics.contentWidth, alignment: .leading)
                .padding(.horizontal, FiloMetrics.gutter)
                .padding(.top, 24)
            }
        }
        .task { startPolling() }
        .onDisappear { pollTask?.cancel() }
    }

    @ViewBuilder
    private var content: some View {
        if let status {
            switch status.status {
            case "completed":
                FiloBadge(label: "削除完了", tone: .ok)
                Text(localized: "アカウントの削除が完了しました。ご利用ありがとうございました。")
                hint("再ログインしてもデータは復元されません。")
            case "failed":
                FiloBadge(label: "削除処理に失敗しました", tone: .danger)
                Text(localized: "削除処理は自動的に再試行されます。時間をおいてもこの状態が続く場合はお問い合わせください。")
            case "none":
                Text(localized: "進行中の削除処理はありません。")
                FiloButton("設定へ戻る") { dismiss() }
            default:
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small).tint(FiloPalette.accent)
                    Text(localized: "削除処理中…")
                }
                hint("この画面を閉じても削除処理は継続されます。再ログインでデータが復活することはありません。")
            }
        } else {
            FiloSpinner(label: "状態を確認しています…")
        }
    }

    private func hint(_ text: String) -> some View {
        Text(localized: text)
            .filoFont(13)
            .lineSpacing(4)
            .foregroundStyle(FiloPalette.muted)
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task {
            while !Task.isCancelled {
                if let result = try? await APIClient.shared.deletionStatus(token: deletionToken) {
                    status = result
                    if result.status == "completed" {
                        BetterAuth.shared.signOut()
                        break
                    }
                    if result.status == "none" { break }
                }
                try? await Task.sleep(for: .seconds(4))
            }
        }
    }
}
