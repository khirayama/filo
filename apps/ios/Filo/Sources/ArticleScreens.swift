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
    @Published var unreadCounts = UnreadCounts(allArticles: 0, readingList: 0)

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
    @Published var isMarkingAllRead = false
    @Published var markAllReadNotice: String?

    private var articleGeneration = 0
    private var loadGeneration = 0

    var viewTitle: String {
        if let tagId = selectedTagId, let tag = tags.first(where: { $0.id == tagId }) {
            return tag.name
        }
        // A localization key (or the tag name); the header resolves it.
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
            async let bootstrapTask = APIClient.shared.getBootstrap()
            let result = try await articlesTask
            if articleGeneration == currentArticleGeneration {
                articles = result.articles
                nextCursor = result.nextCursor
            }
            let loadedBootstrap = try? await bootstrapTask
            guard loadGeneration == currentLoadGeneration else { return }
            if let loadedBootstrap {
                tags = loadedBootstrap.tags
                subscriptions = loadedBootstrap.subscriptions
                unreadCounts = loadedBootstrap.unreadCounts
                settings = loadedBootstrap.settings
                if sort != loadedBootstrap.settings.articleSortOrder { sort = loadedBootstrap.settings.articleSortOrder }
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

    // Manual refresh: enqueue feed fetches, then reload the list once. The
    // server continues the queued work after this method returns.
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
                refreshNotice = L10n.format("%ld件のフィードの取得を開始しました。", result.enqueued)
            }
        } catch {
            refreshNotice = ErrorMessages.message(for: error)
        }
        await reloadArticles()
        await refreshUnreadCounts()
        isRefreshingFeeds = false
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
    func markAllRead() async -> Bool {
        guard !isMarkingAllRead else { return false }
        isMarkingAllRead = true
        markAllReadNotice = nil
        errorMessage = nil
        defer { isMarkingAllRead = false }
        FiloAnalytics.track("mark_all_articles_read")
        do {
            _ = try await APIClient.shared.markAllArticlesRead(tagId: selectedTagId)
            await reloadArticles()
            subscriptions = (try? await APIClient.shared.listSubscriptions()) ?? subscriptions
            await refreshUnreadCounts()
            markAllReadNotice = L10n.string("既読への変更が完了しました。")
            return true
        } catch {
            errorMessage = ErrorMessages.message(for: error)
            return false
        }
    }

    func removeReadArticlesFromReadingList() async {
        FiloAnalytics.track("remove_read_articles_from_reading_list")
        do {
            _ = try await APIClient.shared.removeReadArticlesFromReadingList()
            await reloadArticles()
            await refreshUnreadCounts()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }

    func patchState(_ articleId: Int, isRead: Bool? = nil, inReadingList: Bool? = nil, isBookmarked: Bool? = nil) async {
        do {
            let before = articles.first(where: { $0.id == articleId })
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
            if let before {
                applyUnreadDelta(
                    before: before.userState,
                    after: state,
                    isSubscribed: !before.subscriptionContext.subscriptionIds.isEmpty,
                )
            }
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }

    private func applyUnreadDelta(before: ArticleUserState, after: ArticleUserState, isSubscribed: Bool) {
        let beforeUnread = before.isRead ? 0 : 1
        let afterUnread = after.isRead ? 0 : 1
        let beforeReadingListUnread = (!before.isRead && before.inReadingList) ? 1 : 0
        let afterReadingListUnread = (!after.isRead && after.inReadingList) ? 1 : 0
        let allDelta = isSubscribed ? afterUnread - beforeUnread : 0
        let readingListDelta = afterReadingListUnread - beforeReadingListUnread
        unreadCounts.allArticles = max(0, unreadCounts.allArticles + allDelta)
        unreadCounts.readingList = max(0, unreadCounts.readingList + readingListDelta)
    }

    func refreshUnreadCounts() async {
        unreadCounts = (try? await APIClient.shared.getUnreadCounts()) ?? unreadCounts
    }

}

struct ArticlesScreen: View {
    @Binding var path: NavigationPath
    @ObservedObject var model: ArticlesViewModel
    @ObservedObject private var translations = TitleTranslationStore.shared
    @Environment(\.openURL) private var openURL
    @State private var showRemoveReadConfirm = false
    @State private var selectedArticleIndex: Int? = nil
    @State private var listScrollPosition: Int? = nil
    @State private var scrollToTopToken = 0
    @State private var visibleArticleIds: Set<Int> = []
    @State private var viewedArticleIds = ""
    @State private var showShortcutHelp = false
    @FocusState private var isKeyboardFocused: Bool
    @Environment(\.filoIsDesktop) private var isDesktop

    var body: some View {
        FiloPage(model.viewTitle) {
            headerActions
        } content: {
            articleList
        }
        .focusable()
        .focused($isKeyboardFocused)
        .focusEffectDisabled()
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
        .confirmationDialog("既読の記事をリーディングリストから削除しますか？", isPresented: $showRemoveReadConfirm, titleVisibility: .visible) {
            Button("既読記事を削除", role: .destructive) { Task { await model.removeReadArticlesFromReadingList() } }
        }
        .onAppear {
            isKeyboardFocused = true
            // load() already fetches unread counts on the first appearance.
            // Keep the return-from-reading refresh without racing that load.
            if model.settings != nil {
                Task { await model.refreshUnreadCounts() }
            }
        }
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
        .disabled(model.isMarkingAllRead)
        .overlay {
            if model.isMarkingAllRead {
                BlockingProgressOverlay(message: L10n.string("既読に変更しています…"))
            }
        }
        .overlay(alignment: .bottom) {
            if let notice = model.markAllReadNotice ?? model.refreshNotice {
                FiloToast(message: notice)
            }
        }
        .animation(.easeOut(duration: 0.2), value: model.markAllReadNotice ?? model.refreshNotice)
        .task(id: model.markAllReadNotice) {
            guard model.markAllReadNotice != nil else { return }
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            model.markAllReadNotice = nil
        }
        .task(id: model.refreshNotice) {
            guard model.refreshNotice != nil else { return }
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            model.refreshNotice = nil
        }
    }

    @ViewBuilder
    private var headerActions: some View {
        if model.readingListOnly {
            let readingDisabled = model.articles.isEmpty
            if isDesktop {
                FiloButton("閲覧開始", icon: .bookOpen, small: true) {
                    path.append(AppRoute.readingSession(false))
                }
                .disabled(readingDisabled)
                FiloButton("読み上げ開始", icon: .play, kind: .primary, small: true) {
                    path.append(AppRoute.readingSession(true))
                }
                .disabled(readingDisabled)
                .padding(.trailing, 4)
            } else {
                FiloIconButton(.bookOpen, label: "閲覧開始") { path.append(AppRoute.readingSession(false)) }
                    .disabled(readingDisabled)
                FiloIconButton(.play, label: "読み上げ開始") { path.append(AppRoute.readingSession(true)) }
                    .disabled(readingDisabled)
            }
            FiloIconButton(.trash, label: "既読記事を削除") { showRemoveReadConfirm = true }
        }
        if !model.bookmarkedOnly && !model.readingListOnly {
            FiloIconButton(.checkCircle, label: "すべて既読にする") {
                Task { await markAllReadAndResetList() }
            }
            .disabled(model.isMarkingAllRead)
        }
        ArticleListControls(readFilter: $model.readFilter, sort: $model.sort, readOrder: $model.readOrder)
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
            .environment(\.defaultMinListRowHeight, 0)
            .refreshable { await model.refreshFeedsAndReload() }
            .scrollPosition(id: $listScrollPosition)
            .onChange(of: selectedArticleIndex) { _, index in
                guard let index, model.articles.indices.contains(index) else { return }
                withAnimation(.easeInOut(duration: 0.15)) {
                    proxy.scrollTo(model.articles[index].id, anchor: .center)
                }
            }
            .onChange(of: scrollToTopToken) { _, _ in
                guard let firstArticle = model.articles.first else { return }
                proxy.scrollTo(firstArticle.id, anchor: .top)
            }
        }
    }

    @ViewBuilder
    private var articleSection: some View {
        if model.isLoading, model.articles.isEmpty {
            FiloSpinner().filoListRow()
        } else if let error = model.errorMessage {
            FiloErrorBox(message: error) { Task { await model.load() } }
                .padding(FiloMetrics.gutter)
                .filoListRow()
        } else if model.articles.isEmpty {
            emptyState.filoListRow()
        } else {
            ForEach(Array(model.articles.enumerated()), id: \.element.id) { index, article in
                ArticleRowView(
                    article: article,
                    selected: article.id == selectedArticle?.id,
                    onOpenFeed: article.subscriptionContext.subscriptionIds.first.map { subscriptionId in
                        { path.append(AppRoute.subscriptionDetail(subscriptionId)) }
                    },
                    onOpen: { open(article, external: false) },
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
                .filoListRow()
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
                FiloSpinner().filoListRow()
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

    private func open(_ article: ArticleListItem, external: Bool) {
        FiloAnalytics.track("select_item", parameters: ["article_id": article.id])
        guard let urlString = article.canonicalUrl, let url = URL(string: urlString) else { return }
        if external || model.settings?.openInBrowserByDefault == true {
            openURL(url)
        } else {
            path.append(AppRoute.readingArticle(ReadingSessionArticle(article)))
        }
    }

    private func openSelectedArticle(external: Bool) {
        guard let article = selectedArticle else { return }
        open(article, external: external)
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
            Button("", action: { if !model.bookmarkedOnly && !model.readingListOnly { Task { await markAllReadAndResetList() } } })
                .keyboardShortcut("a", modifiers: [.shift])
            Button("", action: { showShortcutHelp = true }).keyboardShortcut("?", modifiers: [])
        }
        .frame(width: 1, height: 1)
        .opacity(0)
        .accessibilityHidden(true)
    }

    private func markAllReadAndResetList() async {
        guard await model.markAllRead() else { return }
        selectedArticleIndex = nil
        listScrollPosition = nil
        scrollToTopToken += 1
    }

    @ViewBuilder
    private var emptyState: some View {
        let hasFilter = model.selectedTagId != nil || model.readFilter != nil || model.readingListOnly || model.bookmarkedOnly
        if model.subscriptions.isEmpty && !hasFilter {
            FiloEmptyState(icon: .rss, message: "まだ購読がありません。") {
                FiloButton("フィードを追加", kind: .primary) { path.append(AppRoute.addFeed) }
            }
        } else if model.readFilter == nil,
                  !model.readingListOnly,
                  !model.bookmarkedOnly,
                  relevantSubscriptions.contains(where: { $0.initialFetchStatus == "fetching" }) {
            FiloEmptyState(icon: .refresh, message: "記事を取得しています…") {
                FiloButton("更新") { Task { await model.reloadArticles() } }
            }
        } else if model.readingListOnly {
            FiloEmptyState(icon: .playlist, message: "リーディングリストに保存した記事はありません。") {
                FiloButton("全ての記事") { model.selectView() }
            }
        } else if model.bookmarkedOnly {
            FiloEmptyState(icon: .bookmark, message: "表示できる記事がありません。")
        } else {
            FiloEmptyState(icon: .inbox, message: "表示できる記事がありません。")
        }
    }

    private var relevantSubscriptions: [Subscription] {
        guard let tagId = model.selectedTagId else { return model.subscriptions }
        return model.subscriptions.filter { $0.tagIds.contains(tagId) }
    }
}

struct ShortcutHelpView: View {
    @Environment(\.dismiss) private var dismiss

    // Keys and descriptions share one localized string, split at the gap.
    private let shortcuts = [
        "J / ↓  次の記事",
        "K / ↑  前の記事",
        "Enter / O  記事を開く",
        "V  元記事を開く",
        "M  既読／未読",
        "S  リーディングリスト",
        "B  ブックマーク",
        "R  更新",
        "Shift+A  すべて既読",
        "?  この一覧",
    ].map { entry -> (key: String, label: String) in
        let localized = L10n.string(entry)
        guard let gap = localized.range(of: "  ") else { return (localized, "") }
        return (String(localized[..<gap.lowerBound]), String(localized[gap.upperBound...]))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(localized: "ショートカット")
                    .filoFont(16, .bold)
                Spacer()
                FiloIconButton(.close, label: "閉じる") { dismiss() }
                    .padding(.trailing, -8)
            }
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                ForEach(shortcuts, id: \.key) { shortcut in
                    GridRow {
                        Text(verbatim: shortcut.key)
                            .filoFont(14, .medium)
                            .monospacedDigit()
                        Text(verbatim: shortcut.label)
                            .filoFont(14)
                            .foregroundStyle(FiloPalette.muted)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(FiloPalette.text)
        .padding(20)
        .presentationDetents([.medium])
        .presentationBackground(FiloPalette.surface)
    }
}
