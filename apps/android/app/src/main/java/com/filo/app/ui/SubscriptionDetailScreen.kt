package com.filo.app.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SubscriptionDetailScreen(
    subscriptionId: Int,
    translations: TitleTranslationStore,
    onBack: () -> Unit,
    onSelectTag: (Int) -> Unit,
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
    var errorMessage by remember { mutableStateOf<AppText?>(null) }
    var isRefreshingFeed by remember { mutableStateOf(false) }
    var refreshNotice by remember { mutableStateOf<AppText?>(null) }
    var isMarkingAllRead by remember { mutableStateOf(false) }
    var markAllReadNotice by remember { mutableStateOf<AppText?>(null) }

    var sort by remember { mutableStateOf("published_at_desc") }
    var readFilter by remember { mutableStateOf<Boolean?>(null) }
    var readOrder by remember { mutableStateOf("unread_first") }
    var openInBrowserByDefault by remember { mutableStateOf(false) }

    var showRename by remember { mutableStateOf(false) }
    var renameText by remember { mutableStateOf("") }
    var showUnsubscribe by remember { mutableStateOf(false) }
    var showFeedUrl by remember { mutableStateOf(false) }
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
                errorMessage = ErrorMessages.forErrorText(e)
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
                    errorMessage = ErrorMessages.forErrorText(e)
                }
            } finally {
                if (requestGeneration == articleGeneration.get()) isLoadingMore = false
            }
        }
    }

    fun markAllRead() {
        if (isMarkingAllRead) return
        scope.launch {
            isMarkingAllRead = true
            markAllReadNotice = null
            errorMessage = null
            try {
                val result = ApiClient.markAllRead(subscriptionId)
                subscription = subscription?.copy(unreadCount = result.unreadCount)
                reloadArticles()
                markAllReadNotice = AppText("既読への変更が完了しました。")
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forErrorText(e)
            } finally {
                isMarkingAllRead = false
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
                errorMessage = ErrorMessages.forErrorText(e)
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
            if (e.status == 404) isGone = true else errorMessage = ErrorMessages.forErrorText(e)
        } catch (e: Exception) {
            errorMessage = ErrorMessages.forErrorText(e)
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
            if (result.enqueued > 0) refreshNotice = AppText("フィードの取得を開始しました。")
        } catch (e: Exception) {
            refreshNotice = ErrorMessages.forErrorText(e)
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


    fun updateTags(tagIds: List<Int>) {
        scope.launch {
            try {
                subscription = ApiClient.setSubscriptionTags(subscriptionId, tagIds)
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forErrorText(e)
            }
        }
    }

    if (isGone) {
        Column(Modifier.fillMaxSize()) {
            FiloHeader(tr("購読が見つかりません"), lead = HeaderLead.Back, onLead = onBack)
            FiloEmptyState(tr("この購読は削除されたか、表示できません。"), FiloIconName.Rss) {
                FiloButton(tr("購読一覧へ戻る"), onBack)
            }
        }
        return
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            FiloHeader(
                title = subscription?.displayTitle.orEmpty(),
                lead = HeaderLead.Back,
                onLead = onBack,
            ) {
                subscription?.let { sub ->
                    FiloIconButton(
                        FiloIconName.Refresh,
                        tr("このフィードを更新"),
                        { scope.launch { refreshFeedAndReload() } },
                        enabled = !isRefreshingFeed,
                    )
                    FiloIconButton(
                        FiloIconName.CheckCircle,
                        tr("すべて既読にする"),
                        ::markAllRead,
                        enabled = !isMarkingAllRead,
                    )
                    Box {
                        FiloIconButton(
                            FiloIconName.More,
                            tr("購読の操作"),
                            { subscriptionActionsMenuOpen = true },
                            expanded = subscriptionActionsMenuOpen,
                        )
                        FiloMenu(
                            expanded = subscriptionActionsMenuOpen,
                            onDismiss = { subscriptionActionsMenuOpen = false },
                        ) {
                            FiloMenuItem(tr("名前を変更"), {
                                subscriptionActionsMenuOpen = false
                                renameText = sub.customTitle.orEmpty()
                                showRename = true
                            }, icon = FiloIconName.Pencil)
                            sub.feed.siteUrl?.let { siteUrl ->
                                FiloMenuItem(tr("サイトを開く"), {
                                    subscriptionActionsMenuOpen = false
                                    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, siteUrl.toUri())) }
                                }, icon = FiloIconName.ExternalLink)
                            }
                            if (sub.feed.feedUrl != null) {
                                FiloMenuItem(tr("フィードURLを表示"), {
                                    subscriptionActionsMenuOpen = false
                                    showFeedUrl = true
                                }, icon = FiloIconName.Rss)
                            }
                            FiloDivider(Modifier.padding(vertical = 4.dp))
                            FiloMenuItem(tr("購読解除"), {
                                subscriptionActionsMenuOpen = false
                                showUnsubscribe = true
                            }, icon = FiloIconName.Trash, danger = true)
                        }
                    }
                    ArticleListControls(
                        translations = translations,
                        readFilter = readFilter,
                        sort = sort,
                        readOrder = readOrder,
                        onReadFilter = { readFilter = it },
                        onSort = { sort = it },
                        onReadOrder = { readOrder = it },
                    )
                }
            }
            PullToRefreshBox(
                isRefreshing = isRefreshingFeed,
                onRefresh = { scope.launch { refreshFeedAndReload() } },
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
                    if (isLoading) {
                        item { FiloSpinner() }
                        return@LazyColumn
                    }
                    subscription?.let { sub ->
                        item {
                            FlowRow(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .bottomBorder(Filo.colors.mutedBorder)
                                    .padding(horizontal = Filo.Gutter, vertical = 10.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                                itemVerticalAlignment = Alignment.CenterVertically,
                            ) {
                                SubscriptionHealth(sub)
                                if (sub.initialFetchStatus == "failed") {
                                    FiloButton(tr("初回取得を再試行"), {
                                        scope.launch {
                                            try {
                                                subscription = ApiClient.retryInitialFetch(subscriptionId)
                                                com.filo.app.Analytics.track("retry_feed_fetch", mapOf("subscription_id" to subscriptionId))
                                            } catch (e: Exception) {
                                                errorMessage = ErrorMessages.forErrorText(e)
                                            }
                                        }
                                    }, small = true)
                                }
                                allTags.filter { sub.tagIds.contains(it.id) }.forEach { tag ->
                                    FiloChip(
                                        tag.name,
                                        active = false,
                                        onClick = { onSelectTag(tag.id) },
                                        dotColor = tag.color?.let { parseTagColor(it) },
                                    )
                                }
                                TagPicker(allTags, sub.tagIds, ::updateTags, asButton = true)
                            }
                        }
                    }
                    if (isRefreshingFeed) item { FiloSpinner(tr("フィードを更新しています…")) }
                    errorMessage?.let { message ->
                        item {
                            FiloErrorBox(
                                tr(message),
                                modifier = Modifier.padding(start = Filo.Gutter, end = Filo.Gutter, top = 16.dp),
                                onRetry = { scope.launch { reload() } },
                            )
                        }
                    }
                    if (articles.isEmpty()) {
                        item {
                            if (readFilter == null && subscription?.initialFetchStatus == "fetching") {
                                FiloEmptyState(tr("記事を取得しています…"), FiloIconName.Refresh)
                            } else {
                                FiloEmptyState(tr("表示できる記事がありません。"), FiloIconName.Inbox)
                            }
                        }
                    } else {
                        itemsIndexed(articles, key = { _, article -> article.id }) { index, article ->
                            ArticleRow(
                                article = article,
                                showFeed = false,
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
                                onToggleReadingList = { patchState(article, inReadingList = !article.userState.inReadingList) },
                                onToggleBookmark = { patchState(article, isBookmarked = !article.userState.isBookmarked) },
                            )
                            if (index >= (articles.size - 4).coerceAtLeast(0) && nextCursor != null) {
                                LaunchedEffect(article.id) { loadMore() }
                            }
                        }
                        if (isLoadingMore) item { FiloSpinner() }
                    }
                }
            }
        }
        FiloToast(refreshNotice?.let { tr(it) }, onDismiss = { refreshNotice = null })
        FiloToast(markAllReadNotice?.let { tr(it) }, onDismiss = { markAllReadNotice = null }, durationMillis = 3000)
        if (isMarkingAllRead) {
            BlockingProgressOverlay(message = tr("既読に変更しています…"))
        }
    }

    if (showRename) {
        FiloDialog(
            title = tr("購読名を変更"),
            onDismiss = { showRename = false },
            buttons = {
                FiloButton(tr("キャンセル"), { showRename = false })
                FiloButton(tr("変更"), {
                    scope.launch {
                        try {
                            subscription = ApiClient.updateSubscription(subscriptionId, renameText.trim().ifEmpty { null })
                        } catch (e: Exception) {
                            errorMessage = ErrorMessages.forErrorText(e)
                        }
                    }
                    showRename = false
                }, kind = ButtonKind.Primary)
            },
        ) {
            FiloTextField(
                renameText,
                { renameText = it },
                placeholder = tr("空欄でフィード名に戻す"),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }

    if (showFeedUrl) {
        val feedUrl = subscription?.feed?.feedUrl.orEmpty()
        FiloDialog(
            title = tr("フィードURL"),
            onDismiss = { showFeedUrl = false },
            buttons = {
                FiloButton(tr("閉じる"), { showFeedUrl = false })
                FiloButton(tr("コピー"), {
                    context.getSystemService(ClipboardManager::class.java)
                        ?.setPrimaryClip(ClipData.newPlainText(AppStrings.get("フィードURL"), feedUrl))
                    showFeedUrl = false
                }, kind = ButtonKind.Primary)
            },
        ) {
            SelectionContainer {
                Text(feedUrl, fontSize = 14.sp, lineHeight = 21.sp, color = Filo.colors.text)
            }
        }
    }

    if (showUnsubscribe) {
        FiloConfirmDialog(
            title = tr("この購読を解除しますか？"),
            message = tr("ブックマークした記事は残ります。"),
            confirmLabel = tr("購読解除"),
            danger = true,
            onConfirm = {
                showUnsubscribe = false
                scope.launch {
                    try {
                        ApiClient.deleteSubscription(subscriptionId)
                        onBack()
                    } catch (e: Exception) {
                        errorMessage = ErrorMessages.forErrorText(e)
                    }
                }
            },
            onDismiss = { showUnsubscribe = false },
        )
    }
}
