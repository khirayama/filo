import Foundation

struct FeedSummary: Codable, Hashable {
    let id: Int
    let title: String
    var siteUrl: String?
    var feedUrl: String?
    var faviconUrl: String?
    var language: String?
    var latestPublishedAt: String?
}

struct Subscription: Codable, Identifiable, Hashable {
    let id: Int
    var customTitle: String?
    var unreadCount: Int
    var sortOrder: Int
    var initialFetchStatus: String
    var initialFetchErrorCode: String?
    var feedHealthStatus: String
    var feed: FeedSummary
    var tagIds: [Int]
    var createdAt: String
    var updatedAt: String

    var displayTitle: String { customTitle ?? feed.title }
}

struct MarkAllReadResult: Codable, Hashable {
    var lastReadArticleId: Int?
    var unreadCount: Int
    var updatedAt: String?
}

struct MarkAllArticlesReadResult: Codable, Hashable {
    var updatedFeeds: Int
}

struct RemoveReadArticlesResult: Codable, Hashable {
    var removedCount: Int
}

struct Tag: Codable, Identifiable, Hashable {
    let id: Int
    var name: String
    var color: String?
    var sortOrder: Int
    var subscriptionCount: Int
    var createdAt: String
    var updatedAt: String
}

struct ArticleUserState: Codable, Hashable {
    var isRead: Bool
    var inReadingList: Bool
    var isBookmarked: Bool
}

struct SavedArticleResult: Codable, Hashable {
    let articleId: Int
    let title: String
    let url: String
    let created: Bool
}

struct SubscriptionContext: Codable, Hashable {
    var subscriptionIds: [Int]
    var tagIds: [Int]
}

struct ArticleListItem: Codable, Identifiable, Hashable {
    let id: Int
    var title: String
    var sourceLanguage: String?
    var canonicalUrl: String?
    var rssSummary: String?
    var previewText: String?
    var publishedAt: String?
    var fetchedAt: String
    var feed: FeedSummary
    var subscriptionContext: SubscriptionContext
    var userState: ArticleUserState
}

struct ReadingSessionArticle: Codable, Hashable {
    struct Feed: Codable, Hashable {
        let id: Int
        let title: String
        let faviconUrl: String?
    }
    let id: Int
    let title: String
    let sourceLanguage: String?
    let canonicalUrl: String?
    let publishedAt: String?
    let feed: Feed
}

extension ReadingSessionArticle {
    init(_ article: ArticleListItem) {
        self.init(
            id: article.id,
            title: article.title,
            sourceLanguage: article.sourceLanguage,
            canonicalUrl: article.canonicalUrl,
            publishedAt: article.publishedAt,
            feed: .init(
                id: article.feed.id,
                title: article.feed.title,
                faviconUrl: article.feed.faviconUrl,
            ),
        )
    }
}

struct ReadingSessionItem: Codable, Identifiable, Hashable {
    var id: Int { articleId }
    let articleId: Int
    let sortOrder: Int
    let article: ReadingSessionArticle
    let createdAt: String?
    let isRead: Bool
}

struct ArticleContent: Codable, Hashable {
    let status: String
    let sourceLanguage: String?
    let text: String?
    let html: String?
    let errorMessage: String?
}

struct UserSettings: Codable, Hashable {
    var theme: String
    var language: String
    var readableLanguages: [String]
    var articleSortOrder: String
    var openInBrowserByDefault: Bool
    var createdAt: String
    var updatedAt: String
}

struct OpmlImportJob: Codable, Hashable {
    struct Failure: Codable, Hashable {
        var feedUrl: String
        var reason: String
    }

    var jobId: String
    var status: String
    var queuedAt: String
    var finishedAt: String?
    var total: Int?
    var created: Int?
    var skipped: Int?
    var failed: Int?
    var failures: [Failure]?
}

struct DeletionAccepted: Codable, Hashable {
    var status: String
    var deletionToken: String
    var queuedAt: String
}

struct DeletionStatus: Codable, Hashable {
    var status: String
    var retryable: Bool?
    var errorCode: String?
}

struct StatusSubscription: Codable, Identifiable, Hashable {
    var subscriptionId: Int
    var feedTitle: String
    var feedId: Int
    var feedStatus: String
    var lastResult: String?
    var lastError: String?
    var lastFetchedAt: String?
    var consecutiveFailures: Int
    var fetchJob: FeedJob?

    var id: Int { subscriptionId }
}

struct FeedJob: Codable, Hashable {
    var status: String
    var requestedAt: String?
    var startedAt: String?
    var finishedAt: String?
    var lastError: String?
    var updatedAt: String?
    var stalled: Bool

    // A stalled job (pending/running but untouched past the stall window) is
    // not treated as active, so its row buttons stay enabled for a re-run.
    var isActive: Bool { (status == "pending" || status == "running") && !stalled }
}

struct StatusFeedsOverview: Codable, Hashable {
    var total: Int
    var active: Int
    var paused: Int
    var lastFetchedAt: String?
}

struct StatusOverview: Codable, Hashable {
    var generatedAt: String
    var feeds: StatusFeedsOverview
    var articles: StatusArticles
    var subscriptionStatuses: [StatusSubscription]

    struct StatusArticles: Codable, Hashable {
        var total: Int
    }
}

struct RefreshResult: Codable, Hashable {
    var accepted: Bool
    var enqueued: Int
    var skipped: Int?
    var queuedAt: String
}

struct ArticleListFilters: Hashable {
    var subscriptionId: Int?
    var tagId: Int?
    var read: Bool?
    var readingList: Bool? = nil
    var bookmarked: Bool?
    // "published_at_desc" | "fetched_at_desc"
    var sort: String?
    // "unread_first" | "read_first" | "none"
    var readOrder: String? = nil
}

enum DateFormatting {
    private static let isoWithFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let iso: ISO8601DateFormatter = ISO8601DateFormatter()

    static func parse(_ value: String?) -> Date? {
        guard let value else { return nil }
        return isoWithFraction.date(from: value) ?? iso.date(from: value)
    }

    static func relative(_ value: String?) -> String {
        guard let date = parse(value) else { return "" }
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = .current
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    static func compact(_ value: String?) -> String {
        guard let date = parse(value) else { return "" }
        let minutes = Int(Date().timeIntervalSince(date) / 60)
        if minutes < 1 { return "now" }
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h" }
        let days = hours / 24
        if days < 7 { return "\(days)d" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP_POSIX")
        formatter.dateFormat = "M/d"
        return formatter.string(from: date)
    }
}
