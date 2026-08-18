import SwiftUI

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
                .font(.callout)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
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
    var horizontalPadding: CGFloat = 16
    var onOpen: (() -> Void)? = nil
    var onToggleRead: (() -> Void)? = nil
    var onToggleReadingList: (() -> Void)? = nil
    var onToggleBookmark: (() -> Void)? = nil
    @ObservedObject private var translations = TitleTranslationStore.shared
    @State private var showOriginal = false

    // 翻訳は端末内で走るので、届いた分から順に差し替わる
    private var translatedTitle: String? { translations.title(for: article.id) }
    private var isTranslated: Bool { translatedTitle != nil }
    private var displayTitle: String { (showOriginal ? nil : translatedTitle) ?? article.title }

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 6) {
                Text(article.feed.title)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if isTranslated {
                    Button {
                        showOriginal.toggle()
                    } label: {
                        Text(showOriginal ? "翻訳" : "原文")
                            .font(.caption2)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .overlay(
                                RoundedRectangle(cornerRadius: 3)
                                    .stroke(Color.secondary.opacity(0.5), lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
                Text(DateFormatting.compact(article.publishedAt ?? article.fetchedAt))
                    .layoutPriority(1)
                actionButton(
                    systemName: "checkmark.circle",
                    active: article.userState.isRead,
                    action: onToggleRead,
                    label: article.userState.isRead ? "未読にする" : "既読にする",
                )
                actionButton(
                    systemName: article.userState.inReadingList ? "text.badge.minus" : "text.badge.plus",
                    active: article.userState.inReadingList,
                    action: onToggleReadingList,
                    label: article.userState.inReadingList ? "リーディングリストから削除" : "リーディングリストに追加",
                )
                actionButton(
                    systemName: article.userState.isBookmarked ? "bookmark.fill" : "bookmark",
                    active: article.userState.isBookmarked,
                    activeColor: FiloPalette.star,
                    action: onToggleBookmark,
                    label: article.userState.isBookmarked ? "ブックマークを解除" : "ブックマーク",
                )
            }
            .font(.system(size: 12))
            .foregroundStyle(FiloPalette.muted)
            Text(displayTitle)
                .font(.system(size: 14, weight: article.userState.isRead ? .regular : .semibold))
                .foregroundStyle(FiloPalette.text)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture { onOpen?() }
        }
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, 8)
        .opacity(article.userState.isRead ? 0.55 : 1)
    }

    @ViewBuilder
    private func actionButton(
        systemName: String,
        active: Bool,
        activeColor: Color = FiloPalette.accent,
        action: (() -> Void)?,
        label: String,
    ) -> some View {
        if let action {
            Button(action: action) {
                Image(systemName: systemName)
                    .font(.system(size: 18))
                    .foregroundStyle(active ? activeColor : FiloPalette.muted)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
        }
    }
}
