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
            .fill(Color.secondary.opacity(0.2))
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
                .foregroundStyle(isOn ? Color(uiColor: .systemBackground) : .primary)
                .overlay(Capsule().stroke(Color.secondary.opacity(0.5), lineWidth: 1))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct ArticleRowView: View {
    let article: ArticleListItem
    @ObservedObject private var translations = TitleTranslationStore.shared
    @State private var showOriginal = false

    // 翻訳は端末内で走るので、届いた分から順に差し替わる
    private var translatedTitle: String? { translations.title(for: article.id) }
    private var isTranslated: Bool { translatedTitle != nil }
    private var displayTitle: String { (showOriginal ? nil : translatedTitle) ?? article.title }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(displayTitle)
                .font(.subheadline.weight(article.userState.isRead ? .regular : .semibold))
                .foregroundStyle(article.userState.isRead ? .secondary : .primary)
                .lineLimit(2)
            if let preview = article.previewText, !preview.isEmpty {
                Text(preview)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            HStack(spacing: 4) {
                FaviconView(url: article.feed.faviconUrl, fallbackSiteUrl: article.canonicalUrl)
                if article.userState.inReadingList {
                    Image(systemName: "text.badge.checkmark")
                        .foregroundStyle(.blue)
                }
                if article.userState.isBookmarked {
                    Image(systemName: "bookmark.fill")
                        .foregroundStyle(.yellow)
                }
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
                Text(article.feed.title)
                    .lineLimit(1)
                Text(DateFormatting.relative(article.publishedAt ?? article.fetchedAt))
                    .layoutPriority(1)
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}
