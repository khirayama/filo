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

struct SubscriptionContext: Codable, Hashable {
    var subscriptionIds: [Int]
    var tagIds: [Int]
}

struct ArticleListItem: Codable, Identifiable, Hashable {
    let id: Int
    var title: String
    var translatedTitle: String?
    var titleTranslationPending: Bool?
    var sourceLanguage: String?
    var canonicalUrl: String?
    var rssSummary: String?
    var previewText: String?
    var publishedAt: String?
    var fetchedAt: String
    var feed: FeedSummary
    var subscriptionContext: SubscriptionContext
    var userState: ArticleUserState

    // prefer the shared listing translation; the row toggle reveals the original
    var displayTitle: String { translatedTitle ?? title }
    var isTranslated: Bool { translatedTitle != nil }
}

struct ArticleDetail: Codable, Identifiable, Hashable {
    let id: Int
    var title: String
    var translatedTitle: String?
    var titleTranslationPending: Bool?
    var sourceLanguage: String?
    var canonicalUrl: String?
    var author: String?
    var rssSummary: String?
    var rssContentHtml: String?
    var publishedAt: String?
    var fetchedAt: String
    var feed: FeedSummary?
    var subscriptionContext: SubscriptionContext
    var userState: ArticleUserState
}

struct ArticleContent: Codable, Hashable {
    var status: String
    var sourceLanguage: String?
    var text: String?
    var html: String?
    var errorMessage: String?
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

// Translation progress is derived from stored translation rows, not from job
// records: every (article, target language) pair is missing, pending, ready,
// or failed, so the numbers always match reality.
struct TranslationCoverage: Codable, Hashable {
    var articles: Int
    var untranslatable: Int
    var needed: Int
    var ready: Int
    var failed: Int
    // queued (順番待ち) + processing (翻訳中 / LLM応答待ち) = pending.
    var queued: Int
    var processing: Int
    var pending: Int
    var missing: Int
    var lastError: String?
}

struct TranslatingTitle: Codable, Hashable {
    var title: String
    var languages: [String]
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
    var translation: TranslationCoverage
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
    var translator: TranslatorOverview
    var subscriptionStatuses: [StatusSubscription]

    struct StatusArticles: Codable, Hashable {
        var total: Int
    }

    struct TranslatorOverview: Codable, Hashable {
        var pending: Int
        var current: [TranslatingTitle]
    }
}

struct RefreshResult: Codable, Hashable {
    var accepted: Bool
    var enqueued: Int
    var skipped: Int?
    var queuedAt: String
}

struct TranslateResult: Codable, Hashable {
    var accepted: Bool
    // number of (article, language) pairs queued for translation
    var enqueued: Int
    var queuedAt: String
}

struct DiscardResult: Codable, Hashable {
    var accepted: Bool
    // number of queued/in-flight/failed pairs removed
    var removed: Int
    var discardedAt: String
}

struct PlaybackQueueArticle: Codable, Hashable {
    struct Feed: Codable, Hashable {
        let id: Int
        let title: String
        let faviconUrl: String?
    }

    let id: Int
    let title: String
    let originalTitle: String
    let sourceLanguage: String?
    let canonicalUrl: String?
    let publishedAt: String?
    let feed: Feed
}

struct PlaybackQueueEntry: Codable, Hashable {
    let articleId: Int
    let sortOrder: Int
    let article: PlaybackQueueArticle
    let createdAt: String?
}

struct PlaybackStateData: Codable, Hashable {
    let currentArticleId: Int?
    let contentLanguage: String?
    let positionPercent: Double
    let updatedAt: String?
}

struct PlaybackQueueData: Codable, Hashable {
    let items: [PlaybackQueueEntry]
    let playbackState: PlaybackStateData?
}

struct ArticleLookup: Codable, Hashable {
    let id: Int
    let title: String
    let canonicalUrl: String
    let sourceLanguage: String?
    let inQueue: Bool
}

struct ArticleListFilters: Hashable {
    var subscriptionId: Int?
    var tagId: Int?
    var read: Bool?
    var readingList: Bool?
    var bookmarked: Bool?
    // "published_at_desc" | "fetched_at_desc"。nil は server が user 設定を適用する
    var sort: String?
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
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}
