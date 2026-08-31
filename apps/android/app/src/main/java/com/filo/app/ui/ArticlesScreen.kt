package com.filo.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.focusable
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.PermanentDrawerSheet
import androidx.compose.material3.PermanentNavigationDrawer
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDrawerState
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
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
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.filo.app.ThemePreference
import com.filo.app.api.ArticleListItem
import com.filo.app.api.Subscription
import com.filo.app.api.Tag
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import androidx.compose.material3.AlertDialog

private const val ARTICLE_SELECTION_BUFFER = 3

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticlesScreen(
    translations: TitleTranslationStore,
    model: ArticlesViewModel = viewModel(),
    showDesktopSidebar: Boolean = true,
    showMobileDrawer: Boolean = true,
    showMobileMenu: Boolean = true,
    onCloseMobileDrawer: () -> Unit = {},
    onOpenMobileDrawer: (() -> Unit)? = null,
    initialSelectedTagId: Int? = null,
    onInitialSelectedTagConsumed: () -> Unit = {},
    initialReadingList: Boolean = false,
    onInitialReadingListConsumed: () -> Unit = {},
    onOpenSubscription: (Int) -> Unit,
    onOpenSubscriptions: () -> Unit,
    onOpenAddFeed: () -> Unit,
    onOpenAddArticle: () -> Unit,
    onStartReading: (Boolean) -> Unit,
    onOpenArticle: (ArticleListItem) -> Unit,
    onOpenTags: () -> Unit,
    onOpenStatus: () -> Unit,
    onOpenSettings: () -> Unit,
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

    val drawerState = rememberDrawerState(DrawerValue.Closed)
    var articleOptionsMenuOpen by remember { mutableStateOf(false) }
    var showRemoveReadArticles by remember { mutableStateOf(false) }
    var isPullRefreshing by remember { mutableStateOf(false) }
    var selectedArticleIndex by remember { mutableStateOf<Int?>(null) }
    var showShortcutHelp by remember { mutableStateOf(false) }
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
    // 起動時にサーバー設定のテーマを描画へ反映する (他端末での変更を取り込む)
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

    fun selectedArticleOrFirst(): ArticleListItem? {
        if (articles.isEmpty()) return null
        val index = (selectedArticleIndex ?: 0).coerceIn(0, articles.lastIndex)
        selectedArticleIndex = index
        return articles[index]
    }

    BoxWithConstraints(
        modifier = Modifier
            .focusRequester(focusRequester)
            .focusable()
            .onPreviewKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                val hasModifier = event.isCtrlPressed || event.isAltPressed || event.isMetaPressed
                if (event.isShiftPressed && event.key == Key.A && !hasModifier) {
                    if (!bookmarkedOnly && !readingListOnly) scope.launch { vm.markAllRead() }
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
                            selectedArticleOrFirst()?.let { article ->
                                if (vm.openInBrowserByDefault) {
                                    article.canonicalUrl?.let { url ->
                                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                                    }
                                } else {
                                    onOpenArticle(article)
                                }
                            }
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
                        Key.Escape -> {
                            if (showMobileDrawer) {
                                scope.launch { drawerState.close() }
                            } else {
                                onCloseMobileDrawer()
                            }
                            true
                        }
                        else -> false
                    }
                }
            },
    ) {
        val isDesktop = maxWidth >= 1024.dp
        val drawerContent: @Composable (Boolean) -> Unit = { desktop ->
            RssSourcesDrawerContent(
                    tags = tags,
                    subscriptions = subscriptions,
                    selectedTagId = selectedTagId,
                    readingListOnly = readingListOnly,
                    bookmarkedOnly = bookmarkedOnly,
                    showCloseButton = !desktop,
                    onCloseDrawer = { scope.launch { drawerState.close() } },
                    onSelectView = { tagId, readingList, bookmarked ->
                        selectedTagId = tagId
                        readingListOnly = readingList
                        bookmarkedOnly = bookmarked
                        scope.launch { drawerState.close() }
                    },
                    onOpenSubscription = {
                        scope.launch { drawerState.close() }
                        onOpenSubscription(it)
                    },
                    onOpenAddFeed = {
                        scope.launch { drawerState.close() }
                        onOpenAddFeed()
                    },
                    onOpenAddArticle = {
                        scope.launch { drawerState.close() }
                        onOpenAddArticle()
                    },
                    onOpenSubscriptions = {
                        scope.launch { drawerState.close() }
                        onOpenSubscriptions()
                    },
                    onOpenTags = {
                        scope.launch { drawerState.close() }
                        onOpenTags()
                    },
                    onOpenStatus = {
                        scope.launch { drawerState.close() }
                        onOpenStatus()
                    },
                    onOpenSettings = {
                        scope.launch { drawerState.close() }
                        onOpenSettings()
                    },
            )
        }
        val mainContent: @Composable () -> Unit = {
            Scaffold(
            topBar = {
                Column {
                    TopAppBar(
                        title = {
                            Text(
                                viewTitle,
                                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                            )
                        },
                        navigationIcon = {
                            if (!isDesktop && showMobileMenu) {
                                IconButton(onClick = {
                                    if (onOpenMobileDrawer != null) {
                                        onOpenMobileDrawer()
                                    } else {
                                        scope.launch { drawerState.open() }
                                    }
                                }) {
                                    FiloIcon(FiloIconName.Menu, contentDescription = tr("フィードメニュー"))
                                }
                            }
                        },
                        actions = {
                            if (readingListOnly) {
                                IconButton(onClick = { showRemoveReadArticles = true }) {
                                    FiloIcon(FiloIconName.Trash, size = 20.dp, contentDescription = tr("既読記事を削除"))
                                }
                                TextButton(onClick = { onStartReading(false) }) {
                                    FiloIcon(FiloIconName.Play, size = 16.dp)
                                    Text(tr("閲覧開始"))
                                }
                            }
                            if (!bookmarkedOnly && !readingListOnly) {
                                IconButton(onClick = { scope.launch { vm.markAllRead() } }) {
                                    FiloIcon(FiloIconName.CheckCircle, size = 20.dp, contentDescription = tr("すべて既読にする"))
                                }
                            }
                            Box {
                                IconButton(onClick = { articleOptionsMenuOpen = true }) {
                                    FiloIcon(FiloIconName.Gear, size = 20.dp, contentDescription = tr("表示設定"))
                                }
                                DropdownMenu(expanded = articleOptionsMenuOpen, onDismissRequest = { articleOptionsMenuOpen = false }) {
                                    if (translations.isSupported) {
                                        DropdownMenuItem(
                                            text = { Text(tr(if (translations.isEnabled) "タイトルを翻訳（オン）" else "タイトルを翻訳（オフ）")) },
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
                        },
                    )
                }
            },
                ) { innerPadding ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding),
            ) {
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
                        verticalArrangement = Arrangement.spacedBy(0.dp),
                    ) {
                        if (isLoading && articles.isEmpty()) {
                            item {
                                Column(
                                    modifier = Modifier.fillMaxWidth().padding(40.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                ) {
                                    CircularProgressIndicator()
                                    Text(tr("記事一覧を読み込んでいます…"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        } else if (errorMessage != null) {
                            item { ErrorBanner(errorMessage) { scope.launch { vm.reload() } } }
                        } else if (articles.isEmpty()) {
                            item {
                                Column(
                                    modifier = Modifier.fillMaxWidth().padding(vertical = 40.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.spacedBy(12.dp),
                                ) {
                                    when {
                                        subscriptions.isEmpty() && selectedTagId == null && readFilter == null && !readingListOnly && !bookmarkedOnly -> {
                                            Text(tr("まだ購読がありません。"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                                            TextButton(onClick = onOpenAddFeed) { Text(tr("フィードを追加")) }
                                        }
                                        readingListOnly -> {
                                            Text(tr("リーディングリストに保存した記事はありません。"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                                            TextButton(onClick = {
                                                selectedTagId = null
                                                readingListOnly = false
                                                bookmarkedOnly = false
                                            }) { Text(tr("全ての記事")) }
                                        }
                                        hasFetchingSubscriptionInScope -> {
                                            CircularProgressIndicator()
                                            Text(tr("記事を取得しています…"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                                            TextButton(onClick = { scope.launch { vm.reload() } }) { Text(tr("更新")) }
                                        }
                                        else -> Text(tr("表示できる記事がありません。"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
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
                                    onOpen = {
                                        val url = article.canonicalUrl
                                        if (vm.openInBrowserByDefault && url != null) {
                                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                                        } else {
                                            onOpenArticle(article)
                                        }
                                    },
                                    onToggleRead = { vm.patchState(article, isRead = !article.userState.isRead) },
                                    onToggleReadingList = { vm.patchState(article, inReadingList = !article.userState.inReadingList) },
                                    onToggleBookmark = { vm.patchState(article, isBookmarked = !article.userState.isBookmarked) },
                                    horizontalPadding = 16.dp,
                                )
                                HorizontalDivider()
                                // Feedly-style infinite scroll: fetch the next page near the end.
                                if (index >= (articles.size - 4).coerceAtLeast(0) && nextCursor != null) {
                                    LaunchedEffect(article.id) { vm.loadMore() }
                                }
                            }
                            if (isLoadingMore) {
                                item {
                                    Row(
                                        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                                        horizontalArrangement = Arrangement.Center,
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        CircularProgressIndicator(modifier = Modifier.width(16.dp), strokeWidth = 2.dp)
                                        Text(tr("次の記事を読み込んでいます…"), modifier = Modifier.padding(start = 8.dp))
                                    }
                                }
                            }
                        }
                    }
                }
                vm.refreshNotice?.let { notice ->
                    Surface(
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .padding(16.dp)
                            .fillMaxWidth()
                            .widthIn(max = 480.dp),
                        shape = MaterialTheme.shapes.small,
                        color = MaterialTheme.colorScheme.surface,
                        tonalElevation = 3.dp,
                    ) {
                        Text(
                            notice,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        )
                    }
                }
            }
        }
        }
        if (isDesktop && showDesktopSidebar) {
            PermanentNavigationDrawer(
                drawerContent = {
                    PermanentDrawerSheet(modifier = Modifier.width(280.dp)) {
                        drawerContent(true)
                    }
                },
            ) { mainContent() }
        } else if (!isDesktop && showMobileDrawer) {
            ModalNavigationDrawer(
                drawerState = drawerState,
                drawerContent = {
                    ModalDrawerSheet(modifier = Modifier.fillMaxWidth()) {
                        drawerContent(false)
                    }
                },
            ) { mainContent() }
        } else {
            mainContent()
        }
    }

    if (showRemoveReadArticles) {
        AlertDialog(
            onDismissRequest = { showRemoveReadArticles = false },
            title = { Text(tr("既読の記事をリーディングリストから削除しますか？")) },
            confirmButton = {
                TextButton(onClick = {
                    showRemoveReadArticles = false
                    scope.launch { vm.removeReadArticlesFromReadingList() }
                }) { Text(tr("既読記事を削除"), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { showRemoveReadArticles = false }) { Text(tr("キャンセル")) } },
        )
    }

    if (showShortcutHelp) {
        AlertDialog(
            onDismissRequest = { showShortcutHelp = false },
            title = { Text(tr("ショートカット")) },
            text = {
                Text(
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
                    ).joinToString("\n", transform = AppStrings::get),
                )
            },
            confirmButton = { TextButton(onClick = { showShortcutHelp = false }) { Text(tr("閉じる")) } },
        )
    }
}

@Composable
fun RssSourcesDrawerContent(
    tags: List<Tag>,
    subscriptions: List<Subscription>,
    selectedTagId: Int?,
    readingListOnly: Boolean,
    bookmarkedOnly: Boolean,
    activeRoute: String? = null,
    activeSubscriptionId: Int? = null,
    showCloseButton: Boolean = true,
    onCloseDrawer: () -> Unit,
    onSelectView: (tagId: Int?, readingList: Boolean, bookmarked: Boolean) -> Unit,
    onOpenSubscription: (Int) -> Unit,
    onOpenAddFeed: () -> Unit,
    onOpenAddArticle: () -> Unit,
    onOpenSubscriptions: () -> Unit,
    onOpenTags: () -> Unit,
    onOpenStatus: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    var expandedTags by remember { mutableStateOf<Set<Int>>(emptySet()) }
    var untaggedExpanded by remember { mutableStateOf(false) }
    val noViewFilter = selectedTagId == null && !readingListOnly && !bookmarkedOnly

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(vertical = 12.dp),
    ) {
        if (showCloseButton) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                horizontalArrangement = Arrangement.End,
            ) {
                IconButton(onClick = onCloseDrawer) {
                    FiloIcon(FiloIconName.Close, contentDescription = tr("閉じる"))
                }
            }
        }
        Text(
            "Filo",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
        )
        Button(
            onClick = onOpenAddFeed,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            FiloIcon(FiloIconName.Plus)
            Spacer(modifier = Modifier.width(8.dp))
            Text(tr("フィードを追加"))
        }
        OutlinedButton(
            onClick = onOpenAddArticle,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 0.dp),
        ) {
            FiloIcon(FiloIconName.Plus)
            Spacer(modifier = Modifier.width(8.dp))
            Text(tr("記事を追加"))
        }
        DrawerNavigationRow(
            label = tr("全ての記事"),
            selected = noViewFilter,
            onClick = { onSelectView(null, false, false) },
            icon = { FiloIcon(FiloIconName.List) },
        )
        DrawerNavigationRow(
            label = tr("リーディングリスト"),
            selected = readingListOnly && selectedTagId == null,
            onClick = { onSelectView(null, true, false) },
            icon = { FiloIcon(FiloIconName.QueueAdd) },
        )
        DrawerNavigationRow(
            label = tr("ブックマーク"),
            selected = bookmarkedOnly && selectedTagId == null,
            onClick = { onSelectView(null, false, true) },
            icon = { FiloIcon(FiloIconName.Bookmark) },
        )

        Text(
            tr("フィード"),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 24.dp, top = 16.dp, bottom = 4.dp),
        )
        tags.forEach { tag ->
            val items = subscriptions.filter { it.tagIds.contains(tag.id) }
            val unreadCount = items.sumOf { it.unreadCount }
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = {
                    expandedTags = if (expandedTags.contains(tag.id)) expandedTags - tag.id else expandedTags + tag.id
                }) {
                    FiloIcon(
                        if (expandedTags.contains(tag.id)) FiloIconName.ChevronDown else FiloIconName.ChevronRight,
                        contentDescription = if (expandedTags.contains(tag.id)) tr("折りたたむ") else tr("展開"),
                    )
                }
                DrawerNavigationRow(
                    label = tag.name,
                    count = unreadCount.takeIf { it > 0 },
                    selected = selectedTagId == tag.id,
                    onClick = { onSelectView(tag.id, false, false) },
                    modifier = Modifier.weight(1f),
                )
            }
            if (expandedTags.contains(tag.id)) {
                items.forEach { subscription ->
                    DrawerSubscriptionRow(
                        subscription,
                        selected = activeSubscriptionId == subscription.id,
                        onOpen = { onOpenSubscription(subscription.id) },
                    )
                }
            }
        }
        val untagged = subscriptions.filter { it.tagIds.isEmpty() }
        if (untagged.isNotEmpty()) {
            val unreadCount = untagged.sumOf { it.unreadCount }
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 24.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { untaggedExpanded = !untaggedExpanded }) {
                    FiloIcon(
                        if (untaggedExpanded) FiloIconName.ChevronDown else FiloIconName.ChevronRight,
                        contentDescription = if (untaggedExpanded) tr("折りたたむ") else tr("展開"),
                    )
                }
                Text(tr("タグなし"), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                if (unreadCount > 0) {
                    Text(
                        "$unreadCount",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (untaggedExpanded) {
                untagged.forEach { subscription ->
                    DrawerSubscriptionRow(
                        subscription,
                        selected = activeSubscriptionId == subscription.id,
                        onOpen = { onOpenSubscription(subscription.id) },
                    )
                }
            }
        }

        HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
        DrawerNavigationRow(
            label = tr("購読管理"),
            selected = activeRoute == "subscriptions",
            onClick = onOpenSubscriptions,
            icon = { FiloIcon(FiloIconName.List) },
        )
        DrawerNavigationRow(
            label = tr("タグ管理"),
            selected = activeRoute == "tags",
            onClick = onOpenTags,
            icon = { FiloIcon(FiloIconName.Tag) },
        )
        DrawerNavigationRow(
            label = tr("処理ステータス"),
            selected = activeRoute == "status",
            onClick = onOpenStatus,
            icon = { FiloIcon(FiloIconName.Refresh) },
        )
        DrawerNavigationRow(
            label = tr("設定"),
            selected = activeRoute == "settings",
            onClick = onOpenSettings,
            icon = { FiloIcon(FiloIconName.Gear) },
        )
    }
}

@Composable
private fun DrawerSubscriptionRow(subscription: Subscription, selected: Boolean = false, onOpen: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(6.dp))
            .background(if (selected) MaterialTheme.colorScheme.outlineVariant else Color.Transparent)
            .clickable(onClick = onOpen)
            .padding(start = 40.dp, end = 8.dp, top = 6.dp, bottom = 6.dp)
            .alpha(if (subscription.feedHealthStatus == "stale") 0.7f else 1f),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        FaviconImage(url = subscription.feed.faviconUrl)
        Text(
            subscription.displayTitle,
            modifier = Modifier.weight(1f),
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1,
        )
        if (subscription.initialFetchStatus == "failed" || subscription.feedHealthStatus == "paused") {
            Text("!", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold)
        } else if (subscription.feedHealthStatus == "stale") {
            Text("zz", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (subscription.unreadCount > 0) {
            Text(
                "${subscription.unreadCount}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun DrawerNavigationRow(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    count: Int? = null,
    icon: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(6.dp))
            .background(if (selected) MaterialTheme.colorScheme.outlineVariant else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        icon?.invoke()
        Text(label, modifier = Modifier.weight(1f), maxLines = 1)
        count?.let {
            Text(
                "$it",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
