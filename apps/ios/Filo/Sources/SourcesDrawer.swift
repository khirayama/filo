import SwiftUI

struct SourcesDrawer: View {
    @ObservedObject var model: ArticlesViewModel
    let onSelect: () -> Void
    @State private var expandedTags: Set<Int> = []
    @State private var untaggedExpanded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                Text("Filo")
                    .font(.title3.bold())
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)

                NavigationLink(value: AppRoute.addFeed) {
                    Label("フィードを追加", systemImage: "plus")
                        .font(.callout.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
                .simultaneousGesture(TapGesture().onEnded { onSelect() })

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
                    .foregroundStyle(.secondary)
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

                NavigationLink(value: AppRoute.subscriptions) {
                    drawerLabel("購読管理", icon: "list.bullet")
                }
                .buttonStyle(.plain)
                .simultaneousGesture(TapGesture().onEnded { onSelect() })
                NavigationLink(value: AppRoute.tags) {
                    drawerLabel("タグ管理", icon: "tag")
                }
                .buttonStyle(.plain)
                .simultaneousGesture(TapGesture().onEnded { onSelect() })
                NavigationLink(value: AppRoute.status) {
                    drawerLabel("処理ステータス", icon: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(.plain)
                .simultaneousGesture(TapGesture().onEnded { onSelect() })
                NavigationLink(value: AppRoute.settings) {
                    drawerLabel("設定", icon: "gearshape")
                }
                .buttonStyle(.plain)
                .simultaneousGesture(TapGesture().onEnded { onSelect() })
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
                .background(isActive ? Color.primary.opacity(0.08) : Color.clear)
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
        NavigationLink(value: AppRoute.subscriptionDetail(subscription.id)) {
            HStack(spacing: 8) {
                FaviconView(url: subscription.feed.faviconUrl, fallbackSiteUrl: subscription.feed.siteUrl)
                Text(subscription.displayTitle)
                    .font(.callout)
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
        }
        .buttonStyle(.plain)
        .simultaneousGesture(TapGesture().onEnded { onSelect() })
    }
}
