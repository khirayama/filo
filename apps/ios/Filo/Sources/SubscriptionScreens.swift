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
    @Environment(\.filoIsDesktop) private var isDesktop

    private static let untaggedKey = -1

    var body: some View {
        FiloPage("購読管理") {
            if isDesktop {
                NavigationLink(value: AppRoute.tags) { FiloButtonLabel(title: "タグ管理", icon: .tag, small: true) }
                    .buttonStyle(FiloButtonStyle(small: true))
                NavigationLink(value: AppRoute.addFeed) { FiloButtonLabel(title: "フィードを追加", icon: .plus, small: true) }
                    .buttonStyle(FiloButtonStyle(kind: .primary, small: true))
                    .padding(.trailing, 8)
            } else {
                NavigationLink(value: AppRoute.tags) { FiloIcon(.tag) }
                    .buttonStyle(FiloIconButtonStyle())
                    .accessibilityLabel(Text(localized: "タグ管理"))
                NavigationLink(value: AppRoute.addFeed) { FiloIcon(.plus) }
                    .buttonStyle(FiloIconButtonStyle())
                    .accessibilityLabel(Text(localized: "フィードを追加"))
            }
        } content: {
            ScrollView {
                content
                    .frame(maxWidth: FiloMetrics.contentWidth, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, isDesktop ? FiloMetrics.desktopGutter : FiloMetrics.gutter)
                    .padding(.top, 24)
                    .padding(.bottom, 64)
            }
            .refreshable { await model.load() }
        }
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
    private var content: some View {
        if model.isLoading {
            FiloSpinner()
        } else if let error = model.errorMessage {
            FiloErrorBox(message: error) { Task { await model.load() } }
        } else if model.subscriptions.isEmpty {
            FiloEmptyState(icon: .rss, message: "まだ購読がありません。") {
                NavigationLink(value: AppRoute.addFeed) { FiloButtonLabel(title: "フィードを追加") }
                    .buttonStyle(FiloButtonStyle(kind: .primary))
            }
        } else {
            LazyVStack(alignment: .leading, spacing: 28) {
                ForEach(model.tags) { tag in
                    let items = model.subscriptions.filter { $0.tagIds.contains(tag.id) }
                    if !items.isEmpty {
                        group(key: tag.id, tag: tag, label: tag.name, items: items)
                    }
                }
                let untagged = model.subscriptions.filter { $0.tagIds.isEmpty }
                if !untagged.isEmpty {
                    group(key: Self.untaggedKey, tag: nil, label: L10n.string("タグなし"), items: untagged)
                }
            }
        }
    }

    private func group(key: Int, tag: Tag?, label: String, items: [Subscription]) -> some View {
        let isCollapsed = collapsed.contains(key)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                FiloIconButton(isCollapsed ? .chevronRight : .chevronDown, label: "\(label): \(L10n.string(isCollapsed ? "展開" : "折りたたむ"))", size: 14) {
                    withAnimation(.easeOut(duration: 0.15)) {
                        if isCollapsed { collapsed.remove(key) } else { collapsed.insert(key) }
                    }
                }
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Group {
                        if let tag {
                            // タグ名タップでタグ絞り込み済み記事一覧へ遷移する (SCREENS.md)
                            Button(label) { onSelectTag(tag.id) }
                                .buttonStyle(.plain)
                        } else {
                            Text(label)
                        }
                    }
                    .filoFont(15, .bold)
                    .lineLimit(1)
                    Text(L10n.format("%ld件の購読", items.count))
                        .filoFont(12)
                        .foregroundStyle(FiloPalette.muted)
                        .fixedSize()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let tag {
                    HStack(spacing: 2) {
                        FiloIconButton(.chevronUp, label: "タグを上へ", size: 16) { Task { await model.moveTag(tag.id, direction: -1) } }
                        FiloIconButton(.chevronDown, label: "タグを下へ", size: 16) { Task { await model.moveTag(tag.id, direction: 1) } }
                        FiloIconButton(.pencil, label: "名前変更", size: 16) {
                            renameText = tag.name
                            renamingTag = tag
                        }
                    }
                }
            }
            .frame(minHeight: 40)
            .padding(.bottom, 4)
            .overlay(alignment: .bottom) { FiloDivider(color: FiloPalette.border) }
            if !isCollapsed {
                ForEach(items) { subscription in
                    subscriptionRow(subscription, groupIds: items.map(\.id))
                }
            }
        }
    }

    private func subscriptionRow(_ subscription: Subscription, groupIds: [Int]) -> some View {
        HStack(spacing: 12) {
            NavigationLink(value: AppRoute.subscriptionDetail(subscription.id)) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(subscription.displayTitle)
                        .filoFont(14, .semibold)
                        .lineLimit(1)
                    FlowLayout(spacing: 12, lineSpacing: 4) {
                        Text(L10n.format("最終公開 %@", DateFormatting.time(subscription.feed.latestPublishedAt).isEmpty ? "—" : DateFormatting.time(subscription.feed.latestPublishedAt)))
                            .filoFont(12)
                            .foregroundStyle(FiloPalette.muted)
                        SubscriptionHealthView(subscription: subscription)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            HStack(spacing: 2) {
                TagPicker(tags: model.tags, selectedIds: subscription.tagIds) { tagId in
                    var next = subscription.tagIds
                    if let index = next.firstIndex(of: tagId) { next.remove(at: index) } else { next.append(tagId) }
                    Task { await model.setTags(subscription.id, tagIds: next) }
                }
                FiloIconButton(.chevronUp, label: "上へ", size: 16) {
                    Task { await model.move(subscription.id, direction: -1, within: groupIds) }
                }
                FiloIconButton(.chevronDown, label: "下へ", size: 16) {
                    Task { await model.move(subscription.id, direction: 1, within: groupIds) }
                }
            }
            .disabled(model.isBusy)
        }
        .foregroundStyle(FiloPalette.text)
        .padding(.leading, FiloMetrics.disclosureIndent)
        .padding(.vertical, 8)
        .frame(minHeight: 56)
        .overlay(alignment: .bottom) { FiloDivider() }
    }
}
