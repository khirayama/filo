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
    @Published var sort = "published_at_desc" {
        didSet { if sort != oldValue { invalidateArticleRequests() } }
    }
    @Published var readOrder = "unread_first" {
        didSet { if readOrder != oldValue { invalidateArticleRequests() } }
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
        if readingListOnly { return L10n.string("リーディングリスト") }
        if bookmarkedOnly { return L10n.string("ブックマーク") }
        return L10n.string("全ての記事")
    }

    private var filters: ArticleListFilters {
        ArticleListFilters(
            subscriptionId: nil,
            tagId: selectedTagId,
            read: readFilter,
            readingList: readingListOnly ? true : nil,
            bookmarked: bookmarkedOnly ? true : nil,
            sort: sort,
            readOrder: readOrder
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
            if let loadedSettings {
                if sort != loadedSettings.articleSortOrder { sort = loadedSettings.articleSortOrder }
            }
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
        FiloAnalytics.track("refresh_feeds")
        isRefreshingFeeds = true
        refreshNotice = nil
        do {
            let result = try await APIClient.shared.refreshFeeds(force: false)
            if result.enqueued == 0, (result.skipped ?? 0) > 0 {
                refreshNotice = L10n.string("最近取得済みのため、今回の取得対象はありませんでした。")
            } else if result.enqueued > 0 {
                let done = await Self.awaitRefreshCompletion(queuedAtIso: result.queuedAt)
                if !done { refreshNotice = L10n.string("取得に時間がかかっています。あとで再度更新してください。") }
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
        FiloAnalytics.track("mark_all_articles_read")
        do {
            _ = try await APIClient.shared.markAllArticlesRead(tagId: selectedTagId)
            await reloadArticles()
            subscriptions = (try? await APIClient.shared.listSubscriptions()) ?? subscriptions
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }

    func removeReadArticlesFromReadingList() async {
        FiloAnalytics.track("remove_read_articles_from_reading_list")
        do {
            _ = try await APIClient.shared.removeReadArticlesFromReadingList()
            await reloadArticles()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }

    func patchState(_ articleId: Int, isRead: Bool? = nil, inReadingList: Bool? = nil, isBookmarked: Bool? = nil) async {
        do {
            if let isRead {
                FiloAnalytics.track(isRead ? "mark_article_read" : "mark_article_unread", parameters: ["article_id": articleId])
            } else if let inReadingList {
                FiloAnalytics.track(inReadingList ? "add_to_reading_list" : "remove_from_reading_list", parameters: ["article_id": articleId])
            } else if let isBookmarked {
                FiloAnalytics.track(isBookmarked ? "add_to_wishlist" : "remove_from_wishlist", parameters: ["article_id": articleId])
            }
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
    var showDesktopSidebar = true
    var showMobileDrawer = true
    var showMobileMenu = true
    var onCloseMobileDrawer: () -> Void = {}
    var onOpenMobileDrawer: (() -> Void)? = nil
    @ObservedObject private var translations = TitleTranslationStore.shared
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var showDrawer = false
    @State private var showRemoveReadConfirm = false
    @State private var selectedArticleIndex: Int? = nil
    @State private var listScrollPosition: Int? = nil
    @State private var visibleArticleIds: Set<Int> = []
    @State private var viewedArticleIds = ""
    @State private var showShortcutHelp = false
    @FocusState private var isKeyboardFocused: Bool
    @Environment(\.filoIsDesktop) private var isDesktop

    var body: some View {
        Group {
            if isDesktop {
                if showDesktopSidebar {
                    HStack(spacing: 0) {
                        SourcesDrawer(model: model, onSelect: {}, showCloseButton: false)
                            .frame(width: 280)
                            .background(FiloPalette.surface)
                        Divider()
                        articleList
                    }
                } else {
                    articleList
                }
            } else if showMobileDrawer {
                VStack(spacing: 0) {
                    mobileArticleHeader
                    ZStack(alignment: .leading) {
                        articleList
                        if showDrawer {
                            drawerOverlay
                        }
                    }
                }
            } else {
                VStack(spacing: 0) {
                    mobileArticleHeader
                    articleList
                }
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .focusable()
        .focused($isKeyboardFocused)
        .onKeyPress(
            keys: [KeyEquivalent("j"), .downArrow, KeyEquivalent("k"), .upArrow],
            phases: [.down, .repeat]
        ) { press in
            guard press.modifiers.isEmpty else { return .ignored }
            if press.key == .downArrow || press.key == KeyEquivalent("j") {
                moveSelection(1)
            } else if press.key == .upArrow || press.key == KeyEquivalent("k") {
                moveSelection(-1)
            } else {
                return .ignored
            }
            return .handled
        }
        .toolbar {
            if isDesktop {
                ToolbarItem(placement: .principal) {
                    Text(model.viewTitle)
                        .font(.system(size: 16, weight: .semibold))
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if model.readingListOnly {
                        Button {
                            showRemoveReadConfirm = true
                        } label: {
                            FiloIcon(.trash, size: 18)
                        }
                        .accessibilityLabel("既読記事を削除")
                        Button {
                            path.append(AppRoute.readingSession(false))
                        } label: {
                            HStack(spacing: 6) {
                                FiloIcon(.play, size: 16)
                                Text("閲覧開始")
                            }
                        }
                    }
                    if !model.bookmarkedOnly && !model.readingListOnly {
                        Button {
                            Task { await model.markAllRead() }
                        } label: {
                            FiloIcon(.checkCircle, size: 18)
                        }
                        .accessibilityLabel("すべて既読にする")
                    }
                    articleFiltersMenu
                }
            }
        }
        .confirmationDialog("既読の記事をリーディングリストから削除しますか？", isPresented: $showRemoveReadConfirm, titleVisibility: .visible) {
            Button("既読記事を削除", role: .destructive) { Task { await model.removeReadArticlesFromReadingList() } }
        }
        .refreshable { await model.refreshFeedsAndReload() }
        .onAppear { isKeyboardFocused = true }
        .task {
            await model.load()
            registerTitlesForTranslation()
            await translations.refreshLanguages()
        }
        .onChange(of: model.selectedTagId) { Task { await model.reloadArticles() } }
        .onChange(of: model.readFilter) { Task { await model.reloadArticles() } }
        .onChange(of: model.sort) { Task { await model.reloadArticles() } }
        .onChange(of: model.readOrder) { Task { await model.reloadArticles() } }
        .onChange(of: model.bookmarkedOnly) { Task { await model.reloadArticles() } }
        .onChange(of: model.readingListOnly) { Task { await model.reloadArticles() } }
        .onChange(of: model.articles) { _, articles in
            if let selectedArticleIndex {
                self.selectedArticleIndex = min(selectedArticleIndex, max(articles.count - 1, 0))
            }
            let ids = articles.map { String($0.id) }.joined(separator: ",")
            if !ids.isEmpty && ids != viewedArticleIds {
                viewedArticleIds = ids
                FiloAnalytics.track("view_item_list", parameters: ["item_list_name": "articles", "item_count": articles.count])
            }
        }
        // 翻訳トグルが ON の間は、表示された記事を翻訳対象にする
        .onChange(of: model.articles, initial: true) { registerTitlesForTranslation() }
        .onChange(of: translations.isEnabled) { registerTitlesForTranslation() }
        // 設定は articles より後に届くので、届いてから表示言語を入れ直す
        .onChange(of: model.settings) { registerTitlesForTranslation() }
        .background(shortcutButtons)
        .sheet(isPresented: $showShortcutHelp) { ShortcutHelpView() }
    }

    private var mobileArticleHeader: some View {
        HStack(spacing: 8) {
            if showMobileMenu {
                Button {
                    if let onOpenMobileDrawer {
                        onOpenMobileDrawer()
                    } else {
                        withAnimation(.easeOut(duration: 0.2)) { showDrawer = true }
                    }
                } label: {
                    FiloIcon(.menu, size: 18)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("フィードメニュー")
            }

            Text(model.viewTitle)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(FiloPalette.text)

            Spacer(minLength: 8)

            if model.readingListOnly {
                Button {
                    path.append(AppRoute.readingSession(false))
                } label: {
                    HStack(spacing: 6) {
                        FiloIcon(.play, size: 16)
                        Text("閲覧開始")
                    }
                }
                Button {
                    showRemoveReadConfirm = true
                } label: {
                    FiloIcon(.trash, size: 18)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("既読記事を削除")
            }
            if !model.bookmarkedOnly && !model.readingListOnly {
                Button {
                    Task { await model.markAllRead() }
                } label: {
                    FiloIcon(.checkCircle, size: 18)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("すべて既読にする")
            }
            articleFiltersMenu
                .frame(width: 32, height: 32)
        }
        .padding(.horizontal, 12)
        .frame(height: 51)
        .background(FiloPalette.surface)
        .overlay(alignment: .bottom) { Divider() }
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

    private var articleList: some View {
        ScrollViewReader { proxy in
            List {
                articleSection
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(FiloPalette.background)
            .overlay(alignment: .bottom) {
                if let notice = model.refreshNotice {
                    Text(notice)
                        .font(.caption)
                        .foregroundStyle(FiloPalette.muted)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(FiloPalette.surface, in: RoundedRectangle(cornerRadius: 8))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(FiloPalette.mutedBorder, lineWidth: 1)
                        )
                        .shadow(color: .black.opacity(0.12), radius: 4, y: 2)
                        .frame(maxWidth: 480, alignment: .leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .allowsHitTesting(false)
                }
            }
            .scrollPosition(id: $listScrollPosition)
            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
            .onChange(of: selectedArticleIndex) { _, index in
                guard let index, model.articles.indices.contains(index) else { return }
                withAnimation(.easeInOut(duration: 0.15)) {
                    proxy.scrollTo(model.articles[index].id, anchor: .center)
                }
            }
        }
    }

    private var articleFiltersMenu: some View {
        Menu {
            if translations.isDeviceSupported {
                Picker("タイトルを翻訳", selection: Binding(
                    get: { translations.isEnabled },
                    set: { if $0 != translations.isEnabled { translations.toggle() } }
                )) {
                    Text("オフ").tag(false)
                    Text("オン").tag(true)
                }
            }
            Picker("既読状態", selection: Binding(
                get: { model.readFilter },
                set: { model.readFilter = $0 }
            )) {
                Text("全ての記事").tag(Bool?.none)
                Text("未読").tag(Bool?.some(false))
                Text("既読").tag(Bool?.some(true))
            }
            Picker("既読の扱い", selection: $model.readOrder) {
                Text("既読で並び替えない").tag("none")
                Text("既読は下").tag("unread_first")
                Text("既読は上").tag("read_first")
            }
            Picker("並び順", selection: $model.sort) {
                Text("公開日時が新しい順").tag("published_at_desc")
                Text("取得日時が新しい順").tag("fetched_at_desc")
            }
        } label: {
            FiloIcon(.gear, size: 18)
        }
        .accessibilityLabel("表示設定")
    }

    @ViewBuilder
    private var articleSection: some View {
        Section {
            if model.isLoading, model.articles.isEmpty {
                ProgressView("記事一覧を読み込んでいます…")
            } else if let error = model.errorMessage {
                ErrorBanner(message: error) { Task { await model.load() } }
            } else if model.articles.isEmpty {
                emptyState
                } else {
                    ForEach(Array(model.articles.enumerated()), id: \.element.id) { index, article in
                        ArticleRowView(
                            article: article,
                            selected: article.id == selectedArticle?.id,
                            onOpenFeed: article.subscriptionContext.subscriptionIds.first.map { subscriptionId in
                                { path.append(AppRoute.subscriptionDetail(subscriptionId)) }
                            },
                            onOpen: {
                            FiloAnalytics.track("select_item", parameters: ["article_id": article.id])
                            if let urlString = article.canonicalUrl, let url = URL(string: urlString) {
                                if model.settings?.openInBrowserByDefault == true {
                                    openURL(url)
                                } else {
                                    path.append(AppRoute.readingArticle(ReadingSessionArticle(article)))
                                }
                            }
                        },
                        onToggleRead: {
                            Task { await model.patchState(article.id, isRead: !article.userState.isRead) }
                        },
                        onToggleReadingList: {
                            Task { await model.patchState(article.id, inReadingList: !article.userState.inReadingList) }
                        },
                        onToggleBookmark: {
                            Task { await model.patchState(article.id, isBookmarked: !article.userState.isBookmarked) }
                        },
                    )
                    .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                    .id(article.id)
                    .onAppear {
                        visibleArticleIds.insert(article.id)
                        if index >= max(model.articles.count - 4, 0) {
                            Task { await model.loadMore() }
                        }
                    }
                    .onDisappear { visibleArticleIds.remove(article.id) }
                }
                if model.isLoadingMore {
                    ProgressView("次の記事を読み込んでいます…")
                }
            }
        }
    }

    private var selectedArticle: ArticleListItem? {
        guard let selectedArticleIndex, model.articles.indices.contains(selectedArticleIndex) else { return nil }
        return model.articles[selectedArticleIndex]
    }

    private func moveSelection(_ offset: Int) {
        guard !model.articles.isEmpty else { return }
        let selectedIsVisible = selectedArticleIndex.map { index in
            model.articles.indices.contains(index) && visibleArticleIds.contains(model.articles[index].id)
        } ?? false
        let startIndex = selectedIsVisible
            ? selectedArticleIndex!
            : model.articles.firstIndex(where: { visibleArticleIds.contains($0.id) })
                ?? model.articles.firstIndex(where: { $0.id == listScrollPosition })
                ?? 0
        let nextIndex = selectedIsVisible ? startIndex + offset : startIndex
        selectedArticleIndex = min(max(nextIndex, 0), model.articles.count - 1)
    }

    private func openSelectedArticle(external: Bool) {
        guard let article = selectedArticle, let urlString = article.canonicalUrl, let url = URL(string: urlString) else { return }
        if external || model.settings?.openInBrowserByDefault == true {
            openURL(url)
        } else {
            path.append(AppRoute.readingArticle(ReadingSessionArticle(article)))
        }
    }

    private var shortcutButtons: some View {
        VStack(spacing: 0) {
            Button("", action: { openSelectedArticle(external: false) }).keyboardShortcut(.return, modifiers: [])
            Button("", action: { openSelectedArticle(external: false) }).keyboardShortcut("o", modifiers: [])
            Button("", action: { openSelectedArticle(external: true) }).keyboardShortcut("v", modifiers: [])
            Button("", action: {
                guard let article = selectedArticle else { return }
                Task { await model.patchState(article.id, isRead: !article.userState.isRead) }
            }).keyboardShortcut("m", modifiers: [])
            Button("", action: {
                guard let article = selectedArticle else { return }
                Task { await model.patchState(article.id, inReadingList: !article.userState.inReadingList) }
            }).keyboardShortcut("s", modifiers: [])
            Button("", action: {
                guard let article = selectedArticle else { return }
                Task { await model.patchState(article.id, isBookmarked: !article.userState.isBookmarked) }
            }).keyboardShortcut("b", modifiers: [])
            Button("", action: { Task { await model.refreshFeedsAndReload() } }).keyboardShortcut("r", modifiers: [])
            Button("", action: { if !model.bookmarkedOnly && !model.readingListOnly { Task { await model.markAllRead() } } })
                .keyboardShortcut("a", modifiers: [.shift])
            Button("", action: { showShortcutHelp = true }).keyboardShortcut("?", modifiers: [])
            Button("", action: {
                if showDrawer { closeDrawer() }
                else if !path.isEmpty { dismiss() }
                else { onCloseMobileDrawer() }
            }).keyboardShortcut(.escape, modifiers: [])
        }
        .frame(width: 1, height: 1)
        .opacity(0)
        .accessibilityHidden(true)
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
                    Text("フィードを追加")
                }
            }
        } else if model.readingListOnly {
            EmptyStateView {
                Text("リーディングリストに保存した記事はありません。")
                Button("全ての記事") { model.selectView() }
            }
        } else if model.readFilter == nil,
                  !model.readingListOnly,
                  !model.bookmarkedOnly,
                  relevantSubscriptions.contains(where: { $0.initialFetchStatus == "fetching" }) {
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
                .frame(maxWidth: .infinity)
                .frame(maxHeight: .infinity)
                .background(FiloPalette.surface)
                .transition(.move(edge: .leading))
        }
        .zIndex(1)
    }

    private func closeDrawer() {
        withAnimation(.easeIn(duration: 0.2)) { showDrawer = false }
    }
}

struct ShortcutHelpView: View {
    var body: some View {
        NavigationStack {
            List {
                Text("J / ↓  次の記事")
                Text("K / ↑  前の記事")
                Text("Enter / O  記事を開く")
                Text("V  元記事を開く")
                Text("M  既読／未読")
                Text("S  リーディングリスト")
                Text("B  ブックマーク")
                Text("R  更新")
                Text("Shift+A  すべて既読")
                Text("?  この一覧")
            }
            .navigationTitle("ショートカット")
        }
    }
}
