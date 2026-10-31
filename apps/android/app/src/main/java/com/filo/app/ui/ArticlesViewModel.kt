package com.filo.app.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.filo.app.api.ApiClient
import com.filo.app.api.ArticleListFilters
import com.filo.app.api.ArticleListItem
import com.filo.app.api.ErrorMessages
import com.filo.app.api.Subscription
import com.filo.app.api.Tag
import com.filo.app.api.UnreadCounts
import com.filo.app.LanguagePreference
import com.filo.app.FiloApplication
import kotlinx.coroutines.launch
import kotlinx.coroutines.ensureActive

class ArticlesViewModel : ViewModel() {
    var articles by mutableStateOf<List<ArticleListItem>>(emptyList())
    var hasNewArticles by mutableStateOf(false)
    private var newArticleBaseline by mutableStateOf<Pair<ArticleListFilters, Int>?>(null)
    // "Mark all as read" covers what this list has loaded, never what arrived after.
    val markAllUpToArticleId: Int? get() = newArticleBaseline?.takeIf { it.first == filters() }?.second
    var nextCursor by mutableStateOf<String?>(null)
    var tags by mutableStateOf<List<Tag>>(emptyList())
    var subscriptions by mutableStateOf<List<Subscription>>(emptyList())
    var unreadCounts by mutableStateOf(UnreadCounts(allArticles = 0, readingList = 0))
    var isLoading by mutableStateOf(true)
    var isLoadingMore by mutableStateOf(false)
    var errorMessage by mutableStateOf<AppText?>(null)
    var openInBrowserByDefault by mutableStateOf(false)
    var theme by mutableStateOf<String?>(null)
    var language by mutableStateOf("ja")
    var readableLanguages by mutableStateOf(listOf("ja"))
    var isRefreshingFeeds by mutableStateOf(false)
    var refreshNotice by mutableStateOf<AppText?>(null)
    var isMarkingAllRead by mutableStateOf(false)
    var markAllReadNotice by mutableStateOf<AppText?>(null)

    var selectedTagId by mutableStateOf<Int?>(null)
    var readFilter by mutableStateOf<Boolean?>(null)
    private var selectedSort: String? = null
    private var sortValue by mutableStateOf("published_at_desc")
    var sort: String
        get() = sortValue
        set(value) {
            selectedSort = value
            sortValue = value
        }
    var readOrder by mutableStateOf("unread_first")
    var readingListOnly by mutableStateOf(false)
    var bookmarkedOnly by mutableStateOf(false)

    var savedListFirstVisibleItemIndex = 0
        private set
    var savedListFirstVisibleItemScrollOffset = 0
        private set
    private var savedListPositionFilterKey: String? = null

    private var lastLoadedFilters = ""
    private var articleGeneration = 0L
    private val pendingArticles = mutableSetOf<Int>()

    private fun filters() = ArticleListFilters(
        tagId = selectedTagId,
        read = readFilter,
        readingList = if (readingListOnly) true else null,
        bookmarked = if (bookmarkedOnly) true else null,
        sort = sort,
        readOrder = readOrder,
    )

    private fun listPositionFilterKey() =
        "${selectedTagId}|${readFilter}|${readingListOnly}|${bookmarkedOnly}|${sort}|${readOrder}"

    fun saveListPosition(index: Int, offset: Int) {
        savedListFirstVisibleItemIndex = index
        savedListFirstVisibleItemScrollOffset = offset
        savedListPositionFilterKey = listPositionFilterKey()
    }

    fun listPositionForCurrentFilter(): Pair<Int, Int> {
        return if (savedListPositionFilterKey == listPositionFilterKey()) {
            savedListFirstVisibleItemIndex to savedListFirstVisibleItemScrollOffset
        } else {
            0 to 0
        }
    }

    fun loadIfNeeded() {
        val current = "${selectedTagId}|${readFilter}|${readingListOnly}|${bookmarkedOnly}|${sort}|${readOrder}"
        if (lastLoadedFilters == current) return
        if (lastLoadedFilters.isNotEmpty() && savedListPositionFilterKey != current) {
            saveListPosition(0, 0)
            savedListPositionFilterKey = null
        }
        lastLoadedFilters = current
        viewModelScope.launch { reload() }
    }

    // Screens above this one change settings, tags and subscriptions, and
    // articles read there change the counts. Bring the shell back in step.
    suspend fun refreshAppData() {
        val bootstrap = runCatching { ApiClient.getBootstrap() }.getOrNull() ?: return
        applyBootstrap(bootstrap)
    }

    private fun applyBootstrap(bootstrap: com.filo.app.api.BootstrapData) {
        tags = bootstrap.tags
        subscriptions = bootstrap.subscriptions
        unreadCounts = bootstrap.unreadCounts
        openInBrowserByDefault = bootstrap.settings.openInBrowserByDefault
        theme = bootstrap.settings.theme
        language = bootstrap.settings.language
        LanguagePreference.set(FiloApplication.context, bootstrap.settings.language)
        readableLanguages = bootstrap.settings.readableLanguages
        // The server setting is the default; an explicit list selection
        // remains in effect when refreshing or changing other filters.
        sortValue = selectedSort ?: bootstrap.settings.articleSortOrder
    }

    suspend fun reload() {
        val requestGeneration = ++articleGeneration
        if (newArticleBaseline?.first != filters()) hasNewArticles = false
        var requestFilters = filters()
        isLoading = true
        isLoadingMore = false
        nextCursor = null
        errorMessage = null
        try {
            val bootstrap = runCatching { ApiClient.getBootstrap() }.getOrNull()
            if (requestGeneration != articleGeneration || requestFilters != filters()) return
            if (bootstrap != null) applyBootstrap(bootstrap)
            requestFilters = filters()
            lastLoadedFilters = listPositionFilterKey()
            val page = ApiClient.listArticles(requestFilters)
            if (requestGeneration != articleGeneration || requestFilters != filters()) return
            newArticleBaseline = page.latestArticleId?.let { requestFilters to it }
            hasNewArticles = false
            articles = page.articles
            nextCursor = page.nextCursor
        } catch (e: Exception) {
            if (requestGeneration == articleGeneration && requestFilters == filters()) {
                errorMessage = ErrorMessages.forErrorText(e)
            }
        } finally {
            if (requestGeneration == articleGeneration) isLoading = false
        }
    }

    suspend fun checkForNewArticles() {
        val baseline = newArticleBaseline ?: return
        if (isLoading || isRefreshingFeeds || isMarkingAllRead || baseline.first != filters()) return
        val requestGeneration = articleGeneration
        try {
            val page = ApiClient.listArticles(baseline.first, checkNew = true, afterId = baseline.second)
            kotlinx.coroutines.currentCoroutineContext().ensureActive()
            if (requestGeneration == articleGeneration && baseline.first == filters()) {
                hasNewArticles = (page.latestArticleId ?: 0) > baseline.second
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            // Background checks never replace the list with a network error.
        }
    }

    fun loadMore() {
        val cursor = nextCursor ?: return
        if (isLoadingMore) return
        val requestGeneration = articleGeneration
        val requestFilters = filters()
        isLoadingMore = true
        viewModelScope.launch {
            try {
                val page = ApiClient.listArticles(requestFilters, cursor = cursor)
                if (requestGeneration == articleGeneration && requestFilters == filters()) {
                    articles = articles + page.articles
                    nextCursor = page.nextCursor
                }
            } catch (e: Exception) {
                if (requestGeneration == articleGeneration && requestFilters == filters()) {
                    errorMessage = ErrorMessages.forErrorText(e)
                }
            } finally {
                if (requestGeneration == articleGeneration) isLoadingMore = false
            }
        }
    }

    // Wait for queued feed fetches before reloading the visible articles.
    suspend fun refreshFeedsAndReload(feedId: Int? = null) {
        if (isRefreshingFeeds) return
        com.filo.app.Analytics.track(
            "refresh_feeds",
            mapOf("scope" to if (feedId == null) "all" else "feed"),
        )
        isRefreshingFeeds = true
        refreshNotice = null
        try {
            val result = if (feedId != null) ApiClient.refreshFeed(feedId, waitForCompletion = true)
                else ApiClient.refreshFeeds(force = false, waitForCompletion = true)
            refreshNotice = result.notice
        } catch (e: Exception) {
            refreshNotice = ErrorMessages.forErrorText(e)
        }
        reload()
        isRefreshingFeeds = false
    }

    // 表示中スコープ(全購読 or 選択タグ配下)の既読カーソルを一括前進させる
    suspend fun markAllRead(): Boolean {
        val upToArticleId = markAllUpToArticleId
        if (isMarkingAllRead || upToArticleId == null) return false
        isMarkingAllRead = true
        markAllReadNotice = null
        errorMessage = null
        com.filo.app.Analytics.track("mark_all_articles_read")
        val previousArticles = articles
        val requestFilters = filters()
        // Show the result at once; the reload below brings the server's order.
        articles = if (readFilter == false) {
            emptyList()
        } else {
            articles.map { if (it.userState.isRead) it else it.copy(userState = it.userState.copy(isRead = true)) }
        }
        try {
            ApiClient.markAllArticlesRead(upToArticleId, selectedTagId)
            reload()
            markAllReadNotice = AppText("既読への変更が完了しました。")
            return true
        } catch (e: Exception) {
            if (requestFilters == filters()) {
                articles = restoringArticleReadStates(articles, previousArticles, restoreHidden = requestFilters.read == false)
                errorMessage = ErrorMessages.forErrorText(e)
            }
            return false
        } finally {
            isMarkingAllRead = false
        }
    }

    fun clearMarkAllReadNotice() {
        markAllReadNotice = null
    }

    suspend fun removeReadArticlesFromReadingList() {
        com.filo.app.Analytics.track("remove_read_articles_from_reading_list")
        try {
            val removed = ApiClient.removeReadArticlesFromReadingList()
            reload()
            markAllReadNotice = if (removed > 0) {
                AppText("%d件の既読記事を削除しました。", listOf(removed))
            } else {
                AppText("削除できる既読記事はありません。")
            }
        } catch (e: Exception) {
            errorMessage = ErrorMessages.forErrorText(e)
        }
    }

    // Apply the change before the request so the row answers the tap at once;
    // the response then confirms it, and a failure puts the old state back.
    fun patchState(article: ArticleListItem, isRead: Boolean? = null, inReadingList: Boolean? = null, isBookmarked: Boolean? = null) {
        if (isRead == null && inReadingList == null && isBookmarked == null) return
        if (!pendingArticles.add(article.id)) return
        val originalIndex = articles.indexOfFirst { it.id == article.id }
        if (originalIndex < 0) { pendingArticles.remove(article.id); return }
        val requestFilters = filters()
        val before = article.userState
        val optimistic = before.copy(
            isRead = isRead ?: before.isRead,
            inReadingList = inReadingList ?: before.inReadingList,
            isBookmarked = isBookmarked ?: before.isBookmarked,
        )
        com.filo.app.Analytics.track(
            when {
                isRead != null -> if (isRead) "mark_article_read" else "mark_article_unread"
                inReadingList != null -> if (inReadingList) "add_to_reading_list" else "remove_from_reading_list"
                else -> if (isBookmarked == true) "add_to_wishlist" else "remove_from_wishlist"
            },
            mapOf("article_id" to article.id),
        )
        applyState(article.id, optimistic)
        applyUnreadDelta(before = before, after = optimistic, subscriptionIds = article.subscriptionIds)
        viewModelScope.launch {
            try {
                val state = when {
                    isRead != null -> ApiClient.setArticleRead(article.id, isRead)
                    inReadingList != null -> ApiClient.setReadingListMembership(article.id, inReadingList)
                    else -> ApiClient.setBookmarkMembership(article.id, isBookmarked == true)
                }
                if (requestFilters == filters()) applyState(article.id, state)
                applyUnreadDelta(before = optimistic, after = state, subscriptionIds = article.subscriptionIds)
            } catch (e: Exception) {
                if (requestFilters == filters()) {
                    articles = if (articles.any { it.id == article.id }) {
                        articles.map { if (it.id == article.id) it.copy(userState = before) else it }
                    } else {
                        articles.toMutableList().apply { add(originalIndex.coerceAtMost(size), article) }
                    }
                    errorMessage = ErrorMessages.forErrorText(e)
                }
                applyUnreadDelta(before = optimistic, after = before, subscriptionIds = article.subscriptionIds)
            } finally {
                pendingArticles.remove(article.id)
            }
        }
    }

    private fun applyState(articleId: Int, state: com.filo.app.api.ArticleUserState) {
        articles = articles.mapNotNull {
            if (it.id != articleId) it
            else if (
                (readFilter != null && state.isRead != readFilter) ||
                (readingListOnly && !state.inReadingList) ||
                (bookmarkedOnly && !state.isBookmarked)
            ) null
            else it.copy(userState = state)
        }
    }

    private fun applyUnreadDelta(
        before: com.filo.app.api.ArticleUserState,
        after: com.filo.app.api.ArticleUserState,
        subscriptionIds: List<Int>,
    ) {
        val beforeUnread = if (!before.isRead) 1 else 0
        val afterUnread = if (!after.isRead) 1 else 0
        val beforeReadingListUnread = if (!before.isRead && before.inReadingList) 1 else 0
        val afterReadingListUnread = if (!after.isRead && after.inReadingList) 1 else 0
        val allDelta = if (subscriptionIds.isNotEmpty()) afterUnread - beforeUnread else 0
        val readingListDelta = afterReadingListUnread - beforeReadingListUnread
        unreadCounts = unreadCounts.copy(
            allArticles = maxOf(0, unreadCounts.allArticles + allDelta),
            readingList = maxOf(0, unreadCounts.readingList + readingListDelta),
        )
        if (allDelta == 0) return
        // The sidebar's feed and tag counts follow the same read state.
        subscriptions = subscriptions.map {
            if (it.id in subscriptionIds) it.copy(unreadCount = maxOf(0, it.unreadCount + allDelta)) else it
        }
    }

    suspend fun refreshUnreadCounts() {
        runCatching { ApiClient.getUnreadCounts() }.getOrNull()?.let { unreadCounts = it }
    }
}
