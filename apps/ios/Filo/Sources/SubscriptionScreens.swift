import SwiftUI

// MARK: - Subscriptions (management root)

@MainActor
final class SubscriptionsViewModel: ObservableObject {
    @Published var subscriptions: [Subscription] = []
    @Published var tags: [Tag] = []
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var isBusy = false

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
        guard !isBusy else { return }
        guard let groupIndex = groupIds.firstIndex(of: subscriptionId) else { return }
        let targetGroupIndex = groupIndex + direction
        guard targetGroupIndex >= 0, targetGroupIndex < groupIds.count else { return }
        let targetId = groupIds[targetGroupIndex]
        guard let index = subscriptions.firstIndex(where: { $0.id == subscriptionId }),
              let targetIndex = subscriptions.firstIndex(where: { $0.id == targetId }) else { return }
        subscriptions.swapAt(index, targetIndex)
        isBusy = true
        do {
            try await APIClient.shared.reorderSubscriptions(subscriptions.map(\.id))
        } catch {
            errorMessage = ErrorMessages.message(for: error)
            await load()
        }
        isBusy = false
    }

    func renameTag(_ tag: Tag, to name: String) async {
        do {
            _ = try await APIClient.shared.updateTag(tag.id, name: name)
            await load()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }

    func moveTag(_ tagId: Int, direction: Int) async {
        guard let index = tags.firstIndex(where: { $0.id == tagId }) else { return }
        let target = index + direction
        guard tags.indices.contains(target) else { return }
        tags.swapAt(index, target)
        do {
            try await APIClient.shared.reorderTags(tags.map(\.id))
        } catch {
            errorMessage = ErrorMessages.message(for: error)
            await load()
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
            } else if let error = model.errorMessage {
                ErrorBanner(message: error) { Task { await model.load() } }
            } else if model.subscriptions.isEmpty {
                EmptyStateView {
                    Text("まだ購読がありません。")
                    NavigationLink(value: AppRoute.addFeed) {
                        Text("フィードを追加")
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
                    Section {
                        if !collapsed.contains(-1) {
                            ForEach(untagged) { subscription in
                                subscriptionRow(subscription, groupIds: untagged.map(\.id))
                            }
                        }
                    } header: {
                        HStack {
                            Button {
                                if collapsed.contains(-1) { collapsed.remove(-1) } else { collapsed.insert(-1) }
                            } label: {
                                FiloIcon(collapsed.contains(-1) ? .chevronRight : .chevronDown, size: 14)
                            }
                            .buttonStyle(.plain)
                            Text("タグなし")
                            Text(L10n.format("%ld件", untagged.count))
                                .foregroundStyle(FiloPalette.muted)
                            Spacer()
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(FiloPalette.background)
        .navigationTitle("購読管理")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                NavigationLink(value: AppRoute.addFeed) {
                    FiloIcon(.plus, size: 18)
                }
                .accessibilityLabel("フィード追加")
                NavigationLink(value: AppRoute.tags) {
                    FiloIcon(.tag, size: 18)
                }
                .accessibilityLabel("タグ管理")
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
                    FiloIcon(collapsed.contains(tag.id) ? .chevronRight : .chevronDown, size: 14)
                }
                .buttonStyle(.plain)
                // タグ名タップでタグ絞り込み済み記事一覧へ遷移する (SCREENS.md)
                Button {
                    onSelectTag(tag.id)
                } label: {
                    Text(tag.name)
                }
                .buttonStyle(.plain)
                Text(L10n.format("%ld件", items.count))
                    .font(.caption)
                    .foregroundStyle(FiloPalette.muted)
                Spacer()
                Button {
                    Task { await model.moveTag(tag.id, direction: -1) }
                } label: {
                    FiloIcon(.chevronUp, size: 14)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("タグを上へ")
                Button {
                    Task { await model.moveTag(tag.id, direction: 1) }
                } label: {
                    FiloIcon(.chevronDown, size: 14)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("タグを下へ")
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
        HStack(spacing: 8) {
            NavigationLink(value: AppRoute.subscriptionDetail(subscription.id)) {
                HStack(spacing: 8) {
                    FaviconView(url: subscription.feed.faviconUrl)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(subscription.displayTitle)
                            .font(.body.weight(.medium))
                        Text(L10n.format("最終公開 %@", DateFormatting.relative(subscription.feed.latestPublishedAt).isEmpty ? "—" : DateFormatting.relative(subscription.feed.latestPublishedAt)))
                            .font(.caption)
                            .foregroundStyle(FiloPalette.muted)
                        healthBadge(subscription)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            if !model.tags.isEmpty {
                Menu {
                    ForEach(model.tags) { tag in
                        Button {
                            Task {
                                var next = subscription.tagIds
                                if let index = next.firstIndex(of: tag.id) { next.remove(at: index) } else { next.append(tag.id) }
                                await model.setTags(subscription.id, tagIds: next)
                            }
                        } label: {
                            Text(tag.name)
                        }
                    }
                } label: {
                    FiloIcon(.tag, size: 18)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("タグを編集")
            }
            Button {
                Task { await model.move(subscription.id, direction: -1, within: groupIds) }
            } label: {
                FiloIcon(.chevronUp, size: 14)
            }
            .buttonStyle(.plain)
            .disabled(model.isBusy)
            .accessibilityLabel("上へ")
            Button {
                Task { await model.move(subscription.id, direction: 1, within: groupIds) }
            } label: {
                FiloIcon(.chevronDown, size: 14)
            }
            .buttonStyle(.plain)
            .disabled(model.isBusy)
            .accessibilityLabel("下へ")
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 4)
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
                            Text(tag.name)
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
