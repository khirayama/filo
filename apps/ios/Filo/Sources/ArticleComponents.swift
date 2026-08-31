import SwiftUI

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

struct FaviconView: View {
    let url: String?
    var fallbackSiteUrl: String? = nil

    private var effectiveUrl: URL? {
        if let url, let parsed = URL(string: url) { return parsed }
        if let site = fallbackSiteUrl,
           let parsed = URL(string: site),
           let host = parsed.host {
            return URL(string: "https://www.google.com/s2/favicons?domain=\(host)&sz=32")
        }
        return nil
    }

    var body: some View {
        if let resolved = effectiveUrl {
            AsyncImage(url: resolved) { image in
                image.resizable()
            } placeholder: {
                placeholderBox
            }
            .frame(width: 16, height: 16)
            .clipShape(RoundedRectangle(cornerRadius: 3))
        } else {
            placeholderBox
        }
    }

    private var placeholderBox: some View {
        RoundedRectangle(cornerRadius: 3)
            .fill(FiloPalette.mutedBorder)
            .frame(width: 16, height: 16)
    }
}

struct FilterChip: View {
    let label: String
    let isOn: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 13))
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
                .background(isOn ? Color.primary : Color.clear)
                .foregroundStyle(isOn ? FiloPalette.background : FiloPalette.text)
                .overlay(Capsule().stroke(FiloPalette.border, lineWidth: 1))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct ArticleRowView: View {
    let article: ArticleListItem
    var selected = false
    var horizontalPadding: CGFloat = 16
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
    private var isTranslated: Bool { translatedTitle != nil }
    private var displayTitle: String { (showOriginal ? nil : translatedTitle) ?? article.title }

    var body: some View {
        Group {
            if isDesktop {
                desktopRow
            } else {
                mobileRow
            }
        }
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, isDesktop ? 2 : 1)
        .padding(.bottom, isDesktop ? 2 : 8)
        .background(isDesktop && hovered ? Color.primary.opacity(0.03) : Color.clear)
        .opacity(article.userState.isRead ? 0.55 : 1)
        .overlay {
            if selected {
                Rectangle()
                    .stroke(FiloPalette.accent, lineWidth: 2)
            }
        }
        .onHover { hovered = $0 }
    }

    private var desktopRow: some View {
        HStack(spacing: 8) {
            HStack(spacing: 6) {
                feedName
                translationButton
            }
            .frame(width: 120, alignment: .leading)
            .clipped()

            title
                .lineLimit(1)
                .padding(.leading, 16)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let previewText = article.previewText, !previewText.isEmpty {
                Text(previewText)
                    .font(.system(size: 13))
                    .foregroundStyle(FiloPalette.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Text(DateFormatting.compact(article.publishedAt ?? article.fetchedAt))
                .font(.system(size: 12))
                .foregroundStyle(FiloPalette.muted)
                .fixedSize()
            actions
                .opacity(hovered || selected || article.userState.inReadingList || article.userState.isBookmarked ? 1 : 0)
        }
        .font(.system(size: 12))
        .foregroundStyle(FiloPalette.muted)
    }

    private var mobileRow: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                feedName
                translationButton
                Spacer(minLength: 0)
                Text(DateFormatting.compact(article.publishedAt ?? article.fetchedAt))
                    .layoutPriority(1)
                actions
            }
            .font(.system(size: 12))
            .foregroundStyle(FiloPalette.muted)
            title
        }
    }

    private var feedName: some View {
        Group {
            if let onOpenFeed {
                Button(action: onOpenFeed) {
                    Text(article.feed.title)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
            } else {
                Text(article.feed.title)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var translationButton: some View {
        Group {
            if isTranslated {
                Button {
                    showOriginal.toggle()
                } label: {
                    Text(L10n.string(showOriginal ? "翻訳" : "原文"))
                        .font(.system(size: 10))
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .overlay(
                            RoundedRectangle(cornerRadius: 3)
                                .stroke(FiloPalette.border, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var title: some View {
        Text(displayTitle)
            .font(.system(size: 14, weight: article.userState.isRead ? .regular : .semibold))
            .foregroundStyle(FiloPalette.text)
            .contentShape(Rectangle())
            .onTapGesture { onOpen?() }
    }

    private var actions: some View {
        HStack(spacing: 2) {
            actionButton(
                icon: .checkCircle,
                active: article.userState.isRead,
                activeColor: FiloPalette.muted,
                action: onToggleRead,
                label: L10n.string(article.userState.isRead ? "未読にする" : "既読にする"),
            )
            actionButton(
                icon: .queueAdd,
                active: article.userState.inReadingList,
                action: onToggleReadingList,
                label: L10n.string(article.userState.inReadingList ? "リーディングリストから削除" : "リーディングリストに追加"),
            )
            actionButton(
                icon: .bookmark,
                active: article.userState.isBookmarked,
                activeColor: FiloPalette.star,
                action: onToggleBookmark,
                label: L10n.string(article.userState.isBookmarked ? "ブックマークを解除" : "ブックマーク"),
            )
        }
    }

    @ViewBuilder
    private func actionButton(
        icon: FiloIconName,
        active: Bool,
        activeColor: Color = FiloPalette.accent,
        action: (() -> Void)?,
        label: String,
    ) -> some View {
        if let action {
            Button(action: action) {
                FiloIcon(icon, size: 18, color: active ? activeColor : FiloPalette.muted, filled: active && icon == .bookmark)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
        }
    }
}
