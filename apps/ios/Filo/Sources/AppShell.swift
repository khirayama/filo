import SwiftUI
import UIKit

// Every signed-in screen shares one header, like the web AppShell: an optional
// back button (task screens), the title, and trailing actions. On mobile the
// header is led by the menu button unless the screen has a back button.

private struct FiloOpenDrawerKey: EnvironmentKey {
    static let defaultValue: (() -> Void)? = nil
}

extension EnvironmentValues {
    // Set by the app shell on mobile; nil where there is no drawer (desktop).
    var filoOpenDrawer: (() -> Void)? {
        get { self[FiloOpenDrawerKey.self] }
        set { self[FiloOpenDrawerKey.self] = newValue }
    }
}

struct FiloPage<Actions: View, Content: View>: View {
    let title: String
    var showsBack = false
    @ViewBuilder var actions: Actions
    @ViewBuilder var content: Content

    init(
        _ title: String,
        showsBack: Bool = false,
        @ViewBuilder actions: () -> Actions = { EmptyView() },
        @ViewBuilder content: () -> Content,
    ) {
        self.title = title
        self.showsBack = showsBack
        self.actions = actions()
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            FiloPageHeader(title: title, showsBack: showsBack) { actions }
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .background(FiloPalette.background)
        .foregroundStyle(FiloPalette.text)
        .toolbar(.hidden, for: .navigationBar)
    }
}

struct FiloPageHeader<Actions: View>: View {
    let title: String
    var showsBack = false
    @ViewBuilder var actions: Actions

    @Environment(\.dismiss) private var dismiss
    @Environment(\.filoOpenDrawer) private var openDrawer
    @Environment(\.filoIsDesktop) private var isDesktop

    var body: some View {
        let gutter = isDesktop ? FiloMetrics.desktopGutter : FiloMetrics.gutter
        let hasLead = showsBack || (!isDesktop && openDrawer != nil)
        HStack(spacing: 4) {
            if showsBack {
                FiloIconButton(.back, label: "戻る") { dismiss() }
            } else if !isDesktop, let openDrawer {
                FiloIconButton(.menu, label: "メニュー", action: openDrawer)
            }
            Text(localized: title)
                .filoFont(18, .bold)
                .lineLimit(1)
                .truncationMode(.tail)
                .accessibilityAddTraits(.isHeader)
                .padding(.leading, hasLead ? 4 : 0)
            .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 4) { actions }
        }
        .padding(.leading, hasLead ? gutter - 8 : gutter)
        // Icon buttons carry their own inset, so they end near the gutter.
        .padding(.trailing, gutter - 8)
        .frame(height: isDesktop ? FiloMetrics.desktopHeaderHeight : FiloMetrics.headerHeight)
        .background(FiloPalette.background.opacity(0.92).background(.ultraThinMaterial).ignoresSafeArea(edges: .top))
        .overlay(alignment: .bottom) { FiloDivider() }
        .zIndex(1)
    }
}

// Hiding the navigation bar also disables the edge swipe back in SwiftUI;
// restore it so every pushed screen can still be dismissed by gesture.
extension UINavigationController: @retroactive UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
    }

    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        gestureRecognizer == interactivePopGestureRecognizer ? viewControllers.count > 1 : true
    }
}

// MARK: - Sidebar navigation (desktop sidebar and mobile drawer)

struct SidebarNav: View {
    @ObservedObject var model: ArticlesViewModel
    // nil while an articles view is showing; the pushed route otherwise.
    let activeRoute: AppRoute?
    let onSelectView: () -> Void
    let onRoute: (AppRoute) -> Void
    var onClose: (() -> Void)?
    @State private var expanded: Set<Int> = []

    private static let untaggedKey = -1

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 1) {
                header
                    .padding(.bottom, 12)

                viewRow("全ての記事", icon: .inbox, count: model.unreadCounts.allArticles, isActive: isViewActive(tagId: nil, readingList: false, bookmarked: false)) {
                    model.selectView()
                }
                viewRow("リーディングリスト", icon: .playlist, count: model.unreadCounts.readingList, isActive: isViewActive(tagId: nil, readingList: true, bookmarked: false)) {
                    model.selectView(readingList: true)
                }
                viewRow("ブックマーク", icon: .bookmark, isActive: isViewActive(tagId: nil, readingList: false, bookmarked: true)) {
                    model.selectView(bookmarked: true)
                }

                Text(localized: "フィード")
                    .filoFont(12, .semibold)
                    .foregroundStyle(FiloPalette.muted)
                    .padding(.horizontal, 8)
                    .padding(.top, 20)
                    .padding(.bottom, 6)
                    .accessibilityAddTraits(.isHeader)

                ForEach(model.tags) { tag in
                    group(key: tag.id, tag: tag, label: tag.name, items: model.subscriptions.filter { $0.tagIds.contains(tag.id) })
                }
                let untagged = model.subscriptions.filter { $0.tagIds.isEmpty }
                if !untagged.isEmpty {
                    group(key: Self.untaggedKey, tag: nil, label: "タグなし", items: untagged)
                }

                VStack(spacing: 1) {
                    routeRow("購読管理", icon: .rss, route: .subscriptions)
                    routeRow("タグ管理", icon: .tag, route: .tags)
                    routeRow("処理ステータス", icon: .activity, route: .status)
                    routeRow("設定", icon: .gear, route: .settings)
                }
                .padding(.top, 12)
                .overlay(alignment: .top) { FiloDivider() }
                .padding(.top, 16)
            }
            .padding(.horizontal, 12)
            .padding(.top, onClose == nil ? 12 : 8)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .foregroundStyle(FiloPalette.text)
    }

    private var header: some View {
        HStack(spacing: 4) {
            Button(action: { model.selectView(); onSelectView() }) {
                FiloBrand(size: 26)
                    .padding(.horizontal, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(localized: "全ての記事"))
            Menu {
                Button { onRoute(.addFeed) } label: {
                    Label { Text("フィードを追加") } icon: { Image(filoIcon: .rss) }
                }
                Button { onRoute(.addArticle("")) } label: {
                    Label { Text("記事を追加") } icon: { Image(filoIcon: .playlist) }
                }
            } label: {
                FiloIconLabel(.plus)
            }
            .tint(FiloPalette.text)
            .accessibilityLabel(Text(localized: "追加"))
            if let onClose {
                FiloIconButton(.close, label: "閉じる", action: onClose)
            }
        }
        .frame(minHeight: 40)
    }

    private func isViewActive(tagId: Int?, readingList: Bool, bookmarked: Bool) -> Bool {
        activeRoute == nil
            && model.selectedTagId == tagId
            && model.readingListOnly == readingList
            && model.bookmarkedOnly == bookmarked
    }

    private func viewRow(_ title: String, icon: FiloIconName, count: Int? = nil, isActive: Bool, select: @escaping () -> Void) -> some View {
        Button {
            select()
            onSelectView()
        } label: {
            NavRowLabel(icon: icon, title: title, count: count, isActive: isActive)
        }
        .buttonStyle(NavRowStyle(isActive: isActive))
    }

    private func routeRow(_ title: String, icon: FiloIconName, route: AppRoute) -> some View {
        let isActive = activeRoute == route
        return Button { onRoute(route) } label: {
            NavRowLabel(icon: icon, title: title, isActive: isActive)
        }
        .buttonStyle(NavRowStyle(isActive: isActive))
    }

    // A tag row: the disclosure button sits in the icon slot so labels line up
    // with the plain navigation rows above.
    @ViewBuilder
    private func group(key: Int, tag: Tag?, label: String, items: [Subscription]) -> some View {
        let unread = items.reduce(0) { $0 + $1.unreadCount }
        let isExpanded = expanded.contains(key)
        let isActive = tag.map { isViewActive(tagId: $0.id, readingList: false, bookmarked: false) } ?? false
        ZStack(alignment: .leading) {
            if let tag {
                Button {
                    model.selectView(tagId: tag.id)
                    onSelectView()
                } label: {
                    NavRowLabel(title: label, count: unread, isActive: isActive, leading: NavRowLabel.childIndent)
                }
                .buttonStyle(NavRowStyle(isActive: isActive))
            } else {
                NavRowLabel(title: label, count: unread, isActive: false, leading: NavRowLabel.childIndent, muted: true)
            }
            Button {
                withAnimation(.easeOut(duration: 0.15)) {
                    if isExpanded { expanded.remove(key) } else { expanded.insert(key) }
                }
            } label: {
                FiloIcon(isExpanded ? .chevronDown : .chevronRight, size: 14)
                    .foregroundStyle(FiloPalette.muted)
                    .frame(width: 28, height: NavRowLabel.height)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.leading, 4)
            .accessibilityLabel("\(label): \(L10n.string(isExpanded ? "折りたたむ" : "展開"))")
        }
        if isExpanded {
            ForEach(items) { subscription in
                subscriptionRow(subscription)
            }
        }
    }

    private func subscriptionRow(_ subscription: Subscription) -> some View {
        let isActive = activeRoute == .subscriptionDetail(subscription.id)
        let unhealthy = subscription.initialFetchStatus == "failed" || subscription.feedHealthStatus == "paused"
        let stale = subscription.feedHealthStatus == "stale"
        return Button { onRoute(.subscriptionDetail(subscription.id)) } label: {
            HStack(spacing: 10) {
                Text(subscription.displayTitle)
                    .filoFont(15, isActive ? .semibold : .regular)
                    .foregroundStyle(stale ? FiloPalette.muted : FiloPalette.text)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if unhealthy {
                    Circle().fill(FiloPalette.danger).frame(width: 6, height: 6)
                        .accessibilityLabel(Text(localized: "更新異常"))
                }
                if subscription.unreadCount > 0 {
                    NavCount(count: subscription.unreadCount, isActive: isActive)
                }
            }
            .padding(.leading, NavRowLabel.childIndent)
            .padding(.trailing, 8)
            .frame(minHeight: NavRowLabel.height)
            .contentShape(Rectangle())
        }
        .buttonStyle(NavRowStyle(isActive: isActive))
    }
}

private struct NavRowLabel: View {
    static let height: CGFloat = 36
    // Label start for tag rows and their children (web: padding-left 38px).
    static let childIndent: CGFloat = 38

    var icon: FiloIconName?
    let title: String
    var count: Int?
    let isActive: Bool
    var leading: CGFloat = 8
    var muted = false

    var body: some View {
        HStack(spacing: 10) {
            if let icon {
                FiloIcon(icon, size: 16, color: isActive ? FiloPalette.accent : FiloPalette.muted)
                    .frame(width: 20, height: 20)
            }
            Text(localized: title)
                .filoFont(15, isActive ? .semibold : .regular)
                .foregroundStyle(muted ? FiloPalette.muted : FiloPalette.text)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let count, count > 0 {
                NavCount(count: count, isActive: isActive)
            }
        }
        .padding(.leading, leading)
        .padding(.trailing, 8)
        .frame(minHeight: Self.height)
        .contentShape(Rectangle())
    }
}

private struct NavCount: View {
    let count: Int
    let isActive: Bool

    var body: some View {
        Text("\(count)")
            .filoFont(12)
            .monospacedDigit()
            .foregroundStyle(isActive ? FiloPalette.text : FiloPalette.muted)
    }
}

private struct NavRowStyle: ButtonStyle {
    let isActive: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: FiloMetrics.radiusSmall)
                    .fill(isActive ? FiloPalette.accentSoft : (configuration.isPressed ? FiloPalette.pressed : .clear))
            )
            .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}
