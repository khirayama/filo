package com.filo.app.api

import org.json.JSONArray
import org.json.JSONObject

data class FeedSummary(
    val id: Int,
    val title: String,
    val siteUrl: String?,
    val feedUrl: String?,
    val faviconUrl: String?,
    // サーバーが決めた feed の言語。翻訳の準備画面の候補に使う
    val language: String?,
    val latestPublishedAt: String?,
)

data class Subscription(
    val id: Int,
    val customTitle: String?,
    val unreadCount: Int,
    val sortOrder: Int,
    val initialFetchStatus: String,
    val initialFetchErrorCode: String?,
    val feedHealthStatus: String,
    val feed: FeedSummary,
    val tagIds: List<Int>,
) {
    val displayTitle: String get() = customTitle ?: feed.title
}

data class Tag(
    val id: Int,
    val name: String,
    val color: String?,
    val sortOrder: Int,
    val subscriptionCount: Int,
)

data class MarkAllReadResult(
    val lastReadArticleId: Int?,
    val unreadCount: Int,
    val updatedAt: String?,
)

data class ArticleUserState(
    val isRead: Boolean,
    val inReadingList: Boolean,
    val isBookmarked: Boolean,
)

data class ArticleListItem(
    val id: Int,
    val title: String,
    val sourceLanguage: String?,
    val canonicalUrl: String?,
    val previewText: String?,
    val publishedAt: String?,
    val fetchedAt: String,
    val feedTitle: String,
    val feedFaviconUrl: String?,
    val subscriptionIds: List<Int>,
    val userState: ArticleUserState,
)

data class UserSettings(
    val theme: String,
    val language: String,
    val readableLanguages: List<String>,
    val articleSortOrder: String,
    val openInBrowserByDefault: Boolean,
)

data class OpmlImportFailure(
    val feedUrl: String,
    val reason: String?,
)

data class OpmlImportJob(
    val jobId: String,
    val status: String,
    val created: Int?,
    val skipped: Int?,
    val failed: Int?,
    val failures: List<OpmlImportFailure> = emptyList(),
)

data class DeletionAccepted(val status: String, val deletionToken: String)

data class DeletionStatus(val status: String, val retryable: Boolean?)

data class StatusSubscription(
    val subscriptionId: Int,
    val feedTitle: String,
    val feedId: Int,
    val feedStatus: String,
    val lastResult: String?,
    val lastError: String?,
    val lastFetchedAt: String?,
    val consecutiveFailures: Int,
    val fetchJob: FeedJob?,
)

data class FeedJob(
    val status: String,
    val requestedAt: String?,
    val startedAt: String?,
    val finishedAt: String?,
    val lastError: String?,
    val updatedAt: String?,
    val stalled: Boolean,
) {
    // A stalled job (pending/running but untouched past the stall window) is
    // not treated as active, so its row buttons stay enabled for a re-run.
    val isActive: Boolean get() = (status == "pending" || status == "running") && !stalled
}

data class StatusFeedsOverview(
    val total: Int,
    val active: Int,
    val paused: Int,
    val lastFetchedAt: String?,
)

data class StatusOverview(
    val generatedAt: String,
    val feeds: StatusFeedsOverview,
    val articleTotal: Int,
    val subscriptionStatuses: List<StatusSubscription>,
)

data class RefreshResult(val accepted: Boolean, val enqueued: Int, val skipped: Int, val queuedAt: String)

data class ArticleListFilters(
    val subscriptionId: Int? = null,
    val tagId: Int? = null,
    val read: Boolean? = null,
    val readingList: Boolean? = null,
    val bookmarked: Boolean? = null,
    // "published_at_desc" | "fetched_at_desc"。null は server が user 設定を適用する
    val sort: String? = null,
)

data class ArticlePage(val articles: List<ArticleListItem>, val nextCursor: String?)

internal fun JSONObject.optStringOrNull(key: String): String? =
    if (isNull(key)) null else optString(key, null)

internal fun JSONArray.toIntList(): List<Int> = (0 until length()).map { getInt(it) }

internal fun parseFeedSummary(json: JSONObject): FeedSummary =
    FeedSummary(
        id = json.getInt("id"),
        title = json.optString("title", ""),
        siteUrl = json.optStringOrNull("siteUrl"),
        feedUrl = json.optStringOrNull("feedUrl"),
        faviconUrl = json.optStringOrNull("faviconUrl"),
        language = json.optStringOrNull("language"),
        latestPublishedAt = json.optStringOrNull("latestPublishedAt"),
    )

internal fun parseSubscription(json: JSONObject): Subscription =
    Subscription(
        id = json.getInt("id"),
        customTitle = json.optStringOrNull("customTitle"),
        unreadCount = json.optInt("unreadCount", 0),
        sortOrder = json.optInt("sortOrder", 0),
        initialFetchStatus = json.optString("initialFetchStatus", "ready"),
        initialFetchErrorCode = json.optStringOrNull("initialFetchErrorCode"),
        feedHealthStatus = json.optString("feedHealthStatus", "healthy"),
        feed = parseFeedSummary(json.getJSONObject("feed")),
        tagIds = json.optJSONArray("tagIds")?.toIntList() ?: emptyList(),
    )

internal fun parseMarkAllReadResult(json: JSONObject): MarkAllReadResult =
    MarkAllReadResult(
        lastReadArticleId = if (json.isNull("lastReadArticleId")) null else json.optInt("lastReadArticleId"),
        unreadCount = json.optInt("unreadCount", 0),
        updatedAt = json.optStringOrNull("updatedAt"),
    )

internal fun parseTag(json: JSONObject): Tag =
    Tag(
        id = json.getInt("id"),
        name = json.optString("name", ""),
        color = json.optStringOrNull("color"),
        sortOrder = json.optInt("sortOrder", 0),
        subscriptionCount = json.optInt("subscriptionCount", 0),
    )

internal fun parseUserState(json: JSONObject?): ArticleUserState =
    ArticleUserState(
        isRead = json?.optBoolean("isRead", false) ?: false,
        inReadingList = json?.optBoolean("inReadingList", false) ?: false,
        isBookmarked = json?.optBoolean("isBookmarked", false) ?: false,
    )

internal fun parseArticleListItem(json: JSONObject): ArticleListItem =
    ArticleListItem(
        id = json.getInt("id"),
        title = json.optString("title", ""),
        sourceLanguage = json.optStringOrNull("sourceLanguage"),
        canonicalUrl = json.optStringOrNull("canonicalUrl"),
        previewText = json.optStringOrNull("previewText"),
        publishedAt = json.optStringOrNull("publishedAt"),
        fetchedAt = json.optString("fetchedAt", ""),
        feedTitle = json.optJSONObject("feed")?.optString("title", "") ?: "",
        feedFaviconUrl = json.optJSONObject("feed")?.optStringOrNull("faviconUrl"),
        subscriptionIds = json.optJSONObject("subscriptionContext")?.optJSONArray("subscriptionIds")?.toIntList()
            ?: emptyList(),
        userState = parseUserState(json.optJSONObject("userState")),
    )

private fun parseFeedJob(json: JSONObject?): FeedJob? =
    json?.let {
        FeedJob(
            status = it.optString("status", ""),
            requestedAt = it.optStringOrNull("requestedAt"),
            startedAt = it.optStringOrNull("startedAt"),
            finishedAt = it.optStringOrNull("finishedAt"),
            lastError = it.optStringOrNull("lastError"),
            updatedAt = it.optStringOrNull("updatedAt"),
            stalled = it.optBoolean("stalled", false),
        )
    }

internal fun parseStatusOverview(json: JSONObject): StatusOverview {
    val feeds = json.getJSONObject("feeds")
    val subsArr = json.optJSONArray("subscriptionStatuses") ?: JSONArray()
    val subs = (0 until subsArr.length()).map { i ->
        val s = subsArr.getJSONObject(i)
        StatusSubscription(
            subscriptionId = s.getInt("subscriptionId"),
            feedTitle = s.optString("feedTitle", ""),
            feedId = s.getInt("feedId"),
            feedStatus = s.optString("feedStatus", ""),
            lastResult = s.optStringOrNull("lastResult"),
            lastError = s.optStringOrNull("lastError"),
            lastFetchedAt = s.optStringOrNull("lastFetchedAt"),
            consecutiveFailures = s.optInt("consecutiveFailures", 0),
            fetchJob = parseFeedJob(s.optJSONObject("fetchJob")),
        )
    }
    return StatusOverview(
        generatedAt = json.optString("generatedAt", ""),
        feeds = StatusFeedsOverview(
            total = feeds.optInt("total", 0),
            active = feeds.optInt("active", 0),
            paused = feeds.optInt("paused", 0),
            lastFetchedAt = feeds.optStringOrNull("lastFetchedAt"),
        ),
        articleTotal = json.optJSONObject("articles")?.optInt("total", 0) ?: 0,
        subscriptionStatuses = subs,
    )
}

internal fun parseRefreshResult(json: JSONObject): RefreshResult =
    RefreshResult(
        accepted = json.optBoolean("accepted", false),
        enqueued = json.optInt("enqueued", 0),
        skipped = json.optInt("skipped", 0),
        queuedAt = json.optString("queuedAt", ""),
    )

internal fun parseSettings(json: JSONObject): UserSettings =
    UserSettings(
        theme = json.optString("theme", "system"),
        language = json.optString("language", "ja"),
        readableLanguages = json.optJSONArray("readableLanguages")
            ?.let { arr -> (0 until arr.length()).map { arr.getString(it) } }
            ?: listOf("ja"),
        articleSortOrder = json.optString("articleSortOrder", "published_at_desc"),
        openInBrowserByDefault = json.optBoolean("openInBrowserByDefault", false),
    )

internal fun parseOpmlJob(json: JSONObject): OpmlImportJob =
    OpmlImportJob(
        jobId = json.optString("jobId", ""),
        status = json.optString("status", "pending"),
        created = if (json.has("created")) json.optInt("created") else null,
        skipped = if (json.has("skipped")) json.optInt("skipped") else null,
        failed = if (json.has("failed")) json.optInt("failed") else null,
        failures = json.optJSONArray("failures")?.let { arr ->
            (0 until arr.length()).map { i ->
                val f = arr.getJSONObject(i)
                OpmlImportFailure(
                    feedUrl = f.optString("feedUrl", ""),
                    reason = f.optStringOrNull("reason"),
                )
            }
        } ?: emptyList(),
    )
