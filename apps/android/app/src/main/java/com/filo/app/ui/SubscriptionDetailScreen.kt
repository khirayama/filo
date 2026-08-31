package com.filo.app.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.size
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
    var allTags by remember { mutableStateOf<List<Tag>>(emptyList()) }
    var articles by remember { mutableStateOf<List<ArticleListItem>>(emptyList()) }
    var nextCursor by remember { mutableStateOf<String?>(null) }
    var isLoadingMore by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(true) }
    var isGone by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var isRefreshingFeed by remember { mutableStateOf(false) }
    var refreshNotice by remember { mutableStateOf<String?>(null) }

    var sort by remember { mutableStateOf("published_at_desc") }
    var readFilter by remember { mutableStateOf<Boolean?>(null) }
    var readOrder by remember { mutableStateOf("unread_first") }
    var openInBrowserByDefault by remember { mutableStateOf(false) }

    var showRename by remember { mutableStateOf(false) }
    var renameText by remember { mutableStateOf("") }
    var showUnsubscribe by remember { mutableStateOf(false) }
    var showFeedUrl by remember { mutableStateOf(false) }
    var articleOptionsMenuOpen by remember { mutableStateOf(false) }
    var subscriptionActionsMenuOpen by remember { mutableStateOf(false) }
    val articleGeneration = remember(subscriptionId) { AtomicLong(0L) }

    fun filters() = ArticleListFilters(
        subscriptionId = subscriptionId,
        read = readFilter,
        sort = sort,
        readOrder = readOrder,
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

    fun markAllRead() {
        scope.launch {
            try {
                val result = ApiClient.markAllRead(subscriptionId)
                subscription = subscription?.copy(unreadCount = result.unreadCount)
                reloadArticles()
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forError(e)
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
            runCatching {
                ApiClient.getSettings().let { settings ->
                    sort = settings.articleSortOrder
                    openInBrowserByDefault = settings.openInBrowserByDefault
                }
            }
            reloadArticles()
        } catch (e: ApiException) {
            if (e.status == 404) isGone = true else errorMessage = ErrorMessages.forError(e)
        } catch (e: Exception) {
            errorMessage = ErrorMessages.forError(e)
        }
        isLoading = false
    }

    suspend fun refreshFeedAndReload() {
        val feedId = subscription?.feed?.id ?: return
        if (isRefreshingFeed) return
        isRefreshingFeed = true
        refreshNotice = null
        try {
            val result = ApiClient.refreshFeed(feedId)
            com.filo.app.Analytics.track(
                "refresh_feed",
                mapOf("feed_id" to feedId, "source" to "subscription_detail"),
            )
            val done = awaitRefreshCompletion(result.queuedAt, feedId)
            if (!done) {
                refreshNotice = AppStrings.get("取得に時間がかかっています。あとで再度更新してください。")
            }
        } catch (e: Exception) {
            refreshNotice = ErrorMessages.forError(e)
        }
        reloadArticles()
        isRefreshingFeed = false
    }

    LaunchedEffect(Unit) { reload() }
    // 翻訳トグルが ON の間は、表示された記事を翻訳対象にする
    LaunchedEffect(articles, translations.isEnabled, translations.languages) { translations.register(articles) }
    LaunchedEffect(sort, readFilter, readOrder) {
        if (!isLoading) reloadArticles()
    }

    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            subscription?.let { sub ->
                                FaviconImage(url = sub.feed.faviconUrl)
                                androidx.compose.foundation.layout.Spacer(modifier = Modifier.width(8.dp))
                            }
                            Text(
                                subscription?.displayTitle ?: tr("購読詳細"),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            FiloIcon(FiloIconName.Back, contentDescription = tr("戻る"))
                        }
                    },
                    actions = {
                        if (!isGone) {
                        IconButton(
                            enabled = !isRefreshingFeed,
                            onClick = { scope.launch { refreshFeedAndReload() } },
                        ) {
                            FiloIcon(FiloIconName.Refresh, contentDescription = tr("このフィードを更新"))
                        }
                        IconButton(onClick = { markAllRead() }) {
                            FiloIcon(FiloIconName.CheckCircle, contentDescription = tr("すべて既読にする"))
                        }
                        Box {
                            IconButton(onClick = { subscriptionActionsMenuOpen = true }) {
                                FiloIcon(FiloIconName.More, contentDescription = tr("購読の操作"))
                            }
                            DropdownMenu(
                                expanded = subscriptionActionsMenuOpen,
                                onDismissRequest = { subscriptionActionsMenuOpen = false },
                            ) {
                                DropdownMenuItem(
                                    text = { Text(tr("名前を変更")) },
                                    onClick = {
                                        subscriptionActionsMenuOpen = false
                                        renameText = subscription?.customTitle.orEmpty()
                                        showRename = true
                                    },
                                )
                                if (subscription?.feed?.siteUrl != null) {
                                    DropdownMenuItem(
                                        text = { Text(tr("サイトを開く")) },
                                        onClick = {
                                            subscriptionActionsMenuOpen = false
                                            runCatching {
                                                context.startActivity(Intent(Intent.ACTION_VIEW, subscription?.feed?.siteUrl!!.toUri()))
                                            }
                                        },
                                    )
                                }
                                if (subscription?.feed?.feedUrl != null) {
                                    DropdownMenuItem(
                                        text = { Text(tr("フィードURLを表示")) },
                                        onClick = {
                                            subscriptionActionsMenuOpen = false
                                            showFeedUrl = true
                                        },
                                    )
                                }
                                DropdownMenuItem(
                                    text = { Text(tr("購読解除"), color = MaterialTheme.colorScheme.error) },
                                    onClick = {
                                        subscriptionActionsMenuOpen = false
                                        showUnsubscribe = true
                                    },
                                )
                            }
                        }
                        Box {
                            IconButton(onClick = { articleOptionsMenuOpen = true }) {
                                FiloIcon(FiloIconName.Gear, contentDescription = tr("表示設定"))
                            }
                            DropdownMenu(expanded = articleOptionsMenuOpen, onDismissRequest = { articleOptionsMenuOpen = false }) {
                                if (translations.isSupported) {
                                    DropdownMenuItem(
                                        text = { Text(if (translations.isEnabled) tr("タイトルを翻訳（オン）") else tr("タイトルを翻訳（オフ）")) },
                                        onClick = { translations.toggle(); articleOptionsMenuOpen = false },
                                    )
                                }
                                DropdownMenuItem(enabled = false, text = { Text(tr("既読状態")) }, onClick = {})
                                DropdownMenuItem(text = { Text(tr("全ての記事")) }, onClick = { readFilter = null; articleOptionsMenuOpen = false })
                                DropdownMenuItem(text = { Text(tr("未読")) }, onClick = { readFilter = false; articleOptionsMenuOpen = false })
                                DropdownMenuItem(text = { Text(tr("既読")) }, onClick = { readFilter = true; articleOptionsMenuOpen = false })
                                DropdownMenuItem(enabled = false, text = { Text(tr("並び順")) }, onClick = {})
                                DropdownMenuItem(text = { Text(tr("公開日時が新しい順")) }, onClick = { sort = "published_at_desc"; articleOptionsMenuOpen = false })
                                DropdownMenuItem(text = { Text(tr("取得日時が新しい順")) }, onClick = { sort = "fetched_at_desc"; articleOptionsMenuOpen = false })
                                DropdownMenuItem(enabled = false, text = { Text(tr("既読の扱い")) }, onClick = {})
                                DropdownMenuItem(text = { Text(tr("既読で並び替えない")) }, onClick = { readOrder = "none"; articleOptionsMenuOpen = false })
                                DropdownMenuItem(text = { Text(tr("既読は下")) }, onClick = { readOrder = "unread_first"; articleOptionsMenuOpen = false })
                                DropdownMenuItem(text = { Text(tr("既読は上")) }, onClick = { readOrder = "read_first"; articleOptionsMenuOpen = false })
                            }
                        }
                        }
                    },
                )
            }
        },
    ) { innerPadding ->
        if (isGone) {
            Column(
                modifier = Modifier.fillMaxSize().padding(innerPadding).padding(40.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(tr("この購読は削除されたか、表示できません。"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = onBack) { Text(tr("購読一覧へ戻る")) }
            }
            return@Scaffold
        }
        PullToRefreshBox(
            isRefreshing = isRefreshingFeed,
            onRefresh = { scope.launch { refreshFeedAndReload() } },
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
        ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp),
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
                                            com.filo.app.Analytics.track("retry_feed_fetch", mapOf("subscription_id" to subscriptionId))
                                        } catch (e: Exception) {
                                            errorMessage = ErrorMessages.forError(e)
                                        }
                                    }
                                }) { Text(tr("再試行")) }
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
                    }
                }
            }
            errorMessage?.let { message ->
                item { ErrorBanner(message) { scope.launch { reload() } } }
            }
            refreshNotice?.let { notice ->
                item {
                    Text(
                        notice,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (isLoading) {
                item {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(40.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        CircularProgressIndicator()
                        Text(tr("購読記事を読み込んでいます…"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
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
                            Text(tr("記事を取得しています…"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else {
                            Text(tr("表示できる記事がありません。"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                } else {
                    itemsIndexed(articles, key = { _, article -> article.id }) { index, article ->
                    ArticleRow(
                        article = article,
                        translations = translations,
                        onOpen = {
                            val url = article.canonicalUrl
                            if (openInBrowserByDefault && url != null) {
                                context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
                            } else {
                                onOpenArticle(article)
                            }
                        },
                        onToggleRead = { patchState(article, isRead = !article.userState.isRead) },
                        onToggleReadingList = {
                            patchState(article, inReadingList = !article.userState.inReadingList)
                        },
                        onToggleBookmark = { patchState(article, isBookmarked = !article.userState.isBookmarked) },
                    )
                    HorizontalDivider()
                    if (index >= (articles.size - 4).coerceAtLeast(0) && nextCursor != null) {
                        LaunchedEffect(article.id) { loadMore() }
                    }
                }
                if (isLoadingMore) {
                    item {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                            horizontalArrangement = Arrangement.Center,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                            Text(tr("次の記事を読み込んでいます…"), modifier = Modifier.padding(start = 8.dp))
                        }
                    }
                }
            }
        }
        }
    }

    if (showRename) {
        AlertDialog(
            onDismissRequest = { showRename = false },
            title = { Text(tr("購読名を変更")) },
            text = {
                OutlinedTextField(
                    value = renameText,
                    onValueChange = { renameText = it },
                    label = { Text(tr("空欄でフィード名に戻す")) },
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
                }) { Text(tr("変更")) }
            },
            dismissButton = { TextButton(onClick = { showRename = false }) { Text(tr("キャンセル")) } },
        )
    }


    if (showFeedUrl) {
        val feedUrl = subscription?.feed?.feedUrl ?: ""
        AlertDialog(
            onDismissRequest = { showFeedUrl = false },
            title = { Text(tr("フィードURL")) },
            text = { Text(feedUrl) },
            confirmButton = {
                TextButton(onClick = {
                    context.getSystemService(ClipboardManager::class.java)
                        ?.setPrimaryClip(ClipData.newPlainText(AppStrings.get("フィードURL"), feedUrl))
                    showFeedUrl = false
                }) { Text(tr("コピー")) }
            },
            dismissButton = { TextButton(onClick = { showFeedUrl = false }) { Text(tr("閉じる")) } },
        )
    }

    if (showUnsubscribe) {
        AlertDialog(
            onDismissRequest = { showUnsubscribe = false },
            title = { Text(tr("この購読を解除しますか？")) },
            text = { Text(tr("ブックマークした記事は残ります。")) },
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
                }) { Text(tr("購読解除"), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { showUnsubscribe = false }) { Text(tr("キャンセル")) } },
        )
    }
}
