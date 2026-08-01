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
import kotlinx.coroutines.launch

class ArticlesViewModel : ViewModel() {
    var articles by mutableStateOf<List<ArticleListItem>>(emptyList())
    var nextCursor by mutableStateOf<String?>(null)
    var tags by mutableStateOf<List<Tag>>(emptyList())
    var subscriptions by mutableStateOf<List<Subscription>>(emptyList())
    var isLoading by mutableStateOf(true)
    var isLoadingMore by mutableStateOf(false)
    var errorMessage by mutableStateOf<String?>(null)
    var openInBrowserByDefault by mutableStateOf(false)
    var theme by mutableStateOf<String?>(null)
    var language by mutableStateOf("ja")
    var readableLanguages by mutableStateOf(listOf("ja"))
    var isRefreshingFeeds by mutableStateOf(false)
    var refreshNotice by mutableStateOf<String?>(null)

    var selectedTagId by mutableStateOf<Int?>(null)
    var readFilter by mutableStateOf<Boolean?>(null)
    var readingListOnly by mutableStateOf(false)
    var bookmarkedOnly by mutableStateOf(false)

    private var lastLoadedFilters = ""
    private var articleGeneration = 0L

    private fun filters() = ArticleListFilters(
        tagId = selectedTagId,
        read = readFilter,
        readingList = if (readingListOnly) true else null,
        bookmarked = if (bookmarkedOnly) true else null,
    )

    fun resetLoadState() {
        lastLoadedFilters = ""
    }

    fun loadIfNeeded() {
        val current = "${selectedTagId}|${readFilter}|${readingListOnly}|${bookmarkedOnly}"
        if (lastLoadedFilters == current) return
        lastLoadedFilters = current
        viewModelScope.launch { reload() }
    }

    suspend fun reload() {
        val requestGeneration = ++articleGeneration
        val requestFilters = filters()
        isLoading = true
        isLoadingMore = false
        nextCursor = null
        errorMessage = null
        try {
            val page = ApiClient.listArticles(requestFilters)
            if (requestGeneration != articleGeneration || requestFilters != filters()) return
            articles = page.articles
            nextCursor = page.nextCursor
            runCatching { ApiClient.listTags() }.getOrNull()?.let {
                if (requestGeneration == articleGeneration) tags = it
            }
            runCatching { ApiClient.listSubscriptions() }.getOrNull()?.let {
                if (requestGeneration == articleGeneration) subscriptions = it
            }
            runCatching {
                ApiClient.getSettings()
            }.getOrNull()?.let { settings ->
                if (requestGeneration == articleGeneration) {
                    openInBrowserByDefault = settings.openInBrowserByDefault
                    theme = settings.theme
                    language = settings.language
                    readableLanguages = settings.readableLanguages
                }
            }
        } catch (e: Exception) {
            if (requestGeneration == articleGeneration && requestFilters == filters()) {
                errorMessage = ErrorMessages.forError(e)
            }
        } finally {
            if (requestGeneration == articleGeneration) isLoading = false
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
                    errorMessage = ErrorMessages.forError(e)
                }
            } finally {
                if (requestGeneration == articleGeneration) isLoadingMore = false
            }
        }
    }

    // Manual refresh: enqueue feed fetches, wait for the queued fetches to land
    // by polling /status, then reload the visible list.
    suspend fun refreshFeedsAndReload(feedId: Int? = null) {
        if (isRefreshingFeeds) return
        isRefreshingFeeds = true
        refreshNotice = null
        try {
            val result = if (feedId != null) ApiClient.refreshFeed(feedId) else ApiClient.refreshFeeds(force = false)
            if (result.enqueued == 0 && result.skipped > 0) {
                refreshNotice = "最近取得済みのため、今回の取得対象はありませんでした。"
            } else if (result.enqueued > 0) {
                val done = awaitRefreshCompletion(result.queuedAt, feedId)
                if (!done) refreshNotice = "取得に時間がかかっています。あとで再度更新してください。"
            }
        } catch (e: Exception) {
            refreshNotice = ErrorMessages.forError(e)
        }
        reload()
        isRefreshingFeeds = false
    }

    // 表示中スコープ(全購読 or 選択タグ配下)の既読カーソルを一括前進させる
    suspend fun markAllRead() {
        try {
            ApiClient.markAllArticlesRead(selectedTagId)
            reload()
        } catch (e: Exception) {
            errorMessage = ErrorMessages.forError(e)
        }
    }

    suspend fun removeReadArticlesFromReadingList() {
        try {
            ApiClient.removeReadArticlesFromReadingList()
            reload()
        } catch (e: Exception) {
            errorMessage = ErrorMessages.forError(e)
        }
    }

    fun patchState(article: ArticleListItem, isRead: Boolean? = null, inReadingList: Boolean? = null, isBookmarked: Boolean? = null) {
        viewModelScope.launch {
            try {
                val state = when {
                    isRead != null -> ApiClient.setArticleRead(article.id, isRead)
                    inReadingList != null -> ApiClient.setReadingListMembership(article.id, inReadingList)
                    isBookmarked != null -> ApiClient.setBookmarkMembership(article.id, isBookmarked)
                    else -> return@launch
                }
                articles = articles.mapNotNull {
                    if (it.id != article.id) it
                    else if (
                        (readFilter != null && state.isRead != readFilter) ||
                        (readingListOnly && !state.inReadingList) ||
                        (bookmarkedOnly && !state.isBookmarked)
                    ) null
                    else it.copy(userState = state)
                }
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forError(e)
            }
        }
    }
}
