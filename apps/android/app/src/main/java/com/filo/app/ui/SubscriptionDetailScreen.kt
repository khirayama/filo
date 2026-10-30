package com.filo.app.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import com.filo.app.api.ApiClient
import com.filo.app.api.ApiException
import com.filo.app.api.ArticleListFilters
import com.filo.app.api.ArticleListItem
import com.filo.app.api.ErrorMessages
import com.filo.app.api.Subscription
import com.filo.app.api.Tag
import kotlinx.coroutines.launch
import kotlinx.coroutines.ensureActive
import java.util.concurrent.atomic.AtomicLong

class SubscriptionDetailState : ViewModel() {
    var subscription by mutableStateOf<Subscription?>(null)
    var allTags by mutableStateOf<List<Tag>>(emptyList())
    var articles by mutableStateOf<List<ArticleListItem>>(emptyList())
    var baseline by mutableStateOf<Pair<ArticleListFilters, Int>?>(null)
    var nextCursor by mutableStateOf<String?>(null)
    var hasNewArticles by mutableStateOf(false)
    var sort by mutableStateOf("published_at_desc")
    var selectedSort by mutableStateOf<String?>(null)
    var readFilter by mutableStateOf<Boolean?>(null)
    var readOrder by mutableStateOf("unread_first")
    var openInBrowserByDefault by mutableStateOf(false)
    var loaded = false
    var loadedFilters: ArticleListFilters? = null
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SubscriptionDetailScreen(
    subscriptionId: Int,
    translations: TitleTranslationStore,
    onBack: () -> Unit,
    onSelectTag: (Int) -> Unit,
    onOpenArticle: (ArticleListItem) -> Unit,
) {
    val saved: SubscriptionDetailState = viewModel()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val focusRequester = remember { FocusRequester() }
    var subscription by saved::subscription
    var allTags by saved::allTags
    var articles by saved::articles
    val listState = rememberLazyListState()
    var isLoadingNewArticles by remember { mutableStateOf(false) }
    var hasNewArticles by saved::hasNewArticles
    var newArticleBaseline by saved::baseline
    var nextCursor by saved::nextCursor
    var isLoadingMore by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(!saved.loaded) }
    var isGone by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<AppText?>(null) }
    var isRefreshingFeed by remember { mutableStateOf(false) }
    var refreshNotice by remember { mutableStateOf<AppText?>(null) }
    var isMarkingAllRead by remember { mutableStateOf(false) }
    var markAllReadNotice by remember { mutableStateOf<AppText?>(null) }

    var sort by saved::sort
    var selectedSort by saved::selectedSort
    var readFilter by saved::readFilter
    var readOrder by saved::readOrder
    var openInBrowserByDefault by saved::openInBrowserByDefault

    var showRename by remember { mutableStateOf(false) }
    var renameText by remember { mutableStateOf("") }
    var showUnsubscribe by remember { mutableStateOf(false) }
    var showFeedUrl by remember { mutableStateOf(false) }
    var subscriptionActionsMenuOpen by remember { mutableStateOf(false) }
    var showShortcutHelp by remember { mutableStateOf(false) }
    var selectedArticleIndex by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(articles.size) {
        selectedArticleIndex = selectedArticleIndex?.let { if (articles.isEmpty()) null else it.coerceAtMost(articles.lastIndex) }
    }
    val pendingArticles = remember(subscriptionId) { mutableSetOf<Int>() }
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
        if (newArticleBaseline?.first != requestFilters) hasNewArticles = false
        isLoadingMore = false
        nextCursor = null
        try {
            val page = ApiClient.listArticles(requestFilters)
            if (requestGeneration == articleGeneration.get() && requestFilters == filters()) {
                newArticleBaseline = page.latestArticleId?.let { requestFilters to it }
                hasNewArticles = false
                errorMessage = null
                articles = page.articles
                nextCursor = page.nextCursor
                saved.loadedFilters = requestFilters
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
            val previousArticles = articles
            val requestFilters = filters()
            // Show the result at once; the reload below brings the server's order.
            articles = if (readFilter == false) {
                emptyList()
            } else {
                articles.map { if (it.userState.isRead) it else it.copy(userState = it.userState.copy(isRead = true)) }
            }
            try {
                val result = ApiClient.markAllRead(subscriptionId)
                subscription = subscription?.copy(unreadCount = result.unreadCount)
                reloadArticles()
                markAllReadNotice = AppText("既読への変更が完了しました。")
            } catch (e: Exception) {
                if (requestFilters == filters()) {
                    articles = restoringArticleReadStates(articles, previousArticles, restoreHidden = requestFilters.read == false)
                    errorMessage = ErrorMessages.forErrorText(e)
                }
            } finally {
                isMarkingAllRead = false
            }
        }
    }

    fun applyState(articleId: Int, state: com.filo.app.api.ArticleUserState) {
        articles = articles.mapNotNull {
            if (it.id != articleId) it
            else if (readFilter != null && state.isRead != readFilter) null
            else it.copy(userState = state)
        }
    }

    // Apply the change before the request so the row answers the tap at once;
    // the response then confirms it, and a failure puts the old state back.
    fun patchState(
        article: ArticleListItem,
        isRead: Boolean? = null,
        inReadingList: Boolean? = null,
        isBookmarked: Boolean? = null,
    ) {
        if (isRead == null && inReadingList == null && isBookmarked == null) return
        if (!pendingArticles.add(article.id)) return
        val originalIndex = articles.indexOfFirst { it.id == article.id }
        if (originalIndex < 0) { pendingArticles.remove(article.id); return }
        val requestFilters = filters()
        errorMessage = null
        val before = article.userState
        applyState(
            article.id,
            before.copy(
                isRead = isRead ?: before.isRead,
                inReadingList = inReadingList ?: before.inReadingList,
                isBookmarked = isBookmarked ?: before.isBookmarked,
            ),
        )
        scope.launch {
            try {
                val state = when {
                    isRead != null -> ApiClient.setArticleRead(article.id, isRead)
                    inReadingList != null -> ApiClient.setReadingListMembership(article.id, inReadingList)
                    else -> ApiClient.setBookmarkMembership(article.id, isBookmarked == true)
                }
                if (requestFilters == filters()) applyState(article.id, state)
            } catch (e: Exception) {
                if (requestFilters == filters()) {
                    articles = if (articles.any { it.id == article.id }) {
                        articles.map { if (it.id == article.id) it.copy(userState = before) else it }
                    } else {
                        articles.toMutableList().apply { add(originalIndex.coerceAtMost(size), article) }
                    }
                    errorMessage = ErrorMessages.forErrorText(e)
                }
            } finally {
                pendingArticles.remove(article.id)
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
                    sort = selectedSort ?: settings.articleSortOrder
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
            val result = ApiClient.refreshFeed(feedId, waitForCompletion = true)
            com.filo.app.Analytics.track(
                "refresh_feed",
                mapOf("feed_id" to feedId, "source" to "subscription_detail"),
            )
            if (result.enqueued > 0) refreshNotice = AppText("%d件のフィードを更新しました。", listOf(result.enqueued))
        } catch (e: Exception) {
            refreshNotice = ErrorMessages.forErrorText(e)
        }
        runCatching { subscription = ApiClient.getSubscription(subscriptionId) }
        reloadArticles()
        isRefreshingFeed = false
    }

    PollForNewArticles {
        val baseline = newArticleBaseline
        if (baseline != null && baseline.first == filters() && !isLoading && !isRefreshingFeed && !isMarkingAllRead && !isGone) {
            val requestGeneration = articleGeneration.get()
            try {
                val page = ApiClient.listArticles(baseline.first, checkNew = true, afterId = baseline.second)
                kotlinx.coroutines.currentCoroutineContext().ensureActive()
                if (requestGeneration == articleGeneration.get() && baseline.first == filters()) {
                    hasNewArticles = (page.latestArticleId ?: 0) > baseline.second
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (_: Exception) {
                // Retry on the next background check without interrupting reading.
            }
        }
    }
    LaunchedEffect(Unit) {
        if (!saved.loaded) {
            reload()
            if (subscription != null && errorMessage == null) saved.loaded = true
        }
    }
    // 翻訳トグルが ON の間は、表示された記事を翻訳対象にする
    LaunchedEffect(articles, translations.isEnabled, translations.languages) { translations.register(articles) }
    LaunchedEffect(sort, readFilter, readOrder) {
        if (!isLoading && saved.loadedFilters != filters()) reloadArticles()
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

    LaunchedEffect(Unit) { focusRequester.requestFocus() }
    Box(modifier = Modifier.fillMaxSize().onPreviewKeyEvent { event ->
        if (event.type != KeyEventType.KeyDown || event.isCtrlPressed || event.isAltPressed || event.isMetaPressed ||
            showRename || showFeedUrl || showUnsubscribe || subscriptionActionsMenuOpen || showShortcutHelp) return@onPreviewKeyEvent false
        if (event.isShiftPressed && event.key == Key.A) {
            if (event.nativeKeyEvent.repeatCount == 0) markAllRead()
            return@onPreviewKeyEvent true
        }
        val navigation = event.key == Key.J || event.key == Key.K || event.key == Key.DirectionDown || event.key == Key.DirectionUp
        if (event.nativeKeyEvent.repeatCount > 0 && !navigation) return@onPreviewKeyEvent false
        if (navigation) {
            if (articles.isNotEmpty()) {
                val visibleIds = listState.layoutInfo.visibleItemsInfo.map { it.key }.toSet()
                val selected = selectedArticleIndex?.takeIf { it in articles.indices && articles[it].id in visibleIds }
                val firstVisible = articles.indexOfFirst { it.id in visibleIds }.coerceAtLeast(0)
                val delta = if (event.key == Key.J || event.key == Key.DirectionDown) 1 else -1
                val next = (selected?.plus(delta) ?: firstVisible).coerceIn(0, articles.lastIndex)
                selectedArticleIndex = next
                val headers = (if (subscription != null) 1 else 0) + (if (isRefreshingFeed) 1 else 0) + (if (errorMessage != null) 1 else 0)
                scope.launch { listState.animateScrollToItem(headers + next) }
            }
            true
        } else if (event.isShiftPressed && event.key == Key.Slash) {
            showShortcutHelp = true
            true
        } else if (event.key == Key.R && !event.isShiftPressed) {
            scope.launch { refreshFeedAndReload() }; true
        } else if (event.key == Key.Enter || event.key == Key.O || event.key == Key.V || event.key == Key.M || event.key == Key.S || event.key == Key.B) {
            val index = (selectedArticleIndex ?: 0).coerceIn(0, (articles.size - 1).coerceAtLeast(0))
            val article = articles.getOrNull(index)
            if (article != null) {
                selectedArticleIndex = index
                when (event.key) {
                    Key.Enter, Key.O -> if (openInBrowserByDefault && article.canonicalUrl != null) context.startActivity(Intent(Intent.ACTION_VIEW, article.canonicalUrl.toUri())) else onOpenArticle(article)
                    Key.V -> article.canonicalUrl?.let { context.startActivity(Intent(Intent.ACTION_VIEW, it.toUri())) }
                    Key.M -> patchState(article, isRead = !article.userState.isRead)
                    Key.S -> patchState(article, inReadingList = !article.userState.inReadingList)
                    Key.B -> patchState(article, isBookmarked = !article.userState.isBookmarked)
                }
            }
            true
        } else false
    }.focusRequester(focusRequester).focusable()) {
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
                        FiloIconName.CheckAll,
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
                        onSort = { selectedSort = it; sort = it },
                        onReadOrder = { readOrder = it },
                    )
                }
            }
            PullToRefreshBox(
                isRefreshing = isRefreshingFeed,
                onRefresh = { scope.launch { refreshFeedAndReload() } },
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(state = listState, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
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
                                modifier = Modifier.animateItem(),
                                selected = index == selectedArticleIndex,
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
                NewArticlesNotice(
                    visible = hasNewArticles,
                    enabled = !isLoadingNewArticles && !isLoading && !isRefreshingFeed && !isMarkingAllRead,
                    modifier = Modifier.align(Alignment.TopCenter),
                    onLoad = {
                        if (!isLoadingNewArticles) {
                            isLoadingNewArticles = true
                            scope.launch {
                                try {
                                    reloadArticles()
                                    if (!hasNewArticles && errorMessage == null) listState.scrollToItem(0)
                                } finally {
                                    isLoadingNewArticles = false
                                }
                            }
                        }
                    },
                )
            }
        }
        FiloToast(refreshNotice?.let { tr(it) }, onDismiss = { refreshNotice = null })
        FiloToast(markAllReadNotice?.let { tr(it) }, onDismiss = { markAllReadNotice = null }, durationMillis = 3000)
    }

    if (showShortcutHelp) {
        ShortcutHelpDialog(listOf(
            "J / ↓  次の記事", "K / ↑  前の記事", "Enter / O  記事を開く", "V  元記事を開く",
            "M  既読／未読", "S  リーディングリスト", "B  ブックマーク", "R  更新", "Shift+A  すべて既読", "?  この一覧",
        ).map(AppStrings::get)) { showShortcutHelp = false }
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
