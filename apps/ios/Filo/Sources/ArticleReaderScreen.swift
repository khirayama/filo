import AVFoundation
import MediaPlayer
import SwiftUI
import WebKit

private extension Float {
    var nonZero: Float? { self == 0 ? nil : self }
}

// MARK: - Article reading screen (SPEC/SCREENS.md 記事リーディング画面)
// 実際の Web ページを開いた状態で読む。目的は読む・元記事を開く・音読・キュー追加に絞り、
// RSS 本文 / 抽出本文 / 翻訳本文を切り替える画面にはしない。

@MainActor
final class ArticleReadingViewModel: ObservableObject {
    @Published var article: ArticleDetail?
    @Published var isLoading = true
    @Published var isGone = false
    @Published var errorMessage: String?

    func load(_ articleId: Int) async {
        isLoading = true
        errorMessage = nil
        do {
            article = try await APIClient.shared.getArticle(articleId)
        } catch let error as APIError where error.status == 404 {
            isGone = true
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isLoading = false
    }

    func patchState(_ articleId: Int, isRead: Bool? = nil, inReadingList: Bool? = nil, isBookmarked: Bool? = nil) async {
        do {
            let state: ArticleUserState
            if let isRead {
                state = try await APIClient.shared.setArticleRead(articleId, isRead: isRead)
            } else if let inReadingList {
                state = try await APIClient.shared.setReadingListMembership(articleId, active: inReadingList)
            } else if let isBookmarked {
                state = try await APIClient.shared.setBookmarkMembership(articleId, active: isBookmarked)
            } else {
                return
            }
            article?.userState = state
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }
}

struct ArticleReadingScreen: View {
    let articleId: Int
    @StateObject private var model = ArticleReadingViewModel()
    @State private var showOriginalTitle = false
    @EnvironmentObject private var tts: TTSPlayerManager
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Group {
            if model.isGone {
                EmptyStateView {
                    Text("この記事は削除されたか、表示できません。")
                    Button("戻る") { dismiss() }
                }
            } else if model.isLoading {
                ProgressView("読み込み中…")
            } else if let article = model.article {
                readingBody(article)
            } else if let error = model.errorMessage {
                ErrorBanner(message: error) { Task { await model.load(articleId) } }
                    .padding()
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let article = model.article {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        Task { await model.patchState(articleId, isRead: !article.userState.isRead) }
                    } label: {
                        Image(systemName: article.userState.isRead ? "checkmark.circle.fill" : "checkmark.circle")
                    }
                    Button {
                        Task { await model.patchState(articleId, inReadingList: !article.userState.inReadingList) }
                    } label: {
                        Image(systemName: article.userState.inReadingList ? "bookmark.fill" : "bookmark")
                    }
                    Button {
                        Task { await model.patchState(articleId, isBookmarked: !article.userState.isBookmarked) }
                    } label: {
                        Image(systemName: article.userState.isBookmarked ? "star.fill" : "star")
                            .foregroundStyle(article.userState.isBookmarked ? .yellow : .primary)
                    }
                    if let urlString = article.canonicalUrl, let url = URL(string: urlString) {
                        Button {
                            openURL(url)
                        } label: {
                            Image(systemName: "safari")
                        }
                    }
                }
            }
        }
        .task(id: articleId) { await model.load(articleId) }
        .onDisappear { tts.clearViewingArticle() }
    }

    @ViewBuilder
    private func readingBody(_ article: ArticleDetail) -> some View {
        let isTranslatedTitle = article.translatedTitle != nil
        let displayTitle = (showOriginalTitle || !isTranslatedTitle) ? article.title : (article.translatedTitle ?? article.title)

        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    if let feed = article.feed {
                        FaviconView(url: feed.faviconUrl, fallbackSiteUrl: feed.siteUrl)
                        Text(feed.title)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Text(DateFormatting.relative(article.publishedAt ?? article.fetchedAt))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let author = article.author {
                        Text(author)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer()
                }
                HStack(alignment: .top, spacing: 8) {
                    Text(displayTitle)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(2)
                    if isTranslatedTitle {
                        Button {
                            showOriginalTitle.toggle()
                        } label: {
                            Text(showOriginalTitle ? "翻訳" : "原文")
                                .font(.caption2)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 2)
                                .overlay(Capsule().stroke(Color.secondary.opacity(0.5), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
                if let error = model.errorMessage {
                    ErrorBanner(message: error)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            Divider()

            if let urlString = article.canonicalUrl {
                ReaderWebView(
                    urlString: urlString,
                    articleTitle: article.title,
                    onTextExtracted: { text, lang in
                        tts.viewingArticleText = text
                        tts.viewingArticleLang = lang
                        if tts.queue.contains(where: { $0.url == urlString }) {
                            tts.prepareArticle(url: urlString, title: article.title, text: text, lang: lang)
                        }
                    },
                    onExtractionFailed: {
                        tts.viewingArticleExtractionFailed = true
                        if tts.queue.contains(where: { $0.url == urlString }) {
                            tts.markExtractionFailed(url: urlString)
                        }
                    }
                )
                .onAppear { tts.setViewingArticle(url: urlString, title: article.title) }
            } else {
                EmptyStateView {
                    Text("この記事には元記事の URL がありません。")
                }
            }
        }
    }
}

// MARK: - WebView

struct ReaderWebView: UIViewRepresentable {
    let urlString: String
    let articleTitle: String
    let onTextExtracted: (String, String?) -> Void
    let onExtractionFailed: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(url: urlString, title: articleTitle, onTextExtracted: onTextExtracted, onExtractionFailed: onExtractionFailed) }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.navigationDelegate = context.coordinator
        if let url = URL(string: urlString) {
            webView.load(URLRequest(url: url))
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let url: String
        let title: String
        let onTextExtracted: (String, String?) -> Void
        let onExtractionFailed: () -> Void
        private var hasExtracted = false

        init(url: String, title: String, onTextExtracted: @escaping (String, String?) -> Void, onExtractionFailed: @escaping () -> Void) {
            self.url = url
            self.title = title
            self.onTextExtracted = onTextExtracted
            self.onExtractionFailed = onExtractionFailed
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard !hasExtracted else { return }
            hasExtracted = true

            guard let jsURL = Bundle.main.url(forResource: "Readability", withExtension: "js"),
                  let readabilityJS = try? String(contentsOf: jsURL, encoding: .utf8) else { return }

            let script = """
            \(readabilityJS)
            ;(function() {
                var lang = document.documentElement.lang || null;
                var desc = '';
                try {
                    var m = document.querySelector('meta[property="og:description"]') ||
                            document.querySelector('meta[name="description"]');
                    if (m) desc = (m.getAttribute('content') || '').trim();
                } catch(e) {}

                function prependDesc(text) {
                    if (desc && text.indexOf(desc) === -1 && text.indexOf(desc.substring(0, 40)) === -1) {
                        return desc + '\\n\\n' + text;
                    }
                    return text;
                }

                try {
                    var article = new Readability(document.cloneNode(true)).parse();
                    if (article && article.textContent && article.textContent.trim().length > 50) {
                        return JSON.stringify({
                            text: prependDesc(article.textContent.trim()),
                            lang: article.lang || lang
                        });
                    }
                } catch(e) {}
                try {
                    var fallback = document.body.innerText || '';
                    if (fallback.trim().length > 50) {
                        return JSON.stringify({ text: prependDesc(fallback.trim()), lang: lang });
                    }
                } catch(e2) {}
                return null;
            })()
            """

            webView.evaluateJavaScript(script) { [weak self] result, _ in
                guard let self else { return }
                guard let jsonString = result as? String,
                      let data = jsonString.data(using: .utf8),
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    Task { @MainActor in self.onExtractionFailed() }
                    return
                }

                let text = json["text"] as? String ?? ""
                let lang = json["lang"] as? String

                Task { @MainActor in
                    self.onTextExtracted(text, lang)
                }
            }
        }
    }
}
