import SwiftUI

// MARK: - Articles list (startup screen)

@MainActor
final class ArticlesViewModel: ObservableObject {
    @Published var articles: [ArticleListItem] = []
    @Published var nextCursor: String?
    @Published var isLoading = false
    @Published var isLoadingMore = false
    @Published var errorMessage: String?
    @Published var tags: [Tag] = []
    @Published var subscriptions: [Subscription] = []

    @Published var selectedTagId: Int? {
        didSet { if selectedTagId != oldValue { invalidateArticleRequests() } }
    }
    @Published var readFilter: Bool? {
        didSet { if readFilter != oldValue { invalidateArticleRequests() } }
    }
    @Published var readingListOnly = false {
        didSet { if readingListOnly != oldValue { invalidateArticleRequests() } }
    }
    @Published var bookmarkedOnly = false {
        didSet { if bookmarkedOnly != oldValue { invalidateArticleRequests() } }
    }
    @Published var settings: UserSettings?

    private var articleGeneration = 0
    private var loadGeneration = 0

    var viewTitle: String {
        if let tagId = selectedTagId, let tag = tags.first(where: { $0.id == tagId }) {
            return tag.name
        }
        if readingListOnly { return "リーディングリスト" }
        if bookmarkedOnly { return "ブックマーク" }
        return "全ての記事"
    }

    private var filters: ArticleListFilters {
        ArticleListFilters(
            subscriptionId: nil,
            tagId: selectedTagId,
            read: readFilter,
            readingList: readingListOnly ? true : nil,
            bookmarked: bookmarkedOnly ? true : nil
        )
    }

    func load() async {
        loadGeneration += 1
        let currentLoadGeneration = loadGeneration
        invalidateArticleRequests()
        let currentArticleGeneration = articleGeneration
        isLoading = true
        errorMessage = nil
        do {
            async let articlesTask = APIClient.shared.listArticles(filters: filters)
            async let tagsTask = APIClient.shared.listTags()
            async let subscriptionsTask = APIClient.shared.listSubscriptions()
            async let settingsTask = APIClient.shared.getSettings()
            let result = try await articlesTask
            if articleGeneration == currentArticleGeneration {
                articles = result.articles
                nextCursor = result.nextCursor
            }
            let loadedTags = try? await tagsTask
            let loadedSubscriptions = try? await subscriptionsTask
            let loadedSettings = try? await settingsTask
            guard loadGeneration == currentLoadGeneration else { return }
            tags = loadedTags ?? tags
            subscriptions = loadedSubscriptions ?? subscriptions
            settings = loadedSettings ?? settings
            // 起動時にサーバー設定のテーマを描画へ反映する (他端末での変更を取り込む)
            if let settings { ThemeManager.shared.theme = settings.theme }
        } catch {
            if loadGeneration == currentLoadGeneration, articleGeneration == currentArticleGeneration {
                errorMessage = ErrorMessages.message(for: error)
            }
        }
        if loadGeneration == currentLoadGeneration { isLoading = false }
    }

    func reloadArticles() async {
        invalidateArticleRequests()
        let currentGeneration = articleGeneration
        do {
            let result = try await APIClient.shared.listArticles(filters: filters)
            guard articleGeneration == currentGeneration else { return }
            articles = result.articles
            nextCursor = result.nextCursor
            errorMessage = nil
        } catch {
            if articleGeneration == currentGeneration {
                errorMessage = ErrorMessages.message(for: error)
            }
        }
    }

    @Published var isRefreshingFeeds = false
    @Published var refreshNotice: String?

    // Manual refresh: enqueue feed fetches, wait for them to land by polling
    // /status, then reload the list.
    func refreshFeedsAndReload() async {
        guard !isRefreshingFeeds else { return }
        isRefreshingFeeds = true
        refreshNotice = nil
        do {
            let result = try await APIClient.shared.refreshFeeds(force: false)
            if result.enqueued == 0, (result.skipped ?? 0) > 0 {
                refreshNotice = "最近取得済みのため、今回の取得対象はありませんでした。"
            } else if result.enqueued > 0 {
                let done = await Self.awaitRefreshCompletion(queuedAtIso: result.queuedAt)
                if !done { refreshNotice = "取得に時間がかかっています。あとで再度更新してください。" }
            }
        } catch {
            refreshNotice = ErrorMessages.message(for: error)
        }
        await reloadArticles()
        isRefreshingFeeds = false
    }

    // The server records a pending fetch job per feed before responding, so
    // completion is "no fetch job is pending or running anymore".
    static func awaitRefreshCompletion(queuedAtIso: String, feedId: Int? = nil, timeout: TimeInterval = 45) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            try? await Task.sleep(for: .seconds(2.5))
            guard let status = try? await APIClient.shared.getStatus() else { continue }
            if let feedId {
                guard let sub = status.subscriptionStatuses.first(where: { $0.feedId == feedId }) else { return false }
                if sub.fetchJob?.isActive != true { return true }
            } else if status.subscriptionStatuses.allSatisfy({ $0.fetchJob?.isActive != true }) {
                return true
            }
        }
        return false
    }

    func loadMore() async {
        guard let cursor = nextCursor, !isLoadingMore else { return }
        let currentGeneration = articleGeneration
        isLoadingMore = true
        do {
            let result = try await APIClient.shared.listArticles(filters: filters, cursor: cursor)
            guard articleGeneration == currentGeneration else { return }
            articles.append(contentsOf: result.articles)
            nextCursor = result.nextCursor
        } catch {
            if articleGeneration == currentGeneration {
                errorMessage = ErrorMessages.message(for: error)
            }
        }
        if articleGeneration == currentGeneration { isLoadingMore = false }
    }

    private func invalidateArticleRequests() {
        articleGeneration += 1
        isLoadingMore = false
    }

    func selectView(tagId: Int? = nil, readingList: Bool = false, bookmarked: Bool = false) {
        selectedTagId = tagId
        readingListOnly = readingList
        bookmarkedOnly = bookmarked
    }

    // 表示中スコープ(全購読 or 選択タグ配下)の既読カーソルを一括前進させる
    func markAllRead() async {
        do {
            _ = try await APIClient.shared.markAllArticlesRead(tagId: selectedTagId)
            await reloadArticles()
            subscriptions = (try? await APIClient.shared.listSubscriptions()) ?? subscriptions
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }

    func removeReadArticlesFromReadingList() async {
        do {
            _ = try await APIClient.shared.removeReadArticlesFromReadingList()
            await reloadArticles()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }

    func patchState(_ articleId: Int, isRead: Bool? = nil, inReadingList: Bool? = nil, isBookmarked: Bool? = nil) async {
        do {
            let state: ArticleUserState
            if let isRead {
                state = try await APIClient.shared.setArticleRead(articleId, isRead: isRead)
            } else if let inReadingList {
                state = try await APIClient.shared.setReadingListMembership(articleId, active: inReadingList)
            } else if let isBookmarked {
                state = try await APIClient.shared.setBookmarkMembership(articleId, active: isBookmarked)
            } else {
                return
            }
            if let index = articles.firstIndex(where: { $0.id == articleId }) {
                let remainsInList = (!readingListOnly || state.inReadingList)
                    && (!bookmarkedOnly || state.isBookmarked)
                    && (readFilter == nil || state.isRead == readFilter)
                if !remainsInList {
                    articles.remove(at: index)
                } else {
                    articles[index].userState = state
                }
            }
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }

}

struct ArticlesScreen: View {
    @Binding var path: NavigationPath
    @ObservedObject var model: ArticlesViewModel
    @ObservedObject private var translations = TitleTranslationStore.shared
    @State private var showDrawer = false
    @State private var showMarkAllReadConfirm = false
    @State private var showRemoveReadConfirm = false

    private var markAllReadPrompt: String {
        if let tagId = model.selectedTagId, let tag = model.tags.first(where: { $0.id == tagId }) {
            return "タグ「\(tag.name)」のフィードの記事をすべて既読にしますか？"
        }
        return "すべての購読の記事をすべて既読にしますか？"
    }

    var body: some View {
        ZStack(alignment: .leading) {
            articleList
            if showDrawer {
                drawerOverlay
            }
        }
        .navigationTitle(model.viewTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    withAnimation(.easeOut(duration: 0.2)) { showDrawer = true }
                } label: {
                    Label("フィードメニュー", systemImage: "line.3.horizontal")
                }
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                if model.readingListOnly {
                    Button {
                        showRemoveReadConfirm = true
                    } label: {
                        Label("既読記事を削除", systemImage: "trash")
                    }
                    NavigationLink(value: AppRoute.readingSession(false)) {
                        Label("閲覧開始", systemImage: "book")
                    }
                }
                TitleTranslationToggle(store: translations)
                if !model.bookmarkedOnly && !model.readingListOnly {
                    Button {
                        showMarkAllReadConfirm = true
                    } label: {
                        Label("すべて既読にする", systemImage: "checkmark.circle")
                    }
                }
                NavigationLink(value: AppRoute.addFeed) {
                    Label("フィード追加", systemImage: "plus")
                }
                optionsMenu
            }
        }
        .confirmationDialog(markAllReadPrompt, isPresented: $showMarkAllReadConfirm, titleVisibility: .visible) {
            Button("すべて既読にする") { Task { await model.markAllRead() } }
        }
        .confirmationDialog("既読の記事をリーディングリストから削除しますか？", isPresented: $showRemoveReadConfirm, titleVisibility: .visible) {
            Button("既読記事を削除", role: .destructive) { Task { await model.removeReadArticlesFromReadingList() } }
        }
        .refreshable { await model.refreshFeedsAndReload() }
        .task {
            await model.load()
            registerTitlesForTranslation()
            await translations.refreshLanguages()
        }
        .onChange(of: model.selectedTagId) { Task { await model.reloadArticles() } }
        .onChange(of: model.readFilter) { Task { await model.reloadArticles() } }
        .onChange(of: model.bookmarkedOnly) { Task { await model.reloadArticles() } }
        .onChange(of: model.readingListOnly) { Task { await model.reloadArticles() } }
        // 翻訳トグルが ON の間は、表示された記事を翻訳対象にする
        .onChange(of: model.articles, initial: true) { registerTitlesForTranslation() }
        .onChange(of: translations.isEnabled) { registerTitlesForTranslation() }
        // 設定は articles より後に届くので、届いてから表示言語を入れ直す
        .onChange(of: model.settings) { registerTitlesForTranslation() }
    }

    private func registerTitlesForTranslation() {
        translations.configure(
            language: model.settings?.language ?? "ja",
            readableLanguages: model.settings?.readableLanguages ?? ["ja"],
        )
        // 準備画面の候補は「購読に実在する言語」
        translations.setCandidates(model.subscriptions)
        translations.register(model.articles)
    }

    private var optionsMenu: some View {
        Menu {
            NavigationLink(value: AppRoute.subscriptions) {
                Label("購読管理", systemImage: "list.bullet")
            }
            NavigationLink(value: AppRoute.tags) {
                Label("タグ管理", systemImage: "tag")
            }
            NavigationLink(value: AppRoute.status) {
                Label("処理ステータス", systemImage: "arrow.triangle.2.circlepath")
            }
            NavigationLink(value: AppRoute.settings) {
                Label("設定", systemImage: "gearshape")
            }
        } label: {
            Label("メニュー", systemImage: "ellipsis")
        }
    }

    private var articleList: some View {
        List {
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        FilterChip(label: "未読", isOn: model.readFilter == false) {
                            model.readFilter = model.readFilter == false ? nil : false
                        }
                        FilterChip(label: "既読", isOn: model.readFilter == true) {
                            model.readFilter = model.readFilter == true ? nil : true
                        }
                    }
                }
                .listRowSeparator(.hidden)
            }
            articleSection
        }
        .listStyle(.plain)
    }

    @ViewBuilder
    private var articleSection: some View {
        Section {
            if model.isRefreshingFeeds {
                ProgressView("フィードを更新しています…")
            }
            if let notice = model.refreshNotice {
                Text(notice)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if model.isLoading, model.articles.isEmpty {
                ProgressView("読み込み中…")
            } else if let error = model.errorMessage, model.articles.isEmpty {
                ErrorBanner(message: error) { Task { await model.load() } }
            } else if model.articles.isEmpty {
                emptyState
            } else {
                ForEach(model.articles) { article in
                    ArticleRowView(article: article)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        if let urlString = article.canonicalUrl, URL(string: urlString) != nil {
                            path.append(AppRoute.readingArticle(ReadingSessionArticle(article)))
                        }
                    }
                    .swipeActions(edge: .trailing) {
                        Button {
                            Task { await model.patchState(article.id, inReadingList: !article.userState.inReadingList) }
                        } label: {
                            Label(
                                article.userState.inReadingList ? "リーディングリストから削除" : "リーディングリストに追加",
                                systemImage: article.userState.inReadingList ? "text.badge.minus" : "text.badge.plus"
                            )
                        }
                        .tint(.blue)
                        Button {
                            Task { await model.patchState(article.id, isBookmarked: !article.userState.isBookmarked) }
                        } label: {
                            Label(
                                article.userState.isBookmarked ? "ブックマークを解除" : "ブックマーク",
                                systemImage: article.userState.isBookmarked ? "bookmark.slash" : "bookmark"
                            )
                        }
                        .tint(.yellow)
                    }
                    .swipeActions(edge: .leading) {
                        Button {
                            Task { await model.patchState(article.id, isRead: !article.userState.isRead) }
                        } label: {
                            Label(
                                article.userState.isRead ? "未読にする" : "既読にする",
                                systemImage: article.userState.isRead ? "circle" : "checkmark.circle"
                            )
                        }
                        .tint(.green)
                    }
                    .onAppear {
                        if article.id == model.articles.last?.id {
                            Task { await model.loadMore() }
                        }
                    }
                }
                if model.nextCursor != nil {
                    Button(model.isLoadingMore ? "読み込み中…" : "さらに読み込む") {
                        Task { await model.loadMore() }
                    }
                    .disabled(model.isLoadingMore)
                }
            }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        if model.subscriptions.isEmpty,
           model.selectedTagId == nil,
           model.readFilter == nil,
           !model.readingListOnly,
           !model.bookmarkedOnly {
            EmptyStateView {
                Text("まだ購読がありません。")
                NavigationLink(value: AppRoute.addFeed) {
                    Text("フィードを追加して始めましょう")
                }
            }
        } else if model.readingListOnly {
            EmptyStateView { Text("リーディングリストに保存した記事はありません。") }
        } else if model.bookmarkedOnly {
            EmptyStateView { Text("ブックマークした記事はありません。") }
        } else if model.readFilter == false {
            EmptyStateView { Text("未読の記事はありません。") }
        } else if model.readFilter == true {
            EmptyStateView { Text("既読の記事はありません。") }
        } else if relevantSubscriptions.contains(where: { $0.initialFetchStatus == "fetching" }) {
            EmptyStateView {
                ProgressView()
                Text("記事を取得しています…")
                Button("更新") { Task { await model.reloadArticles() } }
            }
        } else {
            EmptyStateView { Text("表示できる記事がありません。") }
        }
    }

    private var relevantSubscriptions: [Subscription] {
        guard let tagId = model.selectedTagId else { return model.subscriptions }
        return model.subscriptions.filter { $0.tagIds.contains(tagId) }
    }

    // MARK: Sources drawer (Feedly-style left menu)

    private var drawerOverlay: some View {
        ZStack(alignment: .leading) {
            Color.black.opacity(0.3)
                .ignoresSafeArea()
                .onTapGesture { closeDrawer() }
                .transition(.opacity)
            SourcesDrawer(model: model, onSelect: { closeDrawer() })
                .frame(width: 300)
                .frame(maxHeight: .infinity)
                .background(Color(uiColor: .systemBackground))
                .transition(.move(edge: .leading))
        }
        .zIndex(1)
    }

    private func closeDrawer() {
        withAnimation(.easeIn(duration: 0.2)) { showDrawer = false }
    }
}
