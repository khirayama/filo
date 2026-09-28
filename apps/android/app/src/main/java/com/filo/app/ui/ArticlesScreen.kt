package com.filo.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.snapshotFlow
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
import androidx.lifecycle.viewmodel.compose.viewModel
import com.filo.app.ThemePreference
import com.filo.app.api.ArticleListItem
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

private const val ARTICLE_SELECTION_BUFFER = 3

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticlesScreen(
    translations: TitleTranslationStore,
    model: ArticlesViewModel = viewModel(),
    onOpenMenu: (() -> Unit)?,
    initialSelectedTagId: Int? = null,
    onInitialSelectedTagConsumed: () -> Unit = {},
    initialReadingList: Boolean = false,
    onInitialReadingListConsumed: () -> Unit = {},
    onOpenSubscription: (Int) -> Unit,
    onOpenAddFeed: () -> Unit,
    onStartReading: (Boolean) -> Unit,
    onOpenArticle: (ArticleListItem) -> Unit,
) {
    val vm = model
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    val articles = vm.articles
    val tags = vm.tags
    val subscriptions = vm.subscriptions
    val isLoading = vm.isLoading
    val isLoadingMore = vm.isLoadingMore
    val errorMessage = vm.errorMessage
    val nextCursor = vm.nextCursor

    var selectedTagId by vm::selectedTagId
    var readFilter by vm::readFilter
    var sort by vm::sort
    var readOrder by vm::readOrder
    var readingListOnly by vm::readingListOnly
    var bookmarkedOnly by vm::bookmarkedOnly

    var showRemoveReadArticles by remember { mutableStateOf(false) }
    var isPullRefreshing by remember { mutableStateOf(false) }
    var selectedArticleIndex by remember { mutableStateOf<Int?>(null) }
    var showShortcutHelp by remember { mutableStateOf(false) }
    var articleToOpenInBrowser by remember { mutableStateOf<ArticleListItem?>(null) }
    val listState = rememberLazyListState()
    val focusRequester = remember { FocusRequester() }
    var viewedArticleIds by remember { mutableStateOf("") }

    DisposableEffect(Unit) {
        onDispose {
            vm.saveListPosition(listState.firstVisibleItemIndex, listState.firstVisibleItemScrollOffset)
            vm.resetLoadState()
        }
    }
    LaunchedEffect(initialSelectedTagId) {
        if (initialSelectedTagId != null) {
            selectedTagId = initialSelectedTagId
            readingListOnly = false
            bookmarkedOnly = false
            onInitialSelectedTagConsumed()
        }
    }
    LaunchedEffect(initialReadingList) {
        if (initialReadingList) {
            selectedTagId = null
            readingListOnly = true
            bookmarkedOnly = false
            onInitialReadingListConsumed()
        }
    }
    LaunchedEffect(selectedTagId, readFilter, sort, readOrder, readingListOnly, bookmarkedOnly) {
        vm.loadIfNeeded()
    }
    LaunchedEffect(Unit) {
        focusRequester.requestFocus()
        snapshotFlow { isLoading to articles.isNotEmpty() }
            .first { (loading, hasArticles) -> !loading && hasArticles }
        val (index, offset) = vm.listPositionForCurrentFilter()
        if (index > 0 || offset > 0) {
            listState.scrollToItem(index, offset)
        }
        snapshotFlow { listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset }
            .collect { (firstVisibleItemIndex, firstVisibleItemScrollOffset) ->
                vm.saveListPosition(firstVisibleItemIndex, firstVisibleItemScrollOffset)
            }
    }
    fun scrollToSelectedArticle(index: Int) {
        val targetIndex = (index - ARTICLE_SELECTION_BUFFER).coerceAtLeast(0)
        scope.launch { listState.animateScrollToItem(targetIndex) }
    }
    fun articleIndexAtScrollPosition(): Int {
        return listState.firstVisibleItemIndex.coerceIn(0, (articles.size - 1).coerceAtLeast(0))
    }
    fun isArticleVisible(index: Int): Boolean {
        return listState.layoutInfo.visibleItemsInfo.any { it.index == index }
    }
    fun selectionStartIndex(): Int {
        val current = selectedArticleIndex
        return if (current != null && isArticleVisible(current)) current else articleIndexAtScrollPosition()
    }
    fun isCurrentSelectionVisible(): Boolean {
        return selectedArticleIndex?.let { isArticleVisible(it) } == true
    }
    suspend fun markAllReadAndResetList() {
        if (vm.markAllRead()) {
            selectedArticleIndex = null
            listState.scrollToItem(0)
            vm.saveListPosition(0, 0)
        }
    }
    LaunchedEffect(articles.size) {
        selectedArticleIndex?.let { index ->
            selectedArticleIndex = index.coerceIn(0, (articles.size - 1).coerceAtLeast(0))
        }
    }
    LaunchedEffect(articles, isLoading) {
        if (!isLoading && articles.isNotEmpty()) {
            val ids = articles.joinToString(",") { it.id.toString() }
            if (ids != viewedArticleIds) {
                viewedArticleIds = ids
                com.filo.app.Analytics.track("view_item_list", mapOf("item_list_name" to "articles", "item_count" to articles.size))
            }
        }
    }
    // 翻訳トグルが ON の間は、表示された記事を翻訳対象にする
    LaunchedEffect(
        vm.articles,
        vm.language,
        vm.readableLanguages,
        vm.subscriptions,
        translations.isEnabled,
        translations.languages,
    ) {
        translations.configure(vm.language, vm.readableLanguages)
        // 準備画面の候補は「購読に実在する言語」
        translations.setCandidates(vm.subscriptions)
        translations.register(vm.articles)
    }
    // 起動時にサーバー設定のテーマを描画へ反映する (他端末での変更を取り込む)
    LaunchedEffect(vm.theme) {
        vm.theme?.let { ThemePreference.set(context, it) }
    }

    val viewTitle = when {
        selectedTagId != null -> tags.firstOrNull { it.id == selectedTagId }?.name ?: tr("タグ")
        readingListOnly -> tr("リーディングリスト")
        bookmarkedOnly -> tr("ブックマーク")
        else -> tr("全ての記事")
    }
    val hasFetchingSubscriptionInScope = if (readingListOnly || bookmarkedOnly || readFilter != null) {
        false
    } else {
        selectedTagId?.let { tagId ->
            subscriptions.any {
                it.initialFetchStatus == "fetching" && it.tagIds.contains(tagId)
            }
        } ?: subscriptions.any { it.initialFetchStatus == "fetching" }
    }
    // Reading starts at the first unread article, so it needs one to open.
    val canStartReading = articles.any { it.canonicalUrl != null }

    fun selectedArticleOrFirst(): ArticleListItem? {
        if (articles.isEmpty()) return null
        val index = (selectedArticleIndex ?: 0).coerceIn(0, articles.lastIndex)
        selectedArticleIndex = index
        return articles[index]
    }

    fun openArticle(article: ArticleListItem) {
        val url = article.canonicalUrl
        if (vm.openInBrowserByDefault && url != null) {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } else {
            onOpenArticle(article)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .focusRequester(focusRequester)
            .focusable()
            .onPreviewKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                if (vm.isMarkingAllRead) return@onPreviewKeyEvent true
                val hasModifier = event.isCtrlPressed || event.isAltPressed || event.isMetaPressed
                if (event.isShiftPressed && event.key == Key.A && !hasModifier) {
                    if (!bookmarkedOnly && !readingListOnly) scope.launch { markAllReadAndResetList() }
                    true
                } else if (hasModifier) {
                    false
                } else if (
                    event.nativeKeyEvent.repeatCount > 0
                    && event.key != Key.J
                    && event.key != Key.DirectionDown
                    && event.key != Key.K
                    && event.key != Key.DirectionUp
                ) {
                    false
                } else {
                    when (event.key) {
                        Key.J, Key.DirectionDown -> {
                            if (articles.isNotEmpty()) {
                                val currentSelectionVisible = isCurrentSelectionVisible()
                                val startIndex = selectionStartIndex()
                                val nextIndex = if (currentSelectionVisible) {
                                    (startIndex + 1).coerceAtMost(articles.lastIndex)
                                } else {
                                    startIndex
                                }
                                selectedArticleIndex = nextIndex
                                scrollToSelectedArticle(nextIndex)
                            }
                            true
                        }
                        Key.K, Key.DirectionUp -> {
                            if (articles.isNotEmpty()) {
                                val currentSelectionVisible = isCurrentSelectionVisible()
                                val startIndex = selectionStartIndex()
                                val nextIndex = if (currentSelectionVisible) {
                                    (startIndex - 1).coerceAtLeast(0)
                                } else {
                                    startIndex
                                }
                                selectedArticleIndex = nextIndex
                                scrollToSelectedArticle(nextIndex)
                            }
                            true
                        }
                        Key.Enter, Key.O -> {
                            selectedArticleOrFirst()?.let(::openArticle)
                            true
                        }
                        Key.V -> {
                            selectedArticleOrFirst()?.canonicalUrl?.let {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it)))
                            }
                            true
                        }
                        Key.M -> {
                            selectedArticleOrFirst()?.let { vm.patchState(it, isRead = !it.userState.isRead) }
                            true
                        }
                        Key.S -> {
                            selectedArticleOrFirst()?.let { vm.patchState(it, inReadingList = !it.userState.inReadingList) }
                            true
                        }
                        Key.B -> {
                            selectedArticleOrFirst()?.let { vm.patchState(it, isBookmarked = !it.userState.isBookmarked) }
                            true
                        }
                        Key.R -> {
                            scope.launch { vm.refreshFeedsAndReload() }
                            true
                        }
                        Key.Slash -> {
                            if (event.isShiftPressed) {
                                showShortcutHelp = true
                                true
                            } else {
                                false
                            }
                        }
                        else -> false
                    }
                }
            },
    ) {
        Column(Modifier.fillMaxSize()) {
            FiloHeader(
                title = viewTitle,
                lead = if (onOpenMenu != null) HeaderLead.Menu else HeaderLead.None,
                onLead = { onOpenMenu?.invoke() },
            ) {
                if (readingListOnly) {
                    FiloIconButton(FiloIconName.BookOpen, tr("閲覧開始"), { onStartReading(false) }, enabled = canStartReading)
                    FiloIconButton(FiloIconName.Play, tr("読み上げ開始"), { onStartReading(true) }, enabled = canStartReading)
                    FiloIconButton(FiloIconName.Trash, tr("既読記事を削除"), { showRemoveReadArticles = true })
                }
                if (!bookmarkedOnly && !readingListOnly) {
                    FiloIconButton(
                        FiloIconName.CheckCircle,
                        tr("すべて既読にする"),
                        { scope.launch { markAllReadAndResetList() } },
                        enabled = !vm.isMarkingAllRead,
                    )
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
            PullToRefreshBox(
                isRefreshing = isPullRefreshing || vm.isRefreshingFeeds,
                onRefresh = {
                    scope.launch {
                        isPullRefreshing = true
                        vm.refreshFeedsAndReload()
                        isPullRefreshing = false
                    }
                },
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 32.dp),
                ) {
                    if (isLoading && articles.isEmpty()) {
                        item { FiloSpinner() }
                    } else if (errorMessage != null) {
                        item {
                            FiloErrorBox(
                                tr(errorMessage),
                                modifier = Modifier.padding(Filo.Gutter),
                                onRetry = { scope.launch { vm.reload() } },
                            )
                        }
                    } else if (articles.isEmpty()) {
                        item {
                            when {
                                subscriptions.isEmpty() && selectedTagId == null && readFilter == null && !readingListOnly && !bookmarkedOnly ->
                                    FiloEmptyState(tr("まだ購読がありません。"), FiloIconName.Rss) {
                                        FiloButton(tr("フィードを追加"), onOpenAddFeed, kind = ButtonKind.Primary)
                                    }
                                hasFetchingSubscriptionInScope ->
                                    FiloEmptyState(tr("記事を取得しています…"), FiloIconName.Refresh) {
                                        FiloButton(tr("更新"), { scope.launch { vm.reload() } })
                                    }
                                readingListOnly ->
                                    FiloEmptyState(tr("リーディングリストに保存した記事はありません。"), FiloIconName.Playlist) {
                                        FiloButton(tr("全ての記事"), {
                                            selectedTagId = null
                                            readingListOnly = false
                                            bookmarkedOnly = false
                                        })
                                    }
                                bookmarkedOnly -> FiloEmptyState(tr("表示できる記事がありません。"), FiloIconName.Bookmark)
                                else -> FiloEmptyState(tr("表示できる記事がありません。"), FiloIconName.Inbox)
                            }
                        }
                    } else {
                        itemsIndexed(articles, key = { _, article -> article.id }) { index, article ->
                            ArticleRow(
                                article = article,
                                selected = index == selectedArticleIndex,
                                translations = translations,
                                onOpenFeed = article.subscriptionIds.firstOrNull()?.let { subscriptionId ->
                                    { onOpenSubscription(subscriptionId) }
                                },
                                onOpen = { openArticle(article) },
                                onLongPress = if (article.canonicalUrl != null) {
                                    { articleToOpenInBrowser = article }
                                } else null,
                                onToggleRead = { vm.patchState(article, isRead = !article.userState.isRead) },
                                onToggleReadingList = { vm.patchState(article, inReadingList = !article.userState.inReadingList) },
                                onToggleBookmark = { vm.patchState(article, isBookmarked = !article.userState.isBookmarked) },
                            )
                            // Feedly-style infinite scroll: fetch the next page near the end.
                            if (index >= (articles.size - 4).coerceAtLeast(0) && nextCursor != null) {
                                LaunchedEffect(article.id) { vm.loadMore() }
                            }
                        }
                        if (isLoadingMore) {
                            item { FiloSpinner() }
                        }
                    }
                }
            }
        }
        FiloToast(vm.refreshNotice?.let { tr(it) }, onDismiss = { vm.refreshNotice = null })
        FiloToast(vm.markAllReadNotice?.let { tr(it) }, onDismiss = vm::clearMarkAllReadNotice, durationMillis = 3000)
        if (vm.isMarkingAllRead) {
            BlockingProgressOverlay(message = tr("既読に変更しています…"))
        }
    }

    if (showRemoveReadArticles) {
        FiloConfirmDialog(
            title = tr("既読の記事をリーディングリストから削除しますか？"),
            confirmLabel = tr("既読記事を削除"),
            danger = true,
            onConfirm = {
                showRemoveReadArticles = false
                scope.launch { vm.removeReadArticlesFromReadingList() }
            },
            onDismiss = { showRemoveReadArticles = false },
        )
    }

    articleToOpenInBrowser?.let { article ->
        FiloConfirmDialog(
            title = tr("ブラウザで開く"),
            message = article.title,
            confirmLabel = tr("開く"),
            onConfirm = {
                article.canonicalUrl?.let { url ->
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                }
                articleToOpenInBrowser = null
            },
            onDismiss = { articleToOpenInBrowser = null },
        )
    }

    if (showShortcutHelp) {
        ShortcutHelpDialog(
            listOf(
                "J / ↓  次の記事",
                "K / ↑  前の記事",
                "Enter / O  記事を開く",
                "V  元記事を開く",
                "M  既読／未読",
                "S  リーディングリスト",
                "B  ブックマーク",
                "R  更新",
                "Shift+A  すべて既読",
                "?  この一覧",
            ).map(AppStrings::get),
        ) { showShortcutHelp = false }
    }
}

@Composable
fun ShortcutHelpDialog(lines: List<String>, onDismiss: () -> Unit) {
    FiloDialog(
        title = tr("ショートカット"),
        onDismiss = onDismiss,
        buttons = { FiloButton(tr("閉じる"), onDismiss) },
    ) {
        Text(lines.joinToString("\n"), fontSize = 14.sp, lineHeight = 25.sp, color = Filo.colors.text)
    }
}

/** The article list's display settings popover (web `ArticleListControls`). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ArticleListControls(
    translations: TitleTranslationStore,
    readFilter: Boolean?,
    sort: String,
    readOrder: String,
    onReadFilter: (Boolean?) -> Unit,
    onSort: (String) -> Unit,
    onReadOrder: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    fun choose(action: () -> Unit) {
        action()
        open = false
    }
    Box {
        FiloIconButton(FiloIconName.Gear, tr("表示設定"), { open = true }, expanded = open)
        FiloMenu(expanded = open, onDismiss = { open = false }, modifier = Modifier.width(300.dp)) {
            Column(Modifier.padding(start = 8.dp, end = 8.dp, bottom = 10.dp)) {
                if (translations.isSupported) {
                    Row(
                        modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(tr("タイトルを翻訳"), fontSize = 14.sp, color = Filo.colors.text)
                        if (translations.isTranslating) {
                            Text(
                                tr("翻訳中…"),
                                fontSize = 12.sp,
                                color = Filo.colors.muted,
                                modifier = Modifier.padding(start = 6.dp),
                            )
                        }
                        Box(Modifier.weight(1f))
                        FiloSwitch(translations.isEnabled, { choose(translations::toggle) }, tr("タイトルを翻訳"))
                    }
                    FiloDivider(Modifier.padding(bottom = 4.dp))
                }
                ControlSection(tr("既読状態"), top = 8.dp) {
                    FiloChip(tr("全ての記事"), readFilter == null, { choose { onReadFilter(null) } })
                    FiloChip(tr("未読"), readFilter == false, { choose { onReadFilter(false) } })
                    FiloChip(tr("既読"), readFilter == true, { choose { onReadFilter(true) } })
                }
                ControlSection(tr("並び順")) {
                    FiloChip(tr("公開日時が新しい順"), sort == "published_at_desc", { choose { onSort("published_at_desc") } })
                    FiloChip(tr("取得日時が新しい順"), sort == "fetched_at_desc", { choose { onSort("fetched_at_desc") } })
                }
                ControlSection(tr("既読の扱い")) {
                    FiloChip(tr("既読で並び替えない"), readOrder == "none", { choose { onReadOrder("none") } })
                    FiloChip(tr("既読は下"), readOrder == "unread_first", { choose { onReadOrder("unread_first") } })
                    FiloChip(tr("既読は上"), readOrder == "read_first", { choose { onReadOrder("read_first") } })
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ControlSection(label: String, top: androidx.compose.ui.unit.Dp = 16.dp, chips: @Composable () -> Unit) {
    Text(
        label,
        fontSize = 12.sp,
        fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
        color = Filo.colors.muted,
        modifier = Modifier.padding(top = top, bottom = 8.dp),
    )
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) { chips() }
}
