package com.filo.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.focusable
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDrawerState
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Tune
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
    initialSelectedTagId: Int? = null,
    onInitialSelectedTagConsumed: () -> Unit = {},
    onOpenSubscription: (Int) -> Unit,
    onOpenSubscriptions: () -> Unit,
    onOpenAddFeed: () -> Unit,
    onOpenAddArticle: () -> Unit,
    onOpenArticle: (ArticleListItem) -> Unit,
    onOpenTags: () -> Unit,
    onOpenStatus: () -> Unit,
    onOpenSettings: () -> Unit,
    onStartReading: (Boolean) -> Unit,
) {
    val vm: ArticlesViewModel = viewModel()
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
    var optionsMenuOpen by remember { mutableStateOf(false) }
    var articleOptionsMenuOpen by remember { mutableStateOf(false) }
    var showMarkAllRead by remember { mutableStateOf(false) }
    var showRemoveReadArticles by remember { mutableStateOf(false) }
    var isPullRefreshing by remember { mutableStateOf(false) }
    var selectedArticleIndex by remember { mutableStateOf(0) }
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
        val headerCount = if (vm.refreshNotice != null) 1 else 0
        val articleListIndex = index + headerCount
        val targetIndex = (articleListIndex - ARTICLE_SELECTION_BUFFER).coerceAtLeast(headerCount)
        scope.launch { listState.animateScrollToItem(targetIndex) }
    }
    LaunchedEffect(articles.size) {
        selectedArticleIndex = selectedArticleIndex.coerceIn(0, (articles.size - 1).coerceAtLeast(0))
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
        selectedTagId != null -> tags.firstOrNull { it.id == selectedTagId }?.name ?: "タグ"
        readingListOnly -> "リーディングリスト"
        bookmarkedOnly -> "ブックマーク"
        else -> "全ての記事"
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

    ModalNavigationDrawer(
        modifier = Modifier
            .focusRequester(focusRequester)
            .focusable()
            .onPreviewKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                val hasModifier = event.isCtrlPressed || event.isAltPressed || event.isMetaPressed
                if (event.isShiftPressed && event.key == Key.A && !hasModifier) {
                    if (!bookmarkedOnly && !readingListOnly) showMarkAllRead = true
                    true
                } else if (hasModifier) {
                    false
                } else {
                    when (event.key) {
                        Key.J, Key.DirectionDown -> {
                            if (articles.isNotEmpty()) {
                                val nextIndex = (selectedArticleIndex + 1).coerceAtMost(articles.lastIndex)
                                selectedArticleIndex = nextIndex
                                scrollToSelectedArticle(nextIndex)
                            }
                            true
                        }
                        Key.K, Key.DirectionUp -> {
                            val nextIndex = (selectedArticleIndex - 1).coerceAtLeast(0)
                            selectedArticleIndex = nextIndex
                            scrollToSelectedArticle(nextIndex)
                            true
                        }
                        Key.Enter, Key.O -> {
                            articles.getOrNull(selectedArticleIndex)?.let(onOpenArticle)
                            true
                        }
                        Key.V -> {
                            articles.getOrNull(selectedArticleIndex)?.canonicalUrl?.let {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it)))
                            }
                            true
                        }
                        Key.M -> {
                            articles.getOrNull(selectedArticleIndex)?.let { vm.patchState(it, isRead = !it.userState.isRead) }
                            true
                        }
                        Key.S -> {
                            articles.getOrNull(selectedArticleIndex)?.let { vm.patchState(it, inReadingList = !it.userState.inReadingList) }
                            true
                        }
                        Key.B -> {
                            articles.getOrNull(selectedArticleIndex)?.let { vm.patchState(it, isBookmarked = !it.userState.isBookmarked) }
                            true
                        }
                        Key.R -> {
                            scope.launch { vm.refreshFeedsAndReload() }
                            true
                        }
                        Key.Slash -> {
                            showShortcutHelp = true
                            true
                        }
                        Key.Escape -> {
                            scope.launch { drawerState.close() }
                            true
                        }
                        else -> false
                    }
                }
            },
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet {
                SourcesDrawerContent(
                    tags = tags,
                    subscriptions = subscriptions,
                    selectedTagId = selectedTagId,
                    readingListOnly = readingListOnly,
                    bookmarkedOnly = bookmarkedOnly,
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
        },
    ) {
        Scaffold(
            topBar = {
                Column {
                    TopAppBar(
                        title = { Text(viewTitle) },
                        navigationIcon = {
                            IconButton(onClick = {
                                scope.launch { drawerState.open() }
                            }) {
                                Icon(
                                    Icons.Default.Menu,
                                    contentDescription = "フィードメニュー",
                                )
                            }
                        },
                        actions = {
                            if (readingListOnly) {
                                IconButton(onClick = { showRemoveReadArticles = true }) {
                                    Icon(Icons.Default.Delete, contentDescription = "既読記事を削除")
                                }
                                TextButton(onClick = { onStartReading(false) }) { Text("閲覧開始") }
                            }
                            if (!bookmarkedOnly && !readingListOnly) {
                                IconButton(onClick = { showMarkAllRead = true }) {
                                    Icon(Icons.Default.CheckCircle, contentDescription = "すべて既読にする")
                                }
                            }
                            Box {
                                IconButton(onClick = { articleOptionsMenuOpen = true }) {
                                    Icon(Icons.Default.Tune, contentDescription = "表示設定")
                                }
                                DropdownMenu(expanded = articleOptionsMenuOpen, onDismissRequest = { articleOptionsMenuOpen = false }) {
                                    if (translations.isSupported) {
                                        DropdownMenuItem(
                                            text = { Text(if (translations.isEnabled) "翻訳（オン）" else "翻訳（オフ）") },
                                            onClick = { translations.toggle(); articleOptionsMenuOpen = false },
                                        )
                                    }
                                    DropdownMenuItem(enabled = false, text = { Text("既読状態") }, onClick = {})
                                    DropdownMenuItem(text = { Text("全ての記事") }, onClick = { readFilter = null; articleOptionsMenuOpen = false })
                                    DropdownMenuItem(text = { Text("未読") }, onClick = { readFilter = false; articleOptionsMenuOpen = false })
                                    DropdownMenuItem(text = { Text("既読") }, onClick = { readFilter = true; articleOptionsMenuOpen = false })
                                    DropdownMenuItem(enabled = false, text = { Text("並び順") }, onClick = {})
                                    DropdownMenuItem(text = { Text("公開日時が新しい順") }, onClick = { sort = "published_at_desc"; articleOptionsMenuOpen = false })
                                    DropdownMenuItem(text = { Text("取得日時が新しい順") }, onClick = { sort = "fetched_at_desc"; articleOptionsMenuOpen = false })
                                    DropdownMenuItem(enabled = false, text = { Text("既読の扱い") }, onClick = {})
                                    DropdownMenuItem(text = { Text("既読で並び替えない") }, onClick = { readOrder = "none"; articleOptionsMenuOpen = false })
                                    DropdownMenuItem(text = { Text("既読は下") }, onClick = { readOrder = "unread_first"; articleOptionsMenuOpen = false })
                                    DropdownMenuItem(text = { Text("既読は上") }, onClick = { readOrder = "read_first"; articleOptionsMenuOpen = false })
                                }
                            }
                            Box {
                                IconButton(onClick = { optionsMenuOpen = true }) {
                                    Icon(Icons.Default.MoreVert, contentDescription = "メニュー")
                                }
                                DropdownMenu(expanded = optionsMenuOpen, onDismissRequest = { optionsMenuOpen = false }) {
                                DropdownMenuItem(
                                    text = { Text("購読管理") },
                                    onClick = {
                                        optionsMenuOpen = false
                                        onOpenSubscriptions()
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("タグ管理") },
                                    onClick = {
                                        optionsMenuOpen = false
                                        onOpenTags()
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("処理ステータス") },
                                    onClick = {
                                        optionsMenuOpen = false
                                        onOpenStatus()
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("設定") },
                                    onClick = {
                                        optionsMenuOpen = false
                                        onOpenSettings()
                                    },
                                )
                                }
                            }
                        },
                    )
                }
            },
            floatingActionButton = {
                FloatingActionButton(onClick = onOpenAddFeed) {
                    Icon(Icons.Default.Add, contentDescription = "フィード追加")
                }
            },
        ) { innerPadding ->
            PullToRefreshBox(
                isRefreshing = isPullRefreshing || vm.isRefreshingFeeds,
                onRefresh = {
                    scope.launch {
                        isPullRefreshing = true
                        vm.refreshFeedsAndReload()
                        isPullRefreshing = false
                    }
                },
                modifier = Modifier.fillMaxSize().padding(innerPadding),
            ) {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                .padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(0.dp),
            ) {
                vm.refreshNotice?.let { notice ->
                    item {
                        Text(
                            notice,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 4.dp),
                        )
                    }
                }
                if (isLoading && articles.isEmpty()) {
                    item {
                        Column(
                            modifier = Modifier.fillMaxWidth().padding(40.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) { CircularProgressIndicator() }
                    }
                } else if (errorMessage != null && articles.isEmpty()) {
                    item { ErrorBanner(errorMessage!!) { scope.launch { vm.reload() } } }
                } else if (articles.isEmpty()) {
                    item {
                        Column(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 40.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            when {
                                subscriptions.isEmpty() && selectedTagId == null && readFilter == null && !readingListOnly && !bookmarkedOnly -> {
                                    Text("まだ購読がありません。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Button(onClick = onOpenAddFeed) { Text("フィードを追加して始めましょう") }
                                }
                                readingListOnly -> Text("リーディングリストに保存した記事はありません。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                bookmarkedOnly -> Text("ブックマークした記事はありません。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                readFilter == false -> Text("未読の記事はありません。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                readFilter == true -> Text("既読の記事はありません。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                hasFetchingSubscriptionInScope -> {
                                    CircularProgressIndicator()
                                    Text("記事を取得しています…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    TextButton(onClick = { scope.launch { vm.reload() } }) { Text("更新") }
                                }
                                else -> Text("表示できる記事がありません。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                } else {
                    items(articles, key = { it.id }) { article ->
                        ArticleRow(
                            article = article,
                            selected = articles.indexOfFirst { it.id == article.id } == selectedArticleIndex,
                            translations = translations,
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
                        )
                        HorizontalDivider()
                        // Feedly-style infinite scroll: fetch the next page near the end.
                        if (article.id == articles.last().id && nextCursor != null) {
                            LaunchedEffect(article.id) { vm.loadMore() }
                        }
                    }
                    if (nextCursor != null) {
                        item {
                            TextButton(
                                modifier = Modifier.fillMaxWidth(),
                                enabled = !isLoadingMore,
                                onClick = { vm.loadMore() },
                            ) { Text(if (isLoadingMore) "読み込み中…" else "さらに読み込む") }
                        }
                    }
                }
            }
            }
        }
    }

    if (showMarkAllRead) {
        val scopeLabel = selectedTagId
            ?.let { id -> tags.firstOrNull { it.id == id } }
            ?.let { "タグ「${it.name}」のフィード" }
            ?: "すべての購読"
        AlertDialog(
            onDismissRequest = { showMarkAllRead = false },
            title = { Text("${scopeLabel}の記事をすべて既読にしますか？") },
            confirmButton = {
                TextButton(onClick = {
                    showMarkAllRead = false
                    scope.launch { vm.markAllRead() }
                }) { Text("すべて既読にする") }
            },
            dismissButton = { TextButton(onClick = { showMarkAllRead = false }) { Text("キャンセル") } },
        )
    }

    if (showRemoveReadArticles) {
        AlertDialog(
            onDismissRequest = { showRemoveReadArticles = false },
            title = { Text("既読の記事をリーディングリストから削除しますか？") },
            confirmButton = {
                TextButton(onClick = {
                    showRemoveReadArticles = false
                    scope.launch { vm.removeReadArticlesFromReadingList() }
                }) { Text("既読記事を削除", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { showRemoveReadArticles = false }) { Text("キャンセル") } },
        )
    }

    if (showShortcutHelp) {
        AlertDialog(
            onDismissRequest = { showShortcutHelp = false },
            title = { Text("ショートカット") },
            text = {
                Text("J / ↓  次の記事\nK / ↑  前の記事\nEnter / O  記事を開く\nV  元記事を開く\nM  既読／未読\nS  リーディングリスト\nB  ブックマーク\nR  更新\nShift+A  すべて既読\nSpace  読み上げ")
            },
            confirmButton = { TextButton(onClick = { showShortcutHelp = false }) { Text("閉じる") } },
        )
    }
}

@Composable
private fun SourcesDrawerContent(
    tags: List<Tag>,
    subscriptions: List<Subscription>,
    selectedTagId: Int?,
    readingListOnly: Boolean,
    bookmarkedOnly: Boolean,
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
        Text(
            "Filo",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
        )
        OutlinedButton(
            onClick = onOpenAddFeed,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp),
        ) {
            Icon(Icons.Default.Add, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("フィードを追加")
        }
        OutlinedButton(
            onClick = onOpenAddArticle,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 0.dp),
        ) {
            Icon(Icons.Default.Add, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("記事を追加")
        }
        NavigationDrawerItem(
            label = { Text("全ての記事") },
            icon = { Icon(Icons.AutoMirrored.Filled.List, contentDescription = null) },
            selected = noViewFilter,
            onClick = { onSelectView(null, false, false) },
            modifier = Modifier.padding(horizontal = 12.dp),
        )
        NavigationDrawerItem(
            label = { Text("リーディングリスト") },
            icon = { Icon(Icons.AutoMirrored.Filled.List, contentDescription = null) },
            selected = readingListOnly && selectedTagId == null,
            onClick = { onSelectView(null, true, false) },
            modifier = Modifier.padding(horizontal = 12.dp),
        )
        NavigationDrawerItem(
            label = { Text("ブックマーク") },
            icon = { Icon(Icons.Default.BookmarkBorder, contentDescription = null) },
            selected = bookmarkedOnly && selectedTagId == null,
            onClick = { onSelectView(null, false, true) },
            modifier = Modifier.padding(horizontal = 12.dp),
        )

        Text(
            "フィード",
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 24.dp, top = 16.dp, bottom = 4.dp),
        )
        tags.forEach { tag ->
            val items = subscriptions.filter { it.tagIds.contains(tag.id) }
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = {
                    expandedTags = if (expandedTags.contains(tag.id)) expandedTags - tag.id else expandedTags + tag.id
                }) {
                    Icon(
                        if (expandedTags.contains(tag.id)) Icons.Default.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = if (expandedTags.contains(tag.id)) "折りたたむ" else "展開",
                    )
                }
                NavigationDrawerItem(
                    label = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(tag.name, modifier = Modifier.weight(1f))
                            Text(
                                "${items.sumOf { it.unreadCount }}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    },
                    selected = selectedTagId == tag.id,
                    onClick = { onSelectView(tag.id, false, false) },
                    modifier = Modifier.weight(1f),
                )
            }
            if (expandedTags.contains(tag.id)) {
                items.forEach { subscription ->
                    DrawerSubscriptionRow(subscription, onOpen = { onOpenSubscription(subscription.id) })
                }
            }
        }
        val untagged = subscriptions.filter { it.tagIds.isEmpty() }
        if (untagged.isNotEmpty()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 24.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { untaggedExpanded = !untaggedExpanded }) {
                    Icon(
                        if (untaggedExpanded) Icons.Default.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = if (untaggedExpanded) "折りたたむ" else "展開",
                    )
                }
                Text("タグなし", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                Text(
                    "${untagged.sumOf { it.unreadCount }}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (untaggedExpanded) {
                untagged.forEach { subscription ->
                    DrawerSubscriptionRow(subscription, onOpen = { onOpenSubscription(subscription.id) })
                }
            }
        }

        HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
        NavigationDrawerItem(
            label = { Text("購読管理") },
            icon = { Icon(Icons.AutoMirrored.Filled.List, contentDescription = null) },
            selected = false,
            onClick = onOpenSubscriptions,
            modifier = Modifier.padding(horizontal = 12.dp),
        )
        NavigationDrawerItem(
            label = { Text("タグ管理") },
            icon = { Icon(Icons.Default.Sell, contentDescription = null) },
            selected = false,
            onClick = onOpenTags,
            modifier = Modifier.padding(horizontal = 12.dp),
        )
        NavigationDrawerItem(
            label = { Text("処理ステータス") },
            icon = { Icon(Icons.Default.Refresh, contentDescription = null) },
            selected = false,
            onClick = onOpenStatus,
            modifier = Modifier.padding(horizontal = 12.dp),
        )
        NavigationDrawerItem(
            label = { Text("設定") },
            icon = { Icon(Icons.Default.Settings, contentDescription = null) },
            selected = false,
            onClick = onOpenSettings,
            modifier = Modifier.padding(horizontal = 12.dp),
        )
    }
}

@Composable
private fun DrawerSubscriptionRow(subscription: Subscription, onOpen: () -> Unit) {
    NavigationDrawerItem(
        label = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                FaviconImage(url = subscription.feed.faviconUrl, siteUrl = subscription.feed.siteUrl)
                Text(subscription.displayTitle, modifier = Modifier.weight(1f), maxLines = 1)
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
        },
        selected = false,
        onClick = onOpen,
        modifier = Modifier.padding(start = 48.dp, end = 12.dp),
    )
}
