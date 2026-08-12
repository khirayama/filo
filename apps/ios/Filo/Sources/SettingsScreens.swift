import ClerkKit
import SwiftUI
import UniformTypeIdentifiers

struct SettingsScreen: View {
    @Environment(Clerk.self) private var clerk
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

    var body: some View {
        Form {
            if isLoading {
                ProgressView("読み込み中…")
            } else if let settings {
                settingsSection(settings)
                opmlSection
                aboutSection
                sessionSection
                dangerSection
            } else if let errorMessage {
                ErrorBanner(message: errorMessage) { Task { await load() } }
            }
            // errors from updates while settings are shown
            if !isLoading, settings != nil, let errorMessage {
                Section { ErrorBanner(message: errorMessage) }
            }
        }
        .navigationTitle("設定")
        .task { await load() }
        .onDisappear { pollTask?.cancel() }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.xml, UTType(filenameExtension: "opml") ?? .xml]) { result in
            if case .success(let url) = result {
                Task { await importOpml(url) }
            }
        }
        .navigationDestination(isPresented: $navigateToDeletion) {
            AccountDeletionStatusScreen(deletionToken: deletionToken)
        }
    }

    @ViewBuilder
    private func settingsSection(_ settings: UserSettings) -> some View {
        Section {
            Picker("テーマ", selection: binding(\.theme, patch: { ($0, nil, nil, nil) })) {
                Text("システムに合わせる").tag("system")
                Text("ライト").tag("light")
                Text("ダーク").tag("dark")
            }
            Picker("言語", selection: binding(\.language, patch: { (nil, $0, nil, nil) })) {
                Text("日本語").tag("ja")
                Text("English").tag("en")
                Text("简体中文").tag("zh")
                Text("한국어").tag("ko")
                Text("Español").tag("es")
            }
            Picker("記事の並び順", selection: binding(\.articleSortOrder, patch: { (nil, nil, $0, nil) })) {
                Text("公開日時が新しい順").tag("published_at_desc")
                Text("取得日時が新しい順").tag("fetched_at_desc")
            }
            Toggle("リンクを常にブラウザで開く", isOn: Binding(
                get: { self.settings?.openInBrowserByDefault ?? false },
                set: { value in Task { await update(openInBrowserByDefault: value) } }
            ))
        } header: {
            Text("表示")
        } footer: {
            Text("一覧の翻訳トグルは、タイトルをこの言語へ翻訳します。")
        }
        Section {
            ForEach([("ja", "日本語"), ("en", "English"), ("zh", "简体中文"), ("ko", "한국어"), ("es", "Español")], id: \.0) { code, name in
                Toggle(name, isOn: Binding(
                    get: { self.settings?.readableLanguages.contains(code) ?? false },
                    set: { isOn in
                        guard let current = self.settings?.readableLanguages else { return }
                        let next = isOn ? current + [code] : current.filter { $0 != code }
                        Task { await update(readableLanguages: next) }
                    }
                ))
            }
        } header: {
            Text("原文のまま読む言語")
        } footer: {
            Text("選択した言語の記事は翻訳せず原文で表示します。")
        }
        Section {
            Button("翻訳の準備") { TitleTranslationStore.shared.isShowingSetup = true }
        } footer: {
            Text("タイトルの翻訳は端末の中で行います。言語ごとにダウンロードが要ります。")
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

    @ViewBuilder
    private var opmlSection: some View {
        Section("OPML") {
            Button("インポート") { showImporter = true }
            Button("エクスポート") { Task { await exportOpml() } }
            if let exportedFileURL {
                ShareLink(item: exportedFileURL) {
                    Label("エクスポートしたファイルを共有", systemImage: "square.and.arrow.up")
                }
            }
            if let importJob {
                switch importJob.status {
                case "pending", "running":
                    HStack {
                        ProgressView()
                        Text("インポート処理中…")
                    }
                case "completed":
                    VStack(alignment: .leading, spacing: 4) {
                        StatusBadge(label: "インポート完了", tone: .ok)
                        Text("追加 \(importJob.created ?? 0) / スキップ \(importJob.skipped ?? 0) / 失敗 \(importJob.failed ?? 0)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let failures = importJob.failures, !failures.isEmpty {
                            ForEach(failures.prefix(5), id: \.feedUrl) { failure in
                                Text(failure.feedUrl)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    }
                default:
                    StatusBadge(label: "インポート失敗", tone: .danger)
                }
            }
        }
    }

    private var aboutSection: some View {
        Section("既読履歴について") {
            Text("閲覧履歴は既読記事として扱われます。記事一覧の絞り込みから既読記事を確認できます。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var sessionSection: some View {
        Section("セッション") {
            Button("サインアウト") {
                Task { try? await clerk.auth.signOut() }
            }
        }
    }

    private var dangerSection: some View {
        Section("危険な操作") {
            Text("アカウントを削除すると購読・タグ・記事の状態がすべて削除され、再ログインしても復元されません。")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button("アカウント削除", role: .destructive) { showDeleteConfirm = true }
                .confirmationDialog("アカウントを削除しますか？この操作は取り消せません。", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
                    Button("削除する", role: .destructive) {
                        Task { await deleteAccount() }
                    }
                }
        }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            settings = try await APIClient.shared.getSettings()
            if let settings {
                ThemeManager.shared.theme = settings.theme
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
            if let language { languageManager.language = language }
            if let settings {
                ThemeManager.shared.theme = settings.theme
                TitleTranslationStore.shared.configure(
                    language: settings.language,
                    readableLanguages: settings.readableLanguages
                )
            }
        } catch {
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
    @Environment(Clerk.self) private var clerk
    let deletionToken: String?

    @State private var status: DeletionStatus?
    @State private var pollTask: Task<Void, Never>?

    var body: some View {
        List {
            Section("削除の進行状況") {
                if let status {
                    switch status.status {
                    case "completed":
                        StatusBadge(label: "削除完了", tone: .ok)
                        Text("アカウントの削除が完了しました。ご利用ありがとうございました。")
                        Text("再ログインしてもデータは復元されません。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    case "failed":
                        StatusBadge(label: "削除処理に失敗しました", tone: .danger)
                        Text("削除処理は自動的に再試行されます。時間をおいてもこの状態が続く場合はお問い合わせください。")
                    case "none":
                        Text("進行中の削除処理はありません。")
                    default:
                        HStack {
                            ProgressView()
                            Text("削除処理中…")
                        }
                        Text("この画面を閉じても削除処理は継続されます。再ログインでデータが復活することはありません。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    ProgressView("状態を確認しています…")
                }
            }
        }
        .navigationTitle("アカウント削除")
        .navigationBarBackButtonHidden(status?.status == "completed")
        .task { startPolling() }
        .onDisappear { pollTask?.cancel() }
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task {
            while !Task.isCancelled {
                if let result = try? await APIClient.shared.deletionStatus(token: deletionToken) {
                    status = result
                    if result.status == "completed" {
                        try? await clerk.auth.signOut()
                        break
                    }
                    if result.status == "none" { break }
                }
                try? await Task.sleep(for: .seconds(4))
            }
        }
    }
}
