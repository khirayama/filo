import SwiftUI

// MARK: - Subscription detail

@MainActor
final class SubscriptionDetailViewModel: ObservableObject {
    @Published var subscription: Subscription?
    @Published var allTags: [Tag] = []
    @Published var articles: [ArticleListItem] = []
    @Published var nextCursor: String?
    @Published var isLoading = true
    @Published var isLoadingMore = false
    @Published var isGone = false
    @Published var errorMessage: String?
    @Published var openInBrowserByDefault = false

    @Published var sort = "published_at_desc" {
        didSet { if sort != oldValue { invalidateArticleRequests() } }
    }
    @Published var readFilter: Bool? {
        didSet { if readFilter != oldValue { invalidateArticleRequests() } }
    }
    @Published var readOrder = "unread_first" {
        didSet { if readOrder != oldValue { invalidateArticleRequests() } }
    }

    private var articleGeneration = 0

    let subscriptionId: Int

    init(subscriptionId: Int) {
        self.subscriptionId = subscriptionId
    }

    private var filters: ArticleListFilters {
        ArticleListFilters(
            subscriptionId: subscriptionId,
            tagId: nil,
            read: readFilter,
            sort: sort,
            readOrder: readOrder
        )
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            subscription = try await APIClient.shared.getSubscription(subscriptionId)
            allTags = (try? await APIClient.shared.listTags()) ?? []
            // 初期並び順は current user の articleSortOrder に従う
            if let settings = try? await APIClient.shared.getSettings() {
                if sort != settings.articleSortOrder { sort = settings.articleSortOrder }
                openInBrowserByDefault = settings.openInBrowserByDefault
            }
            await reloadArticles()
        } catch let error as APIError where error.status == 404 {
            isGone = true
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isLoading = false
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
                if readFilter == nil || state.isRead == readFilter {
                    articles[index].userState = state
                } else {
                    articles.remove(at: index)
                }
            }
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }

    func rename(to title: String) async {
        do {
            subscription = try await APIClient.shared.updateSubscription(subscriptionId, customTitle: title.isEmpty ? nil : title)
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }

    func toggleTag(_ tagId: Int) async {
        guard let subscription else { return }
        var next = subscription.tagIds
        if let index = next.firstIndex(of: tagId) { next.remove(at: index) } else { next.append(tagId) }
        do {
            self.subscription = try await APIClient.shared.setSubscriptionTags(subscriptionId, tagIds: next)
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }

    func markAllRead() async {
        do {
            let result = try await APIClient.shared.markAllRead(subscriptionId)
            subscription?.unreadCount = result.unreadCount
            await reloadArticles()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }

    func unsubscribe() async -> Bool {
        do {
            try await APIClient.shared.deleteSubscription(subscriptionId)
            return true
        } catch {
            errorMessage = ErrorMessages.message(for: error)
            return false
        }
    }

    func retryInitialFetch() async {
        do {
            subscription = try await APIClient.shared.retryInitialFetch(subscriptionId)
            FiloAnalytics.track("retry_feed_fetch", parameters: ["subscription_id": subscriptionId])
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }

    @Published var isRefreshingFeed = false
    @Published var refreshNotice: String?

    // Manual per-feed refresh: enqueue the fetch, poll /status until it lands, reload.
    func refreshFeedAndReload() async {
        guard let feedId = subscription?.feed.id, !isRefreshingFeed else { return }
        isRefreshingFeed = true
        refreshNotice = nil
        do {
            let result = try await APIClient.shared.refreshFeed(feedId)
            FiloAnalytics.track("refresh_feed", parameters: ["feed_id": feedId])
            let done = await ArticlesViewModel.awaitRefreshCompletion(queuedAtIso: result.queuedAt, feedId: feedId)
            if !done { refreshNotice = L10n.string("取得に時間がかかっています。あとで再度更新してください。") }
        } catch {
            refreshNotice = ErrorMessages.message(for: error)
        }
        await reloadArticles()
        isRefreshingFeed = false
    }
}

struct SubscriptionDetailScreen: View {
    @StateObject private var model: SubscriptionDetailViewModel
    @ObservedObject private var translations = TitleTranslationStore.shared
    let onOpenArticle: (ArticleListItem) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var showRename = false
    @State private var renameText = ""
    @State private var showUnsubscribeConfirm = false
    @State private var showFeedUrl = false

    init(subscriptionId: Int, onOpenArticle: @escaping (ArticleListItem) -> Void = { _ in }) {
        _model = StateObject(wrappedValue: SubscriptionDetailViewModel(subscriptionId: subscriptionId))
        self.onOpenArticle = onOpenArticle
    }

    var body: some View {
        Group {
            if model.isGone {
                EmptyStateView {
                    Text("この購読は削除されたか、表示できません。")
                    Button("購読一覧へ戻る") { dismiss() }
                }
            } else {
                contentList
            }
        }
        .scrollContentBackground(.hidden)
        .background(FiloPalette.background)
        .navigationTitle(model.subscription?.displayTitle ?? L10n.string("購読詳細"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 6) {
                    if let faviconUrl = model.subscription?.feed.faviconUrl {
                        FaviconView(url: faviconUrl)
                    }
                    Text(model.subscription?.displayTitle ?? L10n.string("購読詳細"))
                        .lineLimit(1)
                }
            }
            if !model.isGone {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        Task { await model.refreshFeedAndReload() }
                    } label: {
                        FiloIcon(.refresh, size: 18)
                    }
                    .accessibilityLabel("このフィードを更新")
                    .disabled(model.isRefreshingFeed)
                    Button {
                        Task { await model.markAllRead() }
                    } label: {
                        FiloIcon(.checkCircle, size: 18)
                    }
                    .accessibilityLabel("すべて既読にする")
                    subscriptionActionsMenu
                    articleFiltersMenu
                }
            }
        }
        .task { await model.load() }
        .onChange(of: model.sort) { Task { await model.reloadArticles() } }
        .onChange(of: model.readFilter) { Task { await model.reloadArticles() } }
        .onChange(of: model.readOrder) { Task { await model.reloadArticles() } }
        // 翻訳トグルが ON の間は、表示された記事を翻訳対象にする
        .onChange(of: model.articles, initial: true) { translations.register(model.articles) }
        .onChange(of: translations.isEnabled) { translations.register(model.articles) }
    }

    private var contentList: some View {
        List {
            if let subscription = model.subscription {
                Section {
                    statusRow(subscription)
                    tagRow(subscription)
                }
            }
            if model.isRefreshingFeed {
                ProgressView("フィードを更新しています…")
            }
            if let notice = model.refreshNotice {
                Text(notice)
                    .font(.caption)
                    .foregroundStyle(FiloPalette.muted)
            }
            if let error = model.errorMessage {
                ErrorBanner(message: error) { Task { await model.load() } }
            }
            Section {
                if model.isLoading {
                    ProgressView("購読記事を読み込んでいます…")
                } else if model.articles.isEmpty {
                    if model.subscription?.initialFetchStatus == "fetching" {
                        EmptyStateView {
                            ProgressView()
                            Text("記事を取得しています…")
                        }
                    } else {
                        EmptyStateView { Text("表示できる記事がありません。") }
                    }
                } else {
                    ForEach(Array(model.articles.enumerated()), id: \.element.id) { index, article in
                        ArticleRowView(
                            article: article,
                            onOpen: {
                                if let urlString = article.canonicalUrl,
                                   let url = URL(string: urlString) {
                                    if model.openInBrowserByDefault {
                                        openURL(url)
                                    } else {
                                        onOpenArticle(article)
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
                        .onAppear {
                            if index >= max(model.articles.count - 4, 0) {
                                Task { await model.loadMore() }
                            }
                        }
                    }
                    if model.isLoadingMore {
                        ProgressView("次の記事を読み込んでいます…")
                    }
                }
            }
        }
        .refreshable { await model.refreshFeedAndReload() }
        .alert("購読名を変更", isPresented: $showRename) {
            TextField("空欄でフィード名に戻す", text: $renameText)
            Button("変更") { Task { await model.rename(to: renameText.trimmingCharacters(in: .whitespaces)) } }
            Button("キャンセル", role: .cancel) {}
        }
        .alert("フィードURL", isPresented: $showFeedUrl) {
            Button("コピー") { UIPasteboard.general.string = model.subscription?.feed.feedUrl }
            Button("閉じる", role: .cancel) {}
        } message: {
            Text(model.subscription?.feed.feedUrl ?? "")
        }
        .confirmationDialog("この購読を解除しますか？ブックマークした記事は残ります。", isPresented: $showUnsubscribeConfirm, titleVisibility: .visible) {
            Button("購読解除", role: .destructive) {
                Task {
                    if await model.unsubscribe() { dismiss() }
                }
            }
        }
    }

    private var articleFiltersMenu: some View {
        Menu {
            if translations.isSupported {
            Picker("タイトルを翻訳", selection: Binding(
                    get: { translations.isEnabled },
                    set: { if $0 != translations.isEnabled { translations.toggle() } }
                )) {
                    Text("オフ").tag(false)
                    Text("オン").tag(true)
                }
            }
            Picker("既読状態", selection: $model.readFilter) {
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

    private var subscriptionActionsMenu: some View {
        Menu {
            Button("名前を変更") {
                renameText = model.subscription?.customTitle ?? ""
                showRename = true
            }
            if let siteUrlString = model.subscription?.feed.siteUrl, let siteUrl = URL(string: siteUrlString) {
                Button("サイトを開く") { openURL(siteUrl) }
            }
            if model.subscription?.feed.feedUrl != nil {
                Button("フィードURLを表示") { showFeedUrl = true }
            }
            Button("購読解除", role: .destructive) { showUnsubscribeConfirm = true }
        } label: {
            FiloIcon(.more, size: 18)
        }
        .accessibilityLabel("購読の操作")
    }

    @ViewBuilder
    private func statusRow(_ subscription: Subscription) -> some View {
        HStack {
            if subscription.initialFetchStatus == "failed" {
                StatusBadge(label: ErrorMessages.initialFetchMessage(for: subscription.initialFetchErrorCode), tone: .danger)
                Button("再試行") { Task { await model.retryInitialFetch() } }
                    .font(.callout)
            } else if subscription.initialFetchStatus == "fetching" {
                StatusBadge(label: "記事取得中")
            } else if subscription.feedHealthStatus == "paused" {
                StatusBadge(label: "更新停止中", tone: .danger)
            } else if subscription.feedHealthStatus == "stale" {
                StatusBadge(label: "しばらく更新なし", tone: .warn)
            }
        }
    }

    @ViewBuilder
    private func tagRow(_ subscription: Subscription) -> some View {
        if !model.allTags.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(model.allTags) { tag in
                        FilterChip(label: tag.name, isOn: subscription.tagIds.contains(tag.id)) {
                            Task { await model.toggleTag(tag.id) }
                        }
                    }
                }
            }
        }
    }

}
