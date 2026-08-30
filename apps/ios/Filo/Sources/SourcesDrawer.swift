import SwiftUI

struct SourcesDrawer: View {
    @ObservedObject var model: ArticlesViewModel
    let onSelect: () -> Void
    var showCloseButton = true
    var onClose: (() -> Void)? = nil
    var onRoute: ((AppRoute) -> Void)? = nil
    var activeRoute: AppRoute? = nil
    @State private var expandedTags: Set<Int> = []
    @State private var untaggedExpanded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                if showCloseButton {
                    HStack {
                        Spacer()
                        Button {
                            if let onClose { onClose() } else { onSelect() }
                        } label: {
                            Image(systemName: "xmark")
                                .frame(width: 32, height: 32)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("閉じる")
                    }
                    .padding(.horizontal, 12)
                }

                Text("Filo")
                    .font(.title3.bold())
                    .padding(.horizontal, 8)
                    .padding(.bottom, 12)

                routeLink(AppRoute.addFeed) {
                    Label("フィードを追加", systemImage: "plus")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(FiloPalette.onAccent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(FiloPalette.accent, in: RoundedRectangle(cornerRadius: 6))
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 12)

                routeLink(AppRoute.addArticle("")) {
                    Label("記事を追加", systemImage: "doc.badge.plus")
                        .font(.callout)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(FiloPalette.border, lineWidth: 1))
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 12)

                drawerItem("全ての記事", icon: "list.bullet", isActive: model.selectedTagId == nil && !model.readingListOnly && !model.bookmarkedOnly) {
                    model.selectView()
                }
                drawerItem("リーディングリスト", icon: "text.badge.checkmark", isActive: model.readingListOnly && model.selectedTagId == nil) {
                    model.selectView(readingList: true)
                }
                drawerItem("ブックマーク", icon: "bookmark", isActive: model.bookmarkedOnly && model.selectedTagId == nil) {
                    model.selectView(bookmarked: true)
                }

                Text("フィード")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(FiloPalette.muted)
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .padding(.bottom, 4)

                ForEach(model.tags) { tag in
                    let items = model.subscriptions.filter { $0.tagIds.contains(tag.id) }
                    tagRow(tag: tag, items: items)
                }
                let untagged = model.subscriptions.filter { $0.tagIds.isEmpty }
                if !untagged.isEmpty {
                    untaggedRow(items: untagged)
                }

                Divider()
                    .padding(.vertical, 8)

                routeLink(AppRoute.subscriptions) {
                    drawerLabel("購読管理", icon: "list.bullet")
                        .background(activeRoute == .subscriptions ? FiloPalette.mutedBorder : Color.clear)
                        .fontWeight(activeRoute == .subscriptions ? .semibold : .regular)
                }
                routeLink(AppRoute.tags) {
                    drawerLabel("タグ管理", icon: "tag")
                        .background(activeRoute == .tags ? FiloPalette.mutedBorder : Color.clear)
                        .fontWeight(activeRoute == .tags ? .semibold : .regular)
                }
                routeLink(AppRoute.status) {
                    drawerLabel("処理ステータス", icon: "arrow.triangle.2.circlepath")
                        .background(activeRoute == .status ? FiloPalette.mutedBorder : Color.clear)
                        .fontWeight(activeRoute == .status ? .semibold : .regular)
                }
                routeLink(AppRoute.settings) {
                    drawerLabel("設定", icon: "gearshape")
                        .background(activeRoute == .settings ? FiloPalette.mutedBorder : Color.clear)
                        .fontWeight(activeRoute == .settings ? .semibold : .regular)
                }
            }
            .padding(.vertical, 8)
        }
    }

    private func drawerLabel(_ title: String, icon: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.callout)
                .frame(width: 20)
            Text(title)
                .font(.callout)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }

    private func drawerItem(_ title: String, icon: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button {
            action()
            onSelect()
        } label: {
            drawerLabel(title, icon: icon)
                .background(isActive ? FiloPalette.mutedBorder : Color.clear)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func tagRow(tag: Tag, items: [Subscription]) -> some View {
        HStack(spacing: 0) {
            Button {
                if expandedTags.contains(tag.id) { expandedTags.remove(tag.id) } else { expandedTags.insert(tag.id) }
            } label: {
                Image(systemName: expandedTags.contains(tag.id) ? "chevron.down" : "chevron.right")
                    .font(.caption)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Button {
                model.selectView(tagId: tag.id)
                onSelect()
            } label: {
                HStack {
                    Text(tag.name)
                        .font(.callout)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    Text("\(items.reduce(0) { $0 + $1.unreadCount })")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.trailing, 16)
                .padding(.vertical, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        if expandedTags.contains(tag.id) {
            ForEach(items) { subscription in
                subscriptionRow(subscription)
            }
        }
    }

    @ViewBuilder
    private func untaggedRow(items: [Subscription]) -> some View {
        HStack(spacing: 0) {
            Button {
                untaggedExpanded.toggle()
            } label: {
                Image(systemName: untaggedExpanded ? "chevron.down" : "chevron.right")
                    .font(.caption)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Text("タグなし")
                .font(.callout)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Text("\(items.reduce(0) { $0 + $1.unreadCount })")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.trailing, 16)
        }
        if untaggedExpanded {
            ForEach(items) { subscription in
                subscriptionRow(subscription)
            }
        }
    }

    private func subscriptionRow(_ subscription: Subscription) -> some View {
        routeLink(AppRoute.subscriptionDetail(subscription.id)) {
            HStack(spacing: 8) {
                FaviconView(url: subscription.feed.faviconUrl)
                Text(subscription.displayTitle)
                    .font(.callout)
                    .fontWeight(activeRoute == .subscriptionDetail(subscription.id) ? .semibold : .regular)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if subscription.initialFetchStatus == "failed" || subscription.feedHealthStatus == "paused" {
                    Image(systemName: "exclamationmark.circle")
                        .font(.caption)
                        .foregroundStyle(.red)
                } else if subscription.feedHealthStatus == "stale" {
                    Image(systemName: "zzz")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if subscription.unreadCount > 0 {
                    Text("\(subscription.unreadCount)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.leading, 40)
            .padding(.trailing, 16)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
            .background(activeRoute == .subscriptionDetail(subscription.id) ? FiloPalette.mutedBorder : Color.clear)
            .opacity(subscription.feedHealthStatus == "stale" ? 0.7 : 1)
        }
    }

    @ViewBuilder
    private func routeLink<Label: View>(_ route: AppRoute, @ViewBuilder label: () -> Label) -> some View {
        if let onRoute {
            Button {
                onSelect()
                onRoute(route)
            } label: {
                label()
            }
            .buttonStyle(.plain)
        } else {
            NavigationLink(value: route) {
                label()
            }
            .buttonStyle(.plain)
            .simultaneousGesture(TapGesture().onEnded { onSelect() })
        }
    }
}
