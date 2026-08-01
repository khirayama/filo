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
    var bookmarkedOnly by mutableStateOf(false)

    private var lastLoadedFilters = ""

    private fun filters() = ArticleListFilters(
        tagId = selectedTagId,
        bookmarked = if (bookmarkedOnly) true else null,
    )

    fun resetLoadState() {
        lastLoadedFilters = ""
    }

    fun loadIfNeeded() {
        val current = "${selectedTagId}|${bookmarkedOnly}"
        if (lastLoadedFilters == current) return
        lastLoadedFilters = current
        viewModelScope.launch { reload() }
    }

    suspend fun reload() {
        isLoading = true
        errorMessage = null
        try {
            val page = ApiClient.listArticles(filters())
            articles = page.articles
            nextCursor = page.nextCursor
            runCatching { tags = ApiClient.listTags() }
            runCatching { subscriptions = ApiClient.listSubscriptions() }
            runCatching {
                val settings = ApiClient.getSettings()
                openInBrowserByDefault = settings.openInBrowserByDefault
                theme = settings.theme
                language = settings.language
                readableLanguages = settings.readableLanguages
            }
        } catch (e: Exception) {
            errorMessage = ErrorMessages.forError(e)
        }
        isLoading = false
    }

    fun loadMore() {
        val cursor = nextCursor ?: return
        if (isLoadingMore) return
        isLoadingMore = true
        viewModelScope.launch {
            try {
                val page = ApiClient.listArticles(filters(), cursor = cursor)
                articles = articles + page.articles
                nextCursor = page.nextCursor
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forError(e)
            }
            isLoadingMore = false
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

    fun patchState(article: ArticleListItem, isRead: Boolean? = null, isBookmarked: Boolean? = null) {
        viewModelScope.launch {
            try {
                val state = when {
                    isRead != null -> ApiClient.setArticleRead(article.id, isRead)
                    isBookmarked != null -> ApiClient.setBookmarkMembership(article.id, isBookmarked)
                    else -> return@launch
                }
                articles = articles.mapNotNull {
                    if (it.id != article.id) it
                    else if (
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
