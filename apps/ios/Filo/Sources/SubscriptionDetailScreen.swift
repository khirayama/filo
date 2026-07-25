import SwiftUI

// MARK: - Subscription detail

@MainActor
final class SubscriptionDetailViewModel: ObservableObject {
    @Published var subscription: Subscription?
    @Published var allTags: [Tag] = []
    @Published var articles: [ArticleListItem] = []
    @Published var nextCursor: String?
    @Published var isLoading = true
    @Published var isGone = false
    @Published var errorMessage: String?

    @Published var sort = "published_at_desc"

    let subscriptionId: Int

    init(subscriptionId: Int) {
        self.subscriptionId = subscriptionId
    }

    private var filters: ArticleListFilters {
        ArticleListFilters(
            subscriptionId: subscriptionId,
            tagId: nil,
            sort: sort
        )
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            subscription = try await APIClient.shared.getSubscription(subscriptionId)
            allTags = (try? await APIClient.shared.listTags()) ?? []
            // 初期並び順は current user の articleSortOrder に従う
            if let settings = try? await APIClient.shared.getSettings(), sort != settings.articleSortOrder {
                sort = settings.articleSortOrder
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
        do {
            let result = try await APIClient.shared.listArticles(filters: filters)
            articles = result.articles
            nextCursor = result.nextCursor
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }

    func loadMore() async {
        guard let cursor = nextCursor else { return }
        do {
            let result = try await APIClient.shared.listArticles(filters: filters, cursor: cursor)
            articles.append(contentsOf: result.articles)
            nextCursor = result.nextCursor
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
                articles[index].userState = state
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
            let done = await ArticlesViewModel.awaitRefreshCompletion(queuedAtIso: result.queuedAt, feedId: feedId)
            if !done { refreshNotice = "取得に時間がかかっています。あとで再度更新してください。" }
        } catch {
            refreshNotice = ErrorMessages.message(for: error)
        }
        await reloadArticles()
        isRefreshingFeed = false
    }
}

struct SubscriptionDetailScreen: View {
    @StateObject private var model: SubscriptionDetailViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var showRename = false
    @State private var renameText = ""
    @State private var showUnsubscribeConfirm = false
    @State private var showMarkAllReadConfirm = false
    @State private var showFeedUrl = false

    init(subscriptionId: Int) {
        _model = StateObject(wrappedValue: SubscriptionDetailViewModel(subscriptionId: subscriptionId))
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
        .navigationTitle(model.subscription?.displayTitle ?? "購読詳細")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
        .onChange(of: model.sort) { Task { await model.reloadArticles() } }
    }

    private var contentList: some View {
        List {
            if let subscription = model.subscription {
                Section {
                    statusRow(subscription)
                    tagRow(subscription)
                    Button("すべて既読にする") { showMarkAllReadConfirm = true }
                    Button("購読名を変更") {
                        renameText = subscription.customTitle ?? ""
                        showRename = true
                    }
                    if let siteUrlString = subscription.feed.siteUrl, let siteUrl = URL(string: siteUrlString) {
                        Button("サイトを開く") { openURL(siteUrl) }
                    }
                    if subscription.feed.feedUrl != nil {
                        Button("フィードURLを表示") { showFeedUrl = true }
                    }
                    Button("購読解除", role: .destructive) { showUnsubscribeConfirm = true }
                }
                Section {
                    Picker("並び順", selection: $model.sort) {
                        Text("公開日時が新しい順").tag("published_at_desc")
                        Text("取得日時が新しい順").tag("fetched_at_desc")
                    }
                    .pickerStyle(.menu)
                }
            }
            if model.isRefreshingFeed {
                ProgressView("フィードを更新しています…")
            }
            if let notice = model.refreshNotice {
                Text(notice)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let error = model.errorMessage {
                ErrorBanner(message: error) { Task { await model.load() } }
            }
            Section {
                if model.isLoading {
                    ProgressView("読み込み中…")
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
                    ForEach(model.articles) { article in
                        NavigationLink(value: AppRoute.articleDetail(article.id)) {
                            ArticleRowView(article: article)
                        }
                        .buttonStyle(.plain)
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
                    }
                    if model.nextCursor != nil {
                        Button("さらに読み込む") { Task { await model.loadMore() } }
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
        .confirmationDialog("このフィードの記事をすべて既読にしますか？", isPresented: $showMarkAllReadConfirm, titleVisibility: .visible) {
            Button("すべて既読にする") { Task { await model.markAllRead() } }
        }
        .confirmationDialog("この購読を解除しますか？リーディングリスト・ブックマークした記事は残ります。", isPresented: $showUnsubscribeConfirm, titleVisibility: .visible) {
            Button("購読解除", role: .destructive) {
                Task {
                    if await model.unsubscribe() { dismiss() }
                }
            }
        }
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
            } else {
                StatusBadge(label: "正常", tone: .ok)
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
