package com.filo.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.filo.app.api.ApiClient
import com.filo.app.api.ErrorMessages
import com.filo.app.api.Subscription
import com.filo.app.api.Tag
import kotlinx.coroutines.launch

@Composable
fun SubscriptionHealthBadge(subscription: Subscription) {
    when {
        subscription.initialFetchStatus == "failed" ->
            StatusBadge(ErrorMessages.initialFetchMessage(subscription.initialFetchErrorCode), BadgeTone.Danger)
        subscription.initialFetchStatus == "fetching" -> StatusBadge("記事取得中")
        subscription.feedHealthStatus == "paused" -> StatusBadge("更新停止中", BadgeTone.Danger)
        subscription.feedHealthStatus == "stale" -> StatusBadge("しばらく更新なし", BadgeTone.Warn)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SubscriptionsScreen(
    onBack: () -> Unit,
    onOpenSubscription: (Int) -> Unit,
    onOpenAddFeed: () -> Unit,
    onOpenTags: () -> Unit,
    onOpenSettings: () -> Unit,
    onSelectTag: (Int) -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    var subscriptions by remember { mutableStateOf<List<Subscription>>(emptyList()) }
    var tags by remember { mutableStateOf<List<Tag>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var collapsed by remember { mutableStateOf<Set<Int>>(emptySet()) }
    var renamingTag by remember { mutableStateOf<Tag?>(null) }
    var renameText by remember { mutableStateOf("") }

    suspend fun reload() {
        isLoading = true
        errorMessage = null
        try {
            subscriptions = ApiClient.listSubscriptions()
            tags = ApiClient.listTags()
        } catch (e: Exception) {
            errorMessage = ErrorMessages.forError(e)
        }
        isLoading = false
    }

    LaunchedEffect(Unit) { reload() }

    fun updateSubscriptionTags(subscriptionId: Int, tagIds: List<Int>) {
        scope.launch {
            try {
                val updated = ApiClient.setSubscriptionTags(subscriptionId, tagIds)
                subscriptions = subscriptions.map { if (it.id == subscriptionId) updated else it }
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forError(e)
            }
        }
    }

    fun move(subscriptionId: Int, direction: Int) {
        val index = subscriptions.indexOfFirst { it.id == subscriptionId }
        val target = index + direction
        if (index < 0 || target < 0 || target >= subscriptions.size) return
        val next = subscriptions.toMutableList()
        val item = next.removeAt(index)
        next.add(target, item)
        subscriptions = next
        scope.launch {
            try {
                ApiClient.reorderSubscriptions(next.map { it.id })
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forError(e)
                reload()
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("購読一覧") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "戻る")
                    }
                },
                actions = {
                    IconButton(onClick = onOpenAddFeed) { Icon(Icons.Default.Add, contentDescription = "フィード追加") }
                    TextButton(onClick = onOpenTags) { Text("タグ") }
                    IconButton(onClick = onOpenSettings) { Icon(Icons.Default.Settings, contentDescription = "設定") }
                },
            )
        },
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 16.dp),
        ) {
            if (isLoading) {
                item {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(40.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) { CircularProgressIndicator() }
                }
            } else if (errorMessage != null && subscriptions.isEmpty()) {
                item { ErrorBanner(errorMessage!!) { scope.launch { reload() } } }
            } else if (subscriptions.isEmpty()) {
                item {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 40.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text("まだ購読がありません。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Button(onClick = onOpenAddFeed) { Text("フィードを追加して始めましょう") }
                    }
                }
            } else {
                val groups = tags.map { tag ->
                    Triple(tag, subscriptions.filter { it.tagIds.contains(tag.id) }, tag.id)
                }.filter { it.second.isNotEmpty() }
                groups.forEach { (tag, items, key) ->
                    item(key = "tag-$key") {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            IconButton(onClick = {
                                collapsed = if (collapsed.contains(key)) collapsed - key else collapsed + key
                            }) {
                                Icon(
                                    if (collapsed.contains(key)) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                                    contentDescription = null,
                                )
                            }
                            // タグ名タップでタグ絞り込み済み記事一覧へ遷移する (SCREENS.md)
                            Text(
                                tag.name,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.weight(1f).clickable { onSelectTag(tag.id) },
                            )
                            TextButton(onClick = {
                                renameText = tag.name
                                renamingTag = tag
                            }) { Text("名前変更") }
                        }
                    }
                    if (!collapsed.contains(key)) {
                        items(items, key = { "sub-$key-${it.id}" }) { subscription ->
                            SubscriptionListRow(subscription, allTags = tags, onOpen = { onOpenSubscription(subscription.id) }, onMove = ::move, onTagsChange = ::updateSubscriptionTags)
                            HorizontalDivider()
                        }
                    }
                }
                val untagged = subscriptions.filter { it.tagIds.isEmpty() }
                if (untagged.isNotEmpty()) {
                    item(key = "untagged-header") {
                        Text(
                            "タグなし",
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(top = 16.dp, bottom = 8.dp),
                        )
                    }
                    items(untagged, key = { "sub-untagged-${it.id}" }) { subscription ->
                        SubscriptionListRow(subscription, allTags = tags, onOpen = { onOpenSubscription(subscription.id) }, onMove = ::move, onTagsChange = ::updateSubscriptionTags)
                        HorizontalDivider()
                    }
                }
            }
        }
    }

    renamingTag?.let { tag ->
        AlertDialog(
            onDismissRequest = { renamingTag = null },
            title = { Text("タグ名を変更") },
            text = {
                OutlinedTextField(value = renameText, onValueChange = { renameText = it }, singleLine = true)
            },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        try {
                            ApiClient.updateTag(tag.id, renameText)
                            reload()
                        } catch (e: Exception) {
                            errorMessage = ErrorMessages.forError(e)
                        }
                    }
                    renamingTag = null
                }) { Text("変更") }
            },
            dismissButton = { TextButton(onClick = { renamingTag = null }) { Text("キャンセル") } },
        )
    }
}

@Composable
private fun SubscriptionListRow(
    subscription: Subscription,
    allTags: List<Tag>,
    onOpen: () -> Unit,
    onMove: (Int, Int) -> Unit,
    onTagsChange: (Int, List<Int>) -> Unit,
) {
    var tagMenuOpen by remember { mutableStateOf(false) }

    Surface(onClick = onOpen, color = Color.Transparent, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FaviconImage(url = subscription.feed.faviconUrl, siteUrl = subscription.feed.siteUrl)
            Column(modifier = Modifier.weight(1f).padding(start = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(subscription.displayTitle, fontWeight = FontWeight.Medium)
                Text(
                    "最終公開 ${subscription.feed.latestPublishedAt?.let(::relativeTime).takeUnless { it.isNullOrEmpty() } ?: "—"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                SubscriptionHealthBadge(subscription)
            }
            if (allTags.isNotEmpty()) {
                Box {
                    IconButton(onClick = { tagMenuOpen = true }) {
                        Icon(Icons.Default.Sell, contentDescription = "タグを編集", modifier = Modifier.size(18.dp))
                    }
                    DropdownMenu(expanded = tagMenuOpen, onDismissRequest = { tagMenuOpen = false }) {
                        allTags.forEach { tag ->
                            DropdownMenuItem(
                                text = {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Checkbox(
                                            checked = subscription.tagIds.contains(tag.id),
                                            onCheckedChange = null,
                                        )
                                        if (tag.color != null) {
                                            Box(
                                                modifier = Modifier
                                                    .size(10.dp)
                                                    .background(Color(android.graphics.Color.parseColor(tag.color)), CircleShape),
                                            )
                                        }
                                        Text(tag.name)
                                    }
                                },
                                onClick = {
                                    val next = if (subscription.tagIds.contains(tag.id)) {
                                        subscription.tagIds - tag.id
                                    } else {
                                        subscription.tagIds + tag.id
                                    }
                                    onTagsChange(subscription.id, next)
                                },
                            )
                        }
                    }
                }
            }
            IconButton(onClick = { onMove(subscription.id, -1) }) {
                Icon(Icons.Default.KeyboardArrowUp, contentDescription = "上へ")
            }
            IconButton(onClick = { onMove(subscription.id, 1) }) {
                Icon(Icons.Default.KeyboardArrowDown, contentDescription = "下へ")
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddFeedScreen(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf("") }
    var tags by remember { mutableStateOf<List<Tag>>(emptyList()) }
    var selectedTagIds by remember { mutableStateOf<Set<Int>>(emptySet()) }
    var newTagNames by remember { mutableStateOf("") }
    var isSubmitting by remember { mutableStateOf(false) }
    var isRetrying by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var created by remember { mutableStateOf<Subscription?>(null) }

    LaunchedEffect(Unit) {
        runCatching { tags = ApiClient.listTags() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("フィード追加") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "戻る")
                    }
                },
            )
        },
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text("RSS/Atom URL または サイトURL") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (tags.isNotEmpty()) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("タグ", style = MaterialTheme.typography.labelLarge)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            tags.forEach { tag ->
                                FilterChipButton(tag.name, selectedTagIds.contains(tag.id)) {
                                    selectedTagIds = if (selectedTagIds.contains(tag.id)) {
                                        selectedTagIds - tag.id
                                    } else {
                                        selectedTagIds + tag.id
                                    }
                                }
                            }
                        }
                    }
                }
            }
            item {
                OutlinedTextField(
                    value = newTagNames,
                    onValueChange = { newTagNames = it },
                    label = { Text("新規タグ（カンマ区切り）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Button(
                    enabled = !isSubmitting && url.isNotBlank(),
                    onClick = {
                        scope.launch {
                            isSubmitting = true
                            errorMessage = null
                            created = null
                            try {
                                created = ApiClient.createSubscription(
                                    feedUrl = url.trim(),
                                    tagIds = selectedTagIds.toList(),
                                    tagNames = newTagNames.split(",", "、").map { it.trim() }.filter { it.isNotEmpty() },
                                )
                            } catch (e: Exception) {
                                errorMessage = ErrorMessages.forError(e)
                            }
                            isSubmitting = false
                        }
                    },
                ) { Text(if (isSubmitting) "フィードを確認中…" else "追加") }
            }
            errorMessage?.let { message ->
                item { ErrorBanner(message) }
            }
            created?.let { subscription ->
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(subscription.displayTitle, fontWeight = FontWeight.SemiBold)
                        when (subscription.initialFetchStatus) {
                            "ready" -> {
                                StatusBadge("追加完了", BadgeTone.Ok)
                                Text("記事の取得が完了しています。")
                            }
                            "fetching" -> {
                                StatusBadge("記事取得中")
                                Text("購読の追加は完了しました。記事を取得しています。")
                            }
                            else -> {
                                StatusBadge("初回取得失敗", BadgeTone.Danger)
                                Text("購読は作成されましたが、${ErrorMessages.initialFetchMessage(subscription.initialFetchErrorCode)}")
                                Button(
                                    enabled = !isRetrying,
                                    onClick = {
                                        scope.launch {
                                            isRetrying = true
                                            try {
                                                created = ApiClient.retryInitialFetch(subscription.id)
                                            } catch (e: Exception) {
                                                errorMessage = ErrorMessages.forError(e)
                                            }
                                            isRetrying = false
                                        }
                                    },
                                ) { Text(if (isRetrying) "再試行中…" else "再試行") }
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TagsScreen(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var tags by remember { mutableStateOf<List<Tag>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var newName by remember { mutableStateOf("") }
    var renamingTag by remember { mutableStateOf<Tag?>(null) }
    var renameText by remember { mutableStateOf("") }
    var deletingTag by remember { mutableStateOf<Tag?>(null) }
    var editingTagId by remember { mutableStateOf<Int?>(null) }
    var editName by remember { mutableStateOf("") }
    var editColor by remember { mutableStateOf("") }

    suspend fun reload() {
        isLoading = true
        errorMessage = null
        try {
            tags = ApiClient.listTags()
        } catch (e: Exception) {
            errorMessage = ErrorMessages.forError(e)
        }
        isLoading = false
    }

    LaunchedEffect(Unit) { reload() }

    fun move(tagId: Int, direction: Int) {
        val index = tags.indexOfFirst { it.id == tagId }
        val target = index + direction
        if (index < 0 || target < 0 || target >= tags.size) return
        val next = tags.toMutableList()
        val item = next.removeAt(index)
        next.add(target, item)
        tags = next
        scope.launch {
            runCatching { ApiClient.reorderTags(next.map { it.id }) }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("タグ管理") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "戻る")
                    }
                },
            )
        },
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = newName,
                        onValueChange = { newName = it },
                        label = { Text("新しいタグ名") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    Button(
                        enabled = newName.isNotBlank(),
                        onClick = {
                            scope.launch {
                                try {
                                    ApiClient.createTag(newName.trim())
                                    newName = ""
                                    reload()
                                } catch (e: Exception) {
                                    errorMessage = ErrorMessages.forError(e)
                                }
                            }
                        },
                    ) { Text("追加") }
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
            } else if (tags.isEmpty()) {
                item {
                    Text(
                        "タグがありません。上の入力欄から作成できます。",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = 40.dp),
                    )
                }
            } else {
                items(tags, key = { it.id }) { tag ->
                    if (editingTagId == tag.id) {
                        Column(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            OutlinedTextField(
                                value = editName,
                                onValueChange = { editName = it },
                                label = { Text("タグ名") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                OutlinedTextField(
                                    value = editColor,
                                    onValueChange = { editColor = it },
                                    label = { Text("色 (#hex)") },
                                    singleLine = true,
                                    modifier = Modifier.weight(1f),
                                )
                                if (editColor.isNotBlank()) {
                                    val parsed = runCatching { android.graphics.Color.parseColor(editColor) }.getOrNull()
                                    if (parsed != null) {
                                        Box(
                                            modifier = Modifier
                                                .size(24.dp)
                                                .background(Color(parsed), CircleShape),
                                        )
                                    }
                                    TextButton(onClick = { editColor = "" }) { Text("解除") }
                                }
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(onClick = {
                                    scope.launch {
                                        try {
                                            val newColor = editColor.trim().ifEmpty { null }
                                            ApiClient.updateTag(
                                                tag.id,
                                                editName.trim(),
                                                color = newColor,
                                                clearColor = newColor == null && tag.color != null,
                                            )
                                            editingTagId = null
                                            reload()
                                        } catch (e: Exception) {
                                            errorMessage = ErrorMessages.forError(e)
                                        }
                                    }
                                }) { Text("保存") }
                                OutlinedButton(onClick = { editingTagId = null }) { Text("キャンセル") }
                            }
                        }
                    } else {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            if (tag.color != null) {
                                val parsed = runCatching { android.graphics.Color.parseColor(tag.color) }.getOrNull()
                                if (parsed != null) {
                                    Box(
                                        modifier = Modifier
                                            .size(12.dp)
                                            .background(Color(parsed), CircleShape),
                                    )
                                }
                            }
                            Column(modifier = Modifier.weight(1f).padding(start = if (tag.color != null) 8.dp else 0.dp)) {
                                Text(tag.name)
                                Text(
                                    "${tag.subscriptionCount}件の購読",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            IconButton(onClick = { move(tag.id, -1) }) {
                                Icon(Icons.Default.KeyboardArrowUp, contentDescription = "上へ")
                            }
                            IconButton(onClick = { move(tag.id, 1) }) {
                                Icon(Icons.Default.KeyboardArrowDown, contentDescription = "下へ")
                            }
                            TextButton(onClick = {
                                editingTagId = tag.id
                                editName = tag.name
                                editColor = tag.color ?: ""
                            }) { Text("編集") }
                            TextButton(onClick = { deletingTag = tag }) {
                                Text("削除", color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                    HorizontalDivider()
                }
            }
        }
    }

    renamingTag?.let { tag ->
        AlertDialog(
            onDismissRequest = { renamingTag = null },
            title = { Text("タグ名を変更") },
            text = { OutlinedTextField(value = renameText, onValueChange = { renameText = it }, singleLine = true) },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        try {
                            ApiClient.updateTag(tag.id, renameText)
                            reload()
                        } catch (e: Exception) {
                            errorMessage = ErrorMessages.forError(e)
                        }
                    }
                    renamingTag = null
                }) { Text("変更") }
            },
            dismissButton = { TextButton(onClick = { renamingTag = null }) { Text("キャンセル") } },
        )
    }

    deletingTag?.let { tag ->
        AlertDialog(
            onDismissRequest = { deletingTag = null },
            title = { Text("タグ「${tag.name}」を削除しますか？") },
            text = { Text("購読は削除されません。") },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        try {
                            ApiClient.deleteTag(tag.id)
                            reload()
                        } catch (e: Exception) {
                            errorMessage = ErrorMessages.forError(e)
                        }
                    }
                    deletingTag = null
                }) { Text("削除", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { deletingTag = null }) { Text("キャンセル") } },
        )
    }
}
