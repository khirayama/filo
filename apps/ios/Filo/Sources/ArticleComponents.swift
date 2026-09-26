import SwiftUI
import UIKit

private struct FiloIsDesktopKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var filoIsDesktop: Bool {
        get { self[FiloIsDesktopKey.self] }
        set { self[FiloIsDesktopKey.self] = newValue }
    }
}

struct FiloResponsiveContainer<Content: View>: View {
    let content: (Bool) -> Content

    init(@ViewBuilder content: @escaping (Bool) -> Content) {
        self.content = content
    }

    var body: some View {
        GeometryReader { proxy in
            content(proxy.size.width >= 1024)
                .environment(\.filoIsDesktop, proxy.size.width >= 1024)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

// Mirrors the web ArticleRow: on mobile a feed/date line over a two-line
// title; on desktop one dense line whose actions appear on hover.
struct ArticleRowView: View {
    let article: ArticleListItem
    var selected = false
    // Off inside a single subscription, where every row has the same feed.
    var showFeed = true
    var onOpenFeed: (() -> Void)? = nil
    var onOpen: (() -> Void)? = nil
    var onToggleRead: (() -> Void)? = nil
    var onToggleReadingList: (() -> Void)? = nil
    var onToggleBookmark: (() -> Void)? = nil
    @ObservedObject private var translations = TitleTranslationStore.shared
    @State private var showOriginal = false
    @State private var hovered = false
    @Environment(\.filoIsDesktop) private var isDesktop

    // 翻訳は端末内で走るので、届いた分から順に差し替わる
    private var translatedTitle: String? { translations.title(for: article.id) }
    private var displayTitle: String { (showOriginal ? nil : translatedTitle) ?? article.title }
    private var isRead: Bool { article.userState.isRead }

    var body: some View {
        Group {
            if isDesktop {
                desktopRow
            } else {
                mobileRow
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(selected || hovered ? FiloPalette.rowHover : FiloPalette.background)
        .overlay(alignment: .leading) {
            if selected {
                Rectangle().fill(FiloPalette.accent).frame(width: 3)
            }
        }
        .overlay(alignment: .bottom) { FiloDivider() }
        .contentShape(Rectangle())
        .onTapGesture { onOpen?() }
        .onHover { hovered = $0 }
        .contextMenu {
            if let urlString = article.canonicalUrl, let url = URL(string: urlString) {
                Button {
                    UIApplication.shared.open(url)
                } label: {
                    Label { Text("ブラウザで開く") } icon: { Image(filoIcon: .externalLink) }
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var mobileRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                if showFeed { feedLabel }
                translationToggle
                Spacer(minLength: 0)
                date
                actions
                    .padding(.vertical, -8)
                    .padding(.trailing, -10)
            }
            .frame(minHeight: 24)
            title
                .filoFont(15, isRead ? .regular : .semibold)
                .lineSpacing(4)
                .lineLimit(2)
        }
        .padding(.horizontal, FiloMetrics.gutter)
        .padding(.vertical, 12)
    }

    private var desktopRow: some View {
        HStack(spacing: 16) {
            if showFeed {
                feedLabel
                    .frame(width: 160, alignment: .leading)
            }
            HStack(spacing: 8) {
                translationToggle
                title
                    .filoFont(14, isRead ? .regular : .semibold)
                    .lineLimit(1)
                    .layoutPriority(1)
                if let preview = article.previewText, !preview.isEmpty {
                    Text(preview)
                        .filoFont(13)
                        .foregroundStyle(FiloPalette.muted)
                        .lineLimit(1)
                        .frame(minWidth: 80, alignment: .leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            ZStack(alignment: .trailing) {
                HStack(spacing: 10) {
                    marks
                    date
                }
                .opacity(hovered || selected ? 0 : 1)
                actions
                    .opacity(hovered || selected ? 1 : 0)
            }
            .frame(minWidth: 44, alignment: .trailing)
        }
        .frame(height: 40)
        .padding(.horizontal, FiloMetrics.desktopGutter)
    }

    private var feedLabel: some View {
        Text(article.feed.title)
            .filoFont(12)
            .foregroundStyle(FiloPalette.muted)
            .lineLimit(1)
            .truncationMode(.tail)
            .contentShape(Rectangle())
        .onTapGesture { onOpenFeed?() }
        .accessibilityAddTraits(onOpenFeed == nil ? [] : .isLink)
    }

    @ViewBuilder
    private var translationToggle: some View {
        if translatedTitle != nil {
            Button {
                showOriginal.toggle()
            } label: {
                Text(localized: showOriginal ? "翻訳" : "原文")
                    .filoFont(10)
                    .foregroundStyle(FiloPalette.muted)
                    .padding(.horizontal, 5)
                    .frame(height: 18)
                    .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(FiloPalette.border, lineWidth: 1))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .fixedSize()
        }
    }

    private var title: some View {
        Text(displayTitle)
            .foregroundStyle(isRead ? FiloPalette.muted : FiloPalette.text)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var date: some View {
        Text(DateFormatting.compact(article.publishedAt ?? article.fetchedAt))
            .filoFont(12)
            .monospacedDigit()
            .foregroundStyle(FiloPalette.muted)
            .fixedSize()
    }

    // Saved states stay visible as small marks on desktop; the full toggle set
    // appears on hover (desktop) or is always present (touch).
    @ViewBuilder
    private var marks: some View {
        if article.userState.inReadingList || article.userState.isBookmarked {
            HStack(spacing: 4) {
                if article.userState.inReadingList {
                    FiloIcon(.playlist, size: 14, color: FiloPalette.accent)
                }
                if article.userState.isBookmarked {
                    FiloIcon(.bookmark, size: 14, color: FiloPalette.star, filled: true)
                }
            }
        }
    }

    private var actions: some View {
        HStack(spacing: 2) {
            if let onToggleRead {
                FiloIconButton(
                    .checkCircle,
                    label: isRead ? "未読にする" : "既読にする",
                    color: isRead ? FiloPalette.accent : nil,
                    action: onToggleRead,
                )
            }
            if let onToggleReadingList {
                FiloIconButton(
                    .queueAdd,
                    label: article.userState.inReadingList ? "リーディングリストから削除" : "リーディングリストに追加",
                    color: article.userState.inReadingList ? FiloPalette.accent : nil,
                    action: onToggleReadingList,
                )
            }
            if let onToggleBookmark {
                FiloIconButton(
                    .bookmark,
                    label: article.userState.isBookmarked ? "ブックマークを解除" : "ブックマーク",
                    color: article.userState.isBookmarked ? FiloPalette.star : nil,
                    filled: article.userState.isBookmarked,
                    action: onToggleBookmark,
                )
            }
        }
    }
}

// The web ArticleListControls popover: title translation, read filter, sort
// order and read ordering behind one gear button.
struct ArticleListControls: View {
    @Binding var readFilter: Bool?
    @Binding var sort: String
    @Binding var readOrder: String
    @ObservedObject private var translations = TitleTranslationStore.shared
    @State private var isOpen = false

    var body: some View {
        FiloIconButton(.gear, label: "表示設定") { isOpen = true }
            .popover(isPresented: $isOpen, arrowEdge: .top) {
                content
                    .frame(width: 300)
                    .presentationCompactAdaptation(.popover)
                    .presentationBackground(FiloPalette.surface)
            }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            if translations.isSupported {
                HStack(spacing: 12) {
                    HStack(spacing: 6) {
                        Text(localized: "タイトルを翻訳").filoFont(14)
                        if translations.isTranslating {
                            Text(localized: "翻訳中…")
                                .filoFont(12)
                                .foregroundStyle(FiloPalette.muted)
                        }
                    }
                    Spacer(minLength: 0)
                    FiloToggle(label: "タイトルを翻訳", isOn: Binding(
                        get: { translations.isEnabled },
                        set: { if $0 != translations.isEnabled { choose { translations.toggle() } } },
                    ))
                }
                .frame(minHeight: 44)
                FiloDivider()
                    .padding(.horizontal, -12)
                    .padding(.bottom, 4)
            }
            group("既読状態", top: 8) {
                FiloChip(label: "全ての記事", isOn: readFilter == nil) { choose { readFilter = nil } }
                FiloChip(label: "未読", isOn: readFilter == false) { choose { readFilter = false } }
                FiloChip(label: "既読", isOn: readFilter == true) { choose { readFilter = true } }
            }
            group("並び順", top: 16) {
                FiloChip(label: "公開日時が新しい順", isOn: sort == "published_at_desc") { choose { sort = "published_at_desc" } }
                FiloChip(label: "取得日時が新しい順", isOn: sort == "fetched_at_desc") { choose { sort = "fetched_at_desc" } }
            }
            group("既読の扱い", top: 16) {
                FiloChip(label: "既読で並び替えない", isOn: readOrder == "none") { choose { readOrder = "none" } }
                FiloChip(label: "既読は下", isOn: readOrder == "unread_first") { choose { readOrder = "unread_first" } }
                FiloChip(label: "既読は上", isOn: readOrder == "read_first") { choose { readOrder = "read_first" } }
            }
        }
        .foregroundStyle(FiloPalette.text)
        .padding(.horizontal, 12)
        .padding(.top, 4)
        .padding(.bottom, 14)
    }

    private func group<Chips: View>(_ label: String, top: CGFloat, @ViewBuilder chips: () -> Chips) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(localized: label)
                .filoFont(12, .semibold)
                .foregroundStyle(FiloPalette.muted)
                .accessibilityAddTraits(.isHeader)
            FlowLayout(spacing: 6) { chips() }
        }
        .padding(.top, top)
    }

    private func choose(_ action: () -> Void) {
        action()
        isOpen = false
    }
}

// Rows of an article list inside a plain List: no insets, no system
// separators (rows draw their own full-width hairline).
extension View {
    func filoListRow() -> some View {
        listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(FiloPalette.background)
    }
}
