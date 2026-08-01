import SwiftUI

// MARK: - Subscriptions (management root)

@MainActor
final class SubscriptionsViewModel: ObservableObject {
    @Published var subscriptions: [Subscription] = []
    @Published var tags: [Tag] = []
    @Published var isLoading = true
    @Published var errorMessage: String?

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            async let subs = APIClient.shared.listSubscriptions()
            async let tagList = APIClient.shared.listTags()
            subscriptions = try await subs
            tags = try await tagList
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isLoading = false
    }

    func move(_ subscriptionId: Int, direction: Int, within groupIds: [Int]) async {
        guard let groupIndex = groupIds.firstIndex(of: subscriptionId) else { return }
        let targetGroupIndex = groupIndex + direction
        guard targetGroupIndex >= 0, targetGroupIndex < groupIds.count else { return }
        let targetId = groupIds[targetGroupIndex]
        guard let index = subscriptions.firstIndex(where: { $0.id == subscriptionId }),
              let targetIndex = subscriptions.firstIndex(where: { $0.id == targetId }) else { return }
        subscriptions.swapAt(index, targetIndex)
        do {
            try await APIClient.shared.reorderSubscriptions(subscriptions.map(\.id))
        } catch {
            errorMessage = ErrorMessages.message(for: error)
            await load()
        }
    }

    func renameTag(_ tag: Tag, to name: String) async {
        do {
            _ = try await APIClient.shared.updateTag(tag.id, name: name)
            await load()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }

    func setTags(_ subscriptionId: Int, tagIds: [Int]) async {
        do {
            let updated = try await APIClient.shared.setSubscriptionTags(subscriptionId, tagIds: tagIds)
            if let index = subscriptions.firstIndex(where: { $0.id == subscriptionId }) {
                subscriptions[index] = updated
            }
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }
}

struct SubscriptionsScreen: View {
    var onSelectTag: (Int) -> Void = { _ in }
    @StateObject private var model = SubscriptionsViewModel()
    @State private var renamingTag: Tag?
    @State private var renameText = ""
    @State private var collapsed: Set<Int> = []

    var body: some View {
        List {
            if model.isLoading {
                ProgressView("読み込み中…")
            } else if let error = model.errorMessage, model.subscriptions.isEmpty {
                ErrorBanner(message: error) { Task { await model.load() } }
            } else if model.subscriptions.isEmpty {
                EmptyStateView {
                    Text("まだ購読がありません。")
                    NavigationLink(value: AppRoute.addFeed) {
                        Text("フィードを追加して始めましょう")
                    }
                }
            } else {
                ForEach(model.tags) { tag in
                    let items = model.subscriptions.filter { $0.tagIds.contains(tag.id) }
                    if !items.isEmpty {
                        tagSection(tag: tag, items: items)
                    }
                }
                let untagged = model.subscriptions.filter { $0.tagIds.isEmpty }
                if !untagged.isEmpty {
                    Section("タグなし") {
                        ForEach(untagged) { subscription in
                            subscriptionRow(subscription, groupIds: untagged.map(\.id))
                        }
                    }
                }
            }
        }
        .navigationTitle("購読一覧")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                NavigationLink(value: AppRoute.addFeed) {
                    Label("フィード追加", systemImage: "plus")
                }
                NavigationLink(value: AppRoute.tags) {
                    Label("タグ管理", systemImage: "tag")
                }
                NavigationLink(value: AppRoute.settings) {
                    Label("設定", systemImage: "gearshape")
                }
            }
        }
        .refreshable { await model.load() }
        .task { await model.load() }
        .alert("タグ名を変更", isPresented: Binding(get: { renamingTag != nil }, set: { if !$0 { renamingTag = nil } })) {
            TextField("タグ名", text: $renameText)
            Button("変更") {
                if let tag = renamingTag {
                    Task { await model.renameTag(tag, to: renameText) }
                }
                renamingTag = nil
            }
            Button("キャンセル", role: .cancel) { renamingTag = nil }
        }
    }

    @ViewBuilder
    private func tagSection(tag: Tag, items: [Subscription]) -> some View {
        Section {
            if !collapsed.contains(tag.id) {
                ForEach(items) { subscription in
                    subscriptionRow(subscription, groupIds: items.map(\.id))
                }
            }
        } header: {
            HStack {
                Button {
                    if collapsed.contains(tag.id) { collapsed.remove(tag.id) } else { collapsed.insert(tag.id) }
                } label: {
                    Image(systemName: collapsed.contains(tag.id) ? "chevron.right" : "chevron.down")
                        .font(.caption)
                }
                .buttonStyle(.plain)
                // タグ名タップでタグ絞り込み済み記事一覧へ遷移する (SCREENS.md)
                Button {
                    onSelectTag(tag.id)
                } label: {
                    Text(tag.name)
                }
                .buttonStyle(.plain)
                Spacer()
                Button("名前変更") {
                    renameText = tag.name
                    renamingTag = tag
                }
                .font(.caption)
            }
        }
    }

    @ViewBuilder
    private func subscriptionRow(_ subscription: Subscription, groupIds: [Int]) -> some View {
        NavigationLink(value: AppRoute.subscriptionDetail(subscription.id)) {
            HStack(spacing: 8) {
                FaviconView(url: subscription.feed.faviconUrl, fallbackSiteUrl: subscription.feed.siteUrl)
                VStack(alignment: .leading, spacing: 4) {
                    Text(subscription.displayTitle)
                        .font(.body.weight(.medium))
                    Text("最終公開 \(DateFormatting.relative(subscription.feed.latestPublishedAt).isEmpty ? "—" : DateFormatting.relative(subscription.feed.latestPublishedAt))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    healthBadge(subscription)
                }
            }
        }
        .swipeActions(edge: .leading) {
            if let index = groupIds.firstIndex(of: subscription.id), index > 0 {
                Button("上へ") { Task { await model.move(subscription.id, direction: -1, within: groupIds) } }
            }
            if let index = groupIds.firstIndex(of: subscription.id), index < groupIds.count - 1 {
                Button("下へ") { Task { await model.move(subscription.id, direction: 1, within: groupIds) } }
            }
        }
        .contextMenu {
            if !model.tags.isEmpty {
                Section("タグ") {
                    ForEach(model.tags) { tag in
                        Button {
                            Task {
                                var next = subscription.tagIds
                                if let index = next.firstIndex(of: tag.id) { next.remove(at: index) } else { next.append(tag.id) }
                                await model.setTags(subscription.id, tagIds: next)
                            }
                        } label: {
                            Label(tag.name, systemImage: subscription.tagIds.contains(tag.id) ? "checkmark.circle.fill" : "circle")
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func healthBadge(_ subscription: Subscription) -> some View {
        if subscription.initialFetchStatus == "failed" {
            StatusBadge(label: ErrorMessages.initialFetchMessage(for: subscription.initialFetchErrorCode), tone: .danger)
        } else if subscription.initialFetchStatus == "fetching" {
            StatusBadge(label: "記事取得中")
        } else if subscription.feedHealthStatus == "paused" {
            StatusBadge(label: "更新停止中", tone: .danger)
        } else if subscription.feedHealthStatus == "stale" {
            StatusBadge(label: "しばらく更新なし", tone: .warn)
        }
    }
}
