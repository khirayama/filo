package com.filo.app.api

import org.json.JSONArray
import org.json.JSONObject

data class FeedSummary(
    val id: Int,
    val title: String,
    val siteUrl: String?,
    val feedUrl: String?,
    val faviconUrl: String?,
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
    val translatedTitle: String?,
    val titleTranslationPending: Boolean,
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

data class ArticleDetail(
    val id: Int,
    val title: String,
    val translatedTitle: String?,
    val titleTranslationPending: Boolean,
    val sourceLanguage: String?,
    val canonicalUrl: String?,
    val author: String?,
    val rssSummary: String?,
    val rssContentHtml: String?,
    val publishedAt: String?,
    val fetchedAt: String,
    val feedTitle: String?,
    val feedFaviconUrl: String?,
    val feedSiteUrl: String?,
    val subscriptionIds: List<Int>,
    val userState: ArticleUserState,
)

data class ArticleContent(
    val status: String,
    val sourceLanguage: String?,
    val text: String?,
    val html: String?,
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

// Translation progress is derived from stored translation rows, not from job
// records: every (article, target language) pair is missing, pending, ready,
// or failed, so the numbers always match reality.
data class TranslationCoverage(
    val articles: Int,
    val untranslatable: Int,
    val needed: Int,
    val ready: Int,
    val failed: Int,
    // queued (順番待ち) + processing (翻訳中 / LLM応答待ち) = pending.
    val queued: Int,
    val processing: Int,
    val pending: Int,
    val missing: Int,
    val lastError: String?,
)

data class TranslatingTitle(val title: String, val languages: List<String>)

data class StatusSubscription(
    val subscriptionId: Int,
    val feedTitle: String,
    val feedId: Int,
    val feedStatus: String,
    val lastResult: String?,
    val lastError: String?,
    val lastFetchedAt: String?,
    val consecutiveFailures: Int,
    val translation: TranslationCoverage,
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
    val translatorPending: Int,
    val translatorCurrent: List<TranslatingTitle>,
    val subscriptionStatuses: List<StatusSubscription>,
)

data class RefreshResult(val accepted: Boolean, val enqueued: Int, val skipped: Int, val queuedAt: String)

// enqueued counts (article, language) pairs queued for translation
data class TranslateResult(val accepted: Boolean, val enqueued: Int, val queuedAt: String)

// removed counts queued/in-flight/failed pairs deleted from the queue
data class DiscardResult(val accepted: Boolean, val removed: Int, val discardedAt: String)

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
        translatedTitle = json.optStringOrNull("translatedTitle"),
        titleTranslationPending = json.optBoolean("titleTranslationPending", false),
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

private fun parseTranslationCoverage(json: JSONObject?): TranslationCoverage =
    TranslationCoverage(
        articles = json?.optInt("articles", 0) ?: 0,
        untranslatable = json?.optInt("untranslatable", 0) ?: 0,
        needed = json?.optInt("needed", 0) ?: 0,
        ready = json?.optInt("ready", 0) ?: 0,
        failed = json?.optInt("failed", 0) ?: 0,
        queued = json?.optInt("queued", 0) ?: 0,
        processing = json?.optInt("processing", 0) ?: 0,
        pending = json?.optInt("pending", 0) ?: 0,
        missing = json?.optInt("missing", 0) ?: 0,
        lastError = json?.optStringOrNull("lastError"),
    )

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
            translation = parseTranslationCoverage(s.optJSONObject("translation")),
            fetchJob = parseFeedJob(s.optJSONObject("fetchJob")),
        )
    }
    val translatorJson = json.optJSONObject("translator")
    val currentArr = translatorJson?.optJSONArray("current") ?: JSONArray()
    val current = (0 until currentArr.length()).map { i ->
        val c = currentArr.getJSONObject(i)
        val langsArr = c.optJSONArray("languages") ?: JSONArray()
        TranslatingTitle(
            title = c.optString("title", ""),
            languages = (0 until langsArr.length()).map { langsArr.getString(it) },
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
        translatorPending = translatorJson?.optInt("pending", 0) ?: 0,
        translatorCurrent = current,
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

internal fun parseTranslateResult(json: JSONObject): TranslateResult =
    TranslateResult(
        accepted = json.optBoolean("accepted", false),
        enqueued = json.optInt("enqueued", 0),
        queuedAt = json.optString("queuedAt", ""),
    )

internal fun parseDiscardResult(json: JSONObject): DiscardResult =
    DiscardResult(
        accepted = json.optBoolean("accepted", false),
        removed = json.optInt("removed", 0),
        discardedAt = json.optString("discardedAt", ""),
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

internal fun parseArticleDetail(json: JSONObject): ArticleDetail =
    ArticleDetail(
        id = json.getInt("id"),
        title = json.optString("title", ""),
        translatedTitle = json.optStringOrNull("translatedTitle"),
        titleTranslationPending = json.optBoolean("titleTranslationPending", false),
        sourceLanguage = json.optStringOrNull("sourceLanguage"),
        canonicalUrl = json.optStringOrNull("canonicalUrl"),
        author = json.optStringOrNull("author"),
        rssSummary = json.optStringOrNull("rssSummary"),
        rssContentHtml = json.optStringOrNull("rssContentHtml"),
        publishedAt = json.optStringOrNull("publishedAt"),
        fetchedAt = json.optString("fetchedAt", ""),
        feedTitle = json.optJSONObject("feed")?.optString("title"),
        feedFaviconUrl = json.optJSONObject("feed")?.optStringOrNull("faviconUrl"),
        feedSiteUrl = json.optJSONObject("feed")?.optStringOrNull("siteUrl"),
        subscriptionIds = json.optJSONObject("subscriptionContext")?.optJSONArray("subscriptionIds")?.toIntList()
            ?: emptyList(),
        userState = parseUserState(json.optJSONObject("userState")),
    )

internal fun parseArticleContent(json: JSONObject): ArticleContent =
    ArticleContent(
        status = json.optString("status", "not_requested"),
        sourceLanguage = json.optStringOrNull("sourceLanguage"),
        text = json.optStringOrNull("text"),
        html = json.optStringOrNull("html"),
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

data class PlaybackQueueEntry(
    val articleId: Int,
    val sortOrder: Int,
    val title: String,
    val canonicalUrl: String?,
    val sourceLanguage: String?,
    val feedTitle: String?,
)

data class PlaybackStateData(
    val currentArticleId: Int?,
    val contentLanguage: String?,
    val positionPercent: Double,
)

data class PlaybackQueueData(
    val items: List<PlaybackQueueEntry>,
    val playbackState: PlaybackStateData?,
)

data class ArticleLookup(
    val id: Int,
    val title: String,
    val canonicalUrl: String,
    val sourceLanguage: String?,
    val inQueue: Boolean,
)

internal fun parsePlaybackQueue(json: JSONObject): PlaybackQueueData {
    val itemsJson = json.optJSONArray("items") ?: JSONArray()
    val items = (0 until itemsJson.length()).map { index ->
        val item = itemsJson.getJSONObject(index)
        val article = item.getJSONObject("article")
        PlaybackQueueEntry(
            articleId = item.getInt("articleId"),
            sortOrder = item.optInt("sortOrder", index),
            // `title` is the original; `translatedTitle` is set only when the
            // server decided the user needs it.
            title = article.optStringOrNull("translatedTitle") ?: article.optString("title", ""),
            canonicalUrl = article.optStringOrNull("canonicalUrl"),
            sourceLanguage = article.optStringOrNull("sourceLanguage"),
            feedTitle = article.optJSONObject("feed")?.optString("title"),
        )
    }
    val state = json.optJSONObject("playbackState")?.let {
        PlaybackStateData(
            currentArticleId = if (it.isNull("currentArticleId")) null else it.optInt("currentArticleId"),
            contentLanguage = it.optStringOrNull("contentLanguage"),
            positionPercent = it.optDouble("positionPercent", 0.0),
        )
    }
    return PlaybackQueueData(items = items, playbackState = state)
}

internal fun parseArticleLookup(json: JSONObject): ArticleLookup =
    ArticleLookup(
        id = json.getInt("id"),
        title = json.optString("title", ""),
        canonicalUrl = json.optString("canonicalUrl", ""),
        sourceLanguage = json.optStringOrNull("sourceLanguage"),
        inQueue = json.optBoolean("inQueue", false),
    )
