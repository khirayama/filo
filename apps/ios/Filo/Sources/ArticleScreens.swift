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

    @Published var selectedTagId: Int?
    @Published var readingListOnly = false
    @Published var bookmarkedOnly = false
    @Published var settings: UserSettings?

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
            readingList: readingListOnly ? true : nil,
            bookmarked: bookmarkedOnly ? true : nil
        )
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            async let articlesTask = APIClient.shared.listArticles(filters: filters)
            async let tagsTask = APIClient.shared.listTags()
            async let subscriptionsTask = APIClient.shared.listSubscriptions()
            async let settingsTask = APIClient.shared.getSettings()
            let result = try await articlesTask
            articles = result.articles
            nextCursor = result.nextCursor
            tags = (try? await tagsTask) ?? tags
            subscriptions = (try? await subscriptionsTask) ?? subscriptions
            settings = (try? await settingsTask) ?? settings
            // 起動時にサーバー設定のテーマを描画へ反映する (他端末での変更を取り込む)
            if let settings { ThemeManager.shared.theme = settings.theme }
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isLoading = false
    }

    func reloadArticles() async {
        do {
            let result = try await APIClient.shared.listArticles(filters: filters)
            articles = result.articles
            nextCursor = result.nextCursor
            errorMessage = nil
        } catch {
            errorMessage = ErrorMessages.message(for: error)
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
        isLoadingMore = true
        do {
            let result = try await APIClient.shared.listArticles(filters: filters, cursor: cursor)
            articles.append(contentsOf: result.articles)
            nextCursor = result.nextCursor
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isLoadingMore = false
    }

    func selectView(tagId: Int? = nil, bookmarked: Bool = false) {
        selectedTagId = tagId
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

struct ReadingListScreen: View {
    @Binding var path: NavigationPath
    @StateObject private var model = ArticlesViewModel()

    var body: some View {
        ArticlesScreen(path: $path, model: model, readingListOnly: true, onBack: { path.removeLast() })
    }
}

struct ArticlesScreen: View {
    @Binding var path: NavigationPath
    @ObservedObject var model: ArticlesViewModel
    @State private var showDrawer = false
    @State private var showMarkAllReadConfirm = false
    @Environment(\.openURL) private var openURL
    var onOpenReadingList: () -> Void = {}
    var readingListOnly = false
    var onBack: () -> Void = {}

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
        .navigationTitle(readingListOnly ? "リーディングリスト" : model.viewTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    if readingListOnly { onBack() }
                    else { withAnimation(.easeOut(duration: 0.2)) { showDrawer = true } }
                } label: {
                    Label(readingListOnly ? "戻る" : "フィードメニュー", systemImage: readingListOnly ? "chevron.left" : "line.3.horizontal")
                }
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                if !readingListOnly && !model.bookmarkedOnly {
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
        .refreshable { await model.refreshFeedsAndReload() }
        .task {
            model.readingListOnly = readingListOnly
            await model.load()
        }
        .onChange(of: model.selectedTagId) { Task { await model.reloadArticles() } }
        .onChange(of: model.bookmarkedOnly) { Task { await model.reloadArticles() } }
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
                        ForEach(model.tags) { tag in
                            FilterChip(label: tag.name, isOn: model.selectedTagId == tag.id) {
                                model.selectedTagId = model.selectedTagId == tag.id ? nil : tag.id
                            }
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
                        if model.settings?.openInBrowserByDefault == true, let urlString = article.canonicalUrl {
                            if let url = URL(string: urlString) { openURL(url) }
                        } else {
                            path.append(AppRoute.articleDetail(article.id))
                        }
                    }
                    .swipeActions(edge: .trailing) {
                        Button {
                            Task { await model.patchState(article.id, inReadingList: !article.userState.inReadingList) }
                        } label: {
                            Label(
                                article.userState.inReadingList ? "リーディングリストから削除" : "リーディングリストに追加",
                                systemImage: "list.bullet"
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
        if model.subscriptions.isEmpty {
            EmptyStateView {
                Text("まだ購読がありません。")
                NavigationLink(value: AppRoute.addFeed) {
                    Text("フィードを追加して始めましょう")
                }
            }
        } else if model.subscriptions.contains(where: { $0.initialFetchStatus == "fetching" }) {
            EmptyStateView {
                ProgressView()
                Text("記事を取得しています…")
                Button("更新") { Task { await model.reloadArticles() } }
            }
        } else {
            EmptyStateView { Text("表示できる記事がありません。") }
        }
    }

    // MARK: Sources drawer (Feedly-style left menu)

    private var drawerOverlay: some View {
        ZStack(alignment: .leading) {
            Color.black.opacity(0.3)
                .ignoresSafeArea()
                .onTapGesture { closeDrawer() }
                .transition(.opacity)
            SourcesDrawer(model: model, onSelect: { closeDrawer() }, onOpenReadingList: onOpenReadingList)
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
