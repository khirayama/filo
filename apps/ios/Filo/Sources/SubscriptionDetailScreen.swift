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
    @Published var isMarkingAllRead = false
    @Published var markAllReadNotice: String?

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
        guard !isMarkingAllRead else { return }
        isMarkingAllRead = true
        markAllReadNotice = nil
        errorMessage = nil
        defer { isMarkingAllRead = false }
        do {
            let result = try await APIClient.shared.markAllRead(subscriptionId)
            subscription?.unreadCount = result.unreadCount
            await reloadArticles()
            markAllReadNotice = L10n.string("既読への変更が完了しました。")
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

    // Manual per-feed refresh: enqueue the fetch, then reload the list once.
    func refreshFeedAndReload() async {
        guard let feedId = subscription?.feed.id, !isRefreshingFeed else { return }
        isRefreshingFeed = true
        refreshNotice = nil
        do {
            let result = try await APIClient.shared.refreshFeed(feedId)
            FiloAnalytics.track("refresh_feed", parameters: ["feed_id": feedId])
            if result.enqueued > 0 { refreshNotice = L10n.string("フィードの取得を開始しました。") }
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
    let onSelectTag: (Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var showRename = false
    @State private var renameText = ""
    @State private var showUnsubscribeConfirm = false
    @State private var showFeedUrl = false

    init(
        subscriptionId: Int,
        onOpenArticle: @escaping (ArticleListItem) -> Void = { _ in },
        onSelectTag: @escaping (Int) -> Void = { _ in },
    ) {
        _model = StateObject(wrappedValue: SubscriptionDetailViewModel(subscriptionId: subscriptionId))
        self.onOpenArticle = onOpenArticle
        self.onSelectTag = onSelectTag
    }

    var body: some View {
        Group {
            if model.isGone {
                FiloPage("購読が見つかりません", showsBack: true) {
                    FiloEmptyState(icon: .rss, message: "この購読は削除されたか、表示できません。") {
                        FiloButton("購読一覧へ戻る") { dismiss() }
                    }
                }
            } else {
                FiloPage(model.subscription?.displayTitle ?? "", showsBack: true) {
                    if model.subscription != nil { headerActions }
                } content: {
                    contentList
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

    @ViewBuilder
    private var headerActions: some View {
        FiloIconButton(.refresh, label: "このフィードを更新") {
            Task { await model.refreshFeedAndReload() }
        }
        .disabled(model.isRefreshingFeed)
        FiloIconButton(.checkCircle, label: "すべて既読にする") {
            Task { await model.markAllRead() }
        }
        .disabled(model.isMarkingAllRead)
        subscriptionActionsMenu
        ArticleListControls(readFilter: $model.readFilter, sort: $model.sort, readOrder: $model.readOrder)
    }

    private var contentList: some View {
        List {
            if let subscription = model.subscription {
                statusBar(subscription).filoListRow()
            }
            if model.isRefreshingFeed {
                FiloSpinner(label: "フィードを更新しています…").filoListRow()
            }
            if let error = model.errorMessage {
                FiloErrorBox(message: error) { Task { await model.load() } }
                    .padding(.horizontal, FiloMetrics.gutter)
                    .padding(.top, 16)
                    .filoListRow()
            }
            if model.isLoading {
                FiloSpinner().filoListRow()
            } else if model.articles.isEmpty {
                Group {
                    if model.subscription?.initialFetchStatus == "fetching" {
                        FiloEmptyState(icon: .refresh, message: "記事を取得しています…")
                    } else {
                        FiloEmptyState(icon: .inbox, message: "表示できる記事がありません。")
                    }
                }
                .filoListRow()
            } else {
                ForEach(Array(model.articles.enumerated()), id: \.element.id) { index, article in
                    ArticleRowView(
                        article: article,
                        showFeed: false,
                        onOpen: {
                            guard let urlString = article.canonicalUrl, let url = URL(string: urlString) else { return }
                            if model.openInBrowserByDefault {
                                openURL(url)
                            } else {
                                onOpenArticle(article)
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
                    .filoListRow()
                    .onAppear {
                        if index >= max(model.articles.count - 4, 0) {
                            Task { await model.loadMore() }
                        }
                    }
                }
                if model.isLoadingMore {
                    FiloSpinner().filoListRow()
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(FiloPalette.background)
        .environment(\.defaultMinListRowHeight, 0)
        .refreshable { await model.refreshFeedAndReload() }
    }

    private var subscriptionActionsMenu: some View {
        Menu {
            Button {
                renameText = model.subscription?.customTitle ?? ""
                showRename = true
            } label: {
                Label { Text("名前を変更") } icon: { Image(filoIcon: .pencil) }
            }
            if let siteUrlString = model.subscription?.feed.siteUrl, let siteUrl = URL(string: siteUrlString) {
                Button { openURL(siteUrl) } label: {
                    Label { Text("サイトを開く") } icon: { Image(filoIcon: .externalLink) }
                }
            }
            if model.subscription?.feed.feedUrl != nil {
                Button { showFeedUrl = true } label: {
                    Label { Text("フィードURLを表示") } icon: { Image(filoIcon: .rss) }
                }
            }
            Divider()
            Button(role: .destructive) { showUnsubscribeConfirm = true } label: {
                Label { Text("購読解除") } icon: { Image(filoIcon: .trash) }
            }
        } label: {
            FiloIconLabel(.more)
        }
        .tint(FiloPalette.text)
        .accessibilityLabel(Text(localized: "購読の操作"))
    }

    // Health, assigned tags and the tag editor on one quiet line under the
    // header (web: the bar above the article rows).
    private func statusBar(_ subscription: Subscription) -> some View {
        FlowLayout(spacing: 8) {
            SubscriptionHealthView(subscription: subscription)
                .frame(height: FiloMetrics.controlHeightSmall)
            if subscription.initialFetchStatus == "failed" {
                FiloButton("初回取得を再試行", small: true) { Task { await model.retryInitialFetch() } }
            }
            ForEach(model.allTags.filter { subscription.tagIds.contains($0.id) }) { tag in
                FiloChip(label: tag.name, isOn: false, localize: false) { onSelectTag(tag.id) }
            }
            TagPicker(tags: model.allTags, selectedIds: subscription.tagIds, variant: .button) { tagId in
                Task { await model.toggleTag(tagId) }
            }
        }
        .padding(.horizontal, FiloMetrics.gutter)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { FiloDivider() }
    }
}

// Checklist menu for assigning tags to one subscription. An icon button in
// dense lists and a labelled button on the detail screen, like the web.
struct TagPicker: View {
    enum Variant { case icon, button }

    let tags: [Tag]
    let selectedIds: [Int]
    var variant: Variant = .icon
    let onToggle: (Int) -> Void

    var body: some View {
        if !tags.isEmpty {
            Menu {
                ForEach(tags) { tag in
                    Toggle(tag.name, isOn: Binding(
                        get: { selectedIds.contains(tag.id) },
                        set: { _ in onToggle(tag.id) },
                    ))
                }
            } label: {
                switch variant {
                case .icon:
                    FiloIconLabel(.tag, size: 16)
                case .button:
                    FiloButtonLabel(title: "タグを編集", icon: .tag, small: true)
                        .filoFont(13, .medium)
                        .foregroundStyle(FiloPalette.text)
                        .padding(.horizontal, 10)
                        .frame(height: FiloMetrics.controlHeightSmall)
                        .background(RoundedRectangle(cornerRadius: FiloMetrics.radiusSmall).fill(FiloPalette.surface))
                        .overlay(RoundedRectangle(cornerRadius: FiloMetrics.radiusSmall).strokeBorder(FiloPalette.border, lineWidth: 1))
                }
            }
            .menuActionDismissBehavior(.disabled)
            .tint(FiloPalette.text)
            .accessibilityLabel(Text(localized: "タグを編集"))
        }
    }
}
