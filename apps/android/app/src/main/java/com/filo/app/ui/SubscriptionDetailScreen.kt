package com.filo.app.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.filo.app.api.ApiClient
import com.filo.app.api.ApiException
import com.filo.app.api.ArticleListFilters
import com.filo.app.api.ArticleListItem
import com.filo.app.api.ErrorMessages
import com.filo.app.api.Subscription
import com.filo.app.api.Tag
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicLong

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SubscriptionDetailScreen(
    subscriptionId: Int,
    translations: TitleTranslationStore,
    onBack: () -> Unit,
    onOpenArticle: (ArticleListItem) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var subscription by remember { mutableStateOf<Subscription?>(null) }
    var isRefreshingFeed by remember { mutableStateOf(false) }
    var refreshNotice by remember { mutableStateOf<String?>(null) }
    var allTags by remember { mutableStateOf<List<Tag>>(emptyList()) }
    var articles by remember { mutableStateOf<List<ArticleListItem>>(emptyList()) }
    var nextCursor by remember { mutableStateOf<String?>(null) }
    var isLoadingMore by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(true) }
    var isGone by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    var sort by remember { mutableStateOf("published_at_desc") }
    var readFilter by remember { mutableStateOf<Boolean?>(null) }

    var showRename by remember { mutableStateOf(false) }
    var renameText by remember { mutableStateOf("") }
    var showUnsubscribe by remember { mutableStateOf(false) }
    var showMarkAllRead by remember { mutableStateOf(false) }
    var showFeedUrl by remember { mutableStateOf(false) }
    val articleGeneration = remember(subscriptionId) { AtomicLong(0L) }

    fun filters() = ArticleListFilters(
        subscriptionId = subscriptionId,
        read = readFilter,
        sort = sort,
    )

    suspend fun reloadArticles() {
        val requestGeneration = articleGeneration.incrementAndGet()
        val requestFilters = filters()
        isLoadingMore = false
        nextCursor = null
        try {
            val page = ApiClient.listArticles(requestFilters)
            if (requestGeneration == articleGeneration.get() && requestFilters == filters()) {
                articles = page.articles
                nextCursor = page.nextCursor
            }
        } catch (e: Exception) {
            if (requestGeneration == articleGeneration.get() && requestFilters == filters()) {
                errorMessage = ErrorMessages.forError(e)
            }
        }
    }

    fun loadMore() {
        val cursor = nextCursor ?: return
        if (isLoadingMore) return
        val requestGeneration = articleGeneration.get()
        val requestFilters = filters()
        isLoadingMore = true
        scope.launch {
            try {
                val page = ApiClient.listArticles(requestFilters, cursor = cursor)
                if (requestGeneration == articleGeneration.get() && requestFilters == filters()) {
                    articles = articles + page.articles
                    nextCursor = page.nextCursor
                }
            } catch (e: Exception) {
                if (requestGeneration == articleGeneration.get() && requestFilters == filters()) {
                    errorMessage = ErrorMessages.forError(e)
                }
            } finally {
                if (requestGeneration == articleGeneration.get()) isLoadingMore = false
            }
        }
    }

    fun patchState(
        article: ArticleListItem,
        isRead: Boolean? = null,
        inReadingList: Boolean? = null,
        isBookmarked: Boolean? = null,
    ) {
        scope.launch {
            try {
                val state = when {
                    isRead != null -> ApiClient.setArticleRead(article.id, isRead)
                    inReadingList != null -> ApiClient.setReadingListMembership(article.id, inReadingList)
                    isBookmarked != null -> ApiClient.setBookmarkMembership(article.id, isBookmarked)
                    else -> return@launch
                }
                articles = articles.mapNotNull {
                    if (it.id != article.id) it
                    else if (readFilter != null && state.isRead != readFilter) null
                    else it.copy(userState = state)
                }
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forError(e)
            }
        }
    }

    suspend fun reload() {
        isLoading = true
        errorMessage = null
        try {
            subscription = ApiClient.getSubscription(subscriptionId)
            runCatching { allTags = ApiClient.listTags() }
            // 初期並び順は current user の articleSortOrder に従う
            runCatching { sort = ApiClient.getSettings().articleSortOrder }
            reloadArticles()
        } catch (e: ApiException) {
            if (e.status == 404) isGone = true else errorMessage = ErrorMessages.forError(e)
        } catch (e: Exception) {
            errorMessage = ErrorMessages.forError(e)
        }
        isLoading = false
    }

    LaunchedEffect(Unit) { reload() }
    // 翻訳トグルが ON の間は、表示された記事を翻訳対象にする
    LaunchedEffect(articles, translations.isEnabled, translations.languages) { translations.register(articles) }
    LaunchedEffect(sort, readFilter) {
        if (!isLoading) reloadArticles()
    }

    // Manual per-feed refresh: enqueue the fetch, poll /status until it lands, reload.
    suspend fun refreshFeed() {
        val feedId = subscription?.feed?.id ?: return
        if (isRefreshingFeed) return
        isRefreshingFeed = true
        refreshNotice = null
        try {
            val result = ApiClient.refreshFeed(feedId)
            if (parseInstant(result.queuedAt) != null) {
                val done = awaitRefreshCompletion(result.queuedAt, feedId)
                if (!done) refreshNotice = "取得に時間がかかっています。あとで再度更新してください。"
            }
            reloadArticles()
        } catch (e: Exception) {
            refreshNotice = ErrorMessages.forError(e)
        }
        isRefreshingFeed = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(subscription?.displayTitle ?: "購読詳細") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "戻る")
                    }
                },
                actions = {
                    TitleTranslationToggle(translations)
                    IconButton(
                        enabled = !isRefreshingFeed,
                        onClick = { scope.launch { refreshFeed() } },
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "フィードを更新")
                    }
                },
            )
        },
    ) { innerPadding ->
        if (isGone) {
            Column(
                modifier = Modifier.fillMaxSize().padding(innerPadding).padding(40.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("この購読は削除されたか、表示できません。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = onBack) { Text("購読一覧へ戻る") }
            }
            return@Scaffold
        }
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            subscription?.let { sub ->
                item {
                    Column(modifier = Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            SubscriptionHealthBadge(sub)
                            if (sub.initialFetchStatus == "failed") {
                                TextButton(onClick = {
                                    scope.launch {
                                        try {
                                            subscription = ApiClient.retryInitialFetch(subscriptionId)
                                        } catch (e: Exception) {
                                            errorMessage = ErrorMessages.forError(e)
                                        }
                                    }
                                }) { Text("再試行") }
                            }
                        }
                        if (allTags.isNotEmpty()) {
                            Row(
                                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                allTags.forEach { tag ->
                                    FilterChipButton(tag.name, sub.tagIds.contains(tag.id)) {
                                        scope.launch {
                                            val next = if (sub.tagIds.contains(tag.id)) {
                                                sub.tagIds - tag.id
                                            } else {
                                                sub.tagIds + tag.id
                                            }
                                            try {
                                                subscription = ApiClient.setSubscriptionTags(subscriptionId, next)
                                            } catch (e: Exception) {
                                                errorMessage = ErrorMessages.forError(e)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            OutlinedButton(onClick = { showMarkAllRead = true }) { Text("すべて既読にする") }
                            OutlinedButton(onClick = {
                                renameText = sub.customTitle ?: ""
                                showRename = true
                            }) { Text("名前を変更") }
                            sub.feed.siteUrl?.let { siteUrl ->
                                OutlinedButton(onClick = {
                                    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, siteUrl.toUri())) }
                                }) { Text("サイトを開く") }
                            }
                            if (sub.feed.feedUrl != null) {
                                OutlinedButton(onClick = { showFeedUrl = true }) { Text("フィードURLを表示") }
                            }
                            OutlinedButton(onClick = { showUnsubscribe = true }) {
                                Text("購読解除", color = MaterialTheme.colorScheme.error)
                            }
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                "既読状態",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            FilterChipButton("すべて", readFilter == null) { readFilter = null }
                            FilterChipButton("未読のみ", readFilter == false) { readFilter = false }
                            FilterChipButton("既読のみ", readFilter == true) { readFilter = true }
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                "並び順",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            FilterChipButton("公開日時が新しい順", sort == "published_at_desc") { sort = "published_at_desc" }
                            FilterChipButton("取得日時が新しい順", sort == "fetched_at_desc") { sort = "fetched_at_desc" }
                        }
                    }
                }
            }
            if (isRefreshingFeed) {
                item {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(modifier = Modifier.height(16.dp).width(16.dp))
                        Text("フィードを更新しています…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            refreshNotice?.let { notice ->
                item {
                    Text(notice, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            errorMessage?.let { message ->
                item { ErrorBanner(message) { scope.launch { reload() } } }
            }
            if (isLoading) {
                item {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(40.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) { CircularProgressIndicator() }
                }
            } else if (articles.isEmpty()) {
                item {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 40.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        if (readFilter == null && subscription?.initialFetchStatus == "fetching") {
                            CircularProgressIndicator()
                            Text("記事を取得しています…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else {
                            Text("表示できる記事がありません。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                } else {
                    items(articles, key = { it.id }) { article ->
                    ArticleRow(
                        article = article,
                        translations = translations,
                        onOpen = { onOpenArticle(article) },
                        onToggleRead = { patchState(article, isRead = !article.userState.isRead) },
                        onToggleReadingList = {
                            patchState(article, inReadingList = !article.userState.inReadingList)
                        },
                        onToggleBookmark = { patchState(article, isBookmarked = !article.userState.isBookmarked) },
                    )
                    HorizontalDivider()
                }
                if (nextCursor != null) {
                    item {
                        TextButton(
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !isLoadingMore,
                            onClick = ::loadMore,
                        ) { Text(if (isLoadingMore) "読み込み中…" else "さらに読み込む") }
                    }
                }
            }
        }
    }

    if (showRename) {
        AlertDialog(
            onDismissRequest = { showRename = false },
            title = { Text("購読名を変更") },
            text = {
                OutlinedTextField(
                    value = renameText,
                    onValueChange = { renameText = it },
                    label = { Text("空欄でフィード名に戻す") },
                    singleLine = true,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        try {
                            subscription = ApiClient.updateSubscription(subscriptionId, renameText.trim().ifEmpty { null })
                        } catch (e: Exception) {
                            errorMessage = ErrorMessages.forError(e)
                        }
                    }
                    showRename = false
                }) { Text("変更") }
            },
            dismissButton = { TextButton(onClick = { showRename = false }) { Text("キャンセル") } },
        )
    }


    if (showMarkAllRead) {
        AlertDialog(
            onDismissRequest = { showMarkAllRead = false },
            title = { Text("このフィードの記事をすべて既読にしますか？") },
            confirmButton = {
                TextButton(onClick = {
                    showMarkAllRead = false
                    scope.launch {
                        try {
                            val result = ApiClient.markAllRead(subscriptionId)
                            subscription = subscription?.copy(unreadCount = result.unreadCount)
                            reloadArticles()
                        } catch (e: Exception) {
                            errorMessage = ErrorMessages.forError(e)
                        }
                    }
                }) { Text("すべて既読にする") }
            },
            dismissButton = { TextButton(onClick = { showMarkAllRead = false }) { Text("キャンセル") } },
        )
    }

    if (showFeedUrl) {
        val feedUrl = subscription?.feed?.feedUrl ?: ""
        AlertDialog(
            onDismissRequest = { showFeedUrl = false },
            title = { Text("フィードURL") },
            text = { Text(feedUrl) },
            confirmButton = {
                TextButton(onClick = {
                    context.getSystemService(ClipboardManager::class.java)
                        ?.setPrimaryClip(ClipData.newPlainText("フィードURL", feedUrl))
                    showFeedUrl = false
                }) { Text("コピー") }
            },
            dismissButton = { TextButton(onClick = { showFeedUrl = false }) { Text("閉じる") } },
        )
    }

    if (showUnsubscribe) {
        AlertDialog(
            onDismissRequest = { showUnsubscribe = false },
            title = { Text("この購読を解除しますか？") },
                            text = { Text("ブックマークした記事は残ります。") },
            confirmButton = {
                TextButton(onClick = {
                    showUnsubscribe = false
                    scope.launch {
                        try {
                            ApiClient.deleteSubscription(subscriptionId)
                            onBack()
                        } catch (e: Exception) {
                            errorMessage = ErrorMessages.forError(e)
                        }
                    }
                }) { Text("購読解除", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { showUnsubscribe = false }) { Text("キャンセル") } },
        )
    }
}
