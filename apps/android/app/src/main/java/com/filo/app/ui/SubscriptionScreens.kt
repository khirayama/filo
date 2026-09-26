package com.filo.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.filo.app.api.ApiClient
import com.filo.app.api.ErrorMessages
import com.filo.app.api.Subscription
import com.filo.app.api.Tag
import kotlinx.coroutines.launch

// Rows nested under a group's disclosure button start where the group label
// does (web `--fl-disclosure-indent` on touch screens).
private val DisclosureIndent = 48.dp

@Composable
fun SubscriptionsScreen(
    onOpenMenu: (() -> Unit)?,
    onOpenSubscription: (Int) -> Unit,
    onOpenAddFeed: () -> Unit,
    onOpenTags: () -> Unit,
    onSelectTag: (Int) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var subscriptions by remember { mutableStateOf<List<Subscription>>(emptyList()) }
    var tags by remember { mutableStateOf<List<Tag>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<AppText?>(null) }
    var collapsed by remember { mutableStateOf<Set<Int>>(emptySet()) }
    var renamingTag by remember { mutableStateOf<Tag?>(null) }
    var renameText by remember { mutableStateOf("") }
    var isReordering by remember { mutableStateOf(false) }

    suspend fun reload() {
        isLoading = true
        errorMessage = null
        try {
            subscriptions = ApiClient.listSubscriptions()
            tags = ApiClient.listTags()
        } catch (e: Exception) {
            errorMessage = ErrorMessages.forErrorText(e)
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
                errorMessage = ErrorMessages.forErrorText(e)
            }
        }
    }

    fun move(subscriptionId: Int, direction: Int, groupSubscriptionIds: List<Int>) {
        if (isReordering) return
        val groupIndex = groupSubscriptionIds.indexOf(subscriptionId)
        val targetGroupIndex = groupIndex + direction
        if (groupIndex < 0 || targetGroupIndex !in groupSubscriptionIds.indices) return

        val targetSubscriptionId = groupSubscriptionIds[targetGroupIndex]
        val index = subscriptions.indexOfFirst { it.id == subscriptionId }
        val target = subscriptions.indexOfFirst { it.id == targetSubscriptionId }
        if (index < 0 || target < 0) return
        val next = subscriptions.toMutableList()
        val item = next[index]
        next[index] = next[target]
        next[target] = item
        subscriptions = next
        isReordering = true
        scope.launch {
            try {
                ApiClient.reorderSubscriptions(next.map { it.id })
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forErrorText(e)
                reload()
            }
            isReordering = false
        }
    }

    fun moveTag(tagId: Int, direction: Int) {
        val index = tags.indexOfFirst { it.id == tagId }
        val target = index + direction
        if (index < 0 || target !in tags.indices) return
        val next = tags.toMutableList()
        val item = next.removeAt(index)
        next.add(target, item)
        tags = next
        scope.launch {
            try {
                ApiClient.reorderTags(next.map { it.id })
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forErrorText(e)
                reload()
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        FiloHeader(
            title = tr("購読管理"),
            lead = if (onOpenMenu != null) HeaderLead.Menu else HeaderLead.None,
            onLead = { onOpenMenu?.invoke() },
        ) {
            FiloIconButton(FiloIconName.Tag, tr("タグ管理"), onOpenTags)
            FiloIconButton(FiloIconName.Plus, tr("フィードを追加"), onOpenAddFeed)
        }
        LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PagePadding) {
            when {
                isLoading -> item { FiloSpinner() }
                errorMessage != null -> item { FiloErrorBox(tr(errorMessage!!)) { scope.launch { reload() } } }
                subscriptions.isEmpty() -> item {
                    FiloEmptyState(tr("まだ購読がありません。"), FiloIconName.Rss) {
                        FiloButton(tr("フィードを追加"), onOpenAddFeed, kind = ButtonKind.Primary)
                    }
                }
                else -> {
                    val groups = tags.map { tag -> tag to subscriptions.filter { it.tagIds.contains(tag.id) } } +
                        listOf<Pair<Tag?, List<Subscription>>>(null to subscriptions.filter { it.tagIds.isEmpty() })
                    var first = true
                    groups.forEach { (tag, items) ->
                        if (items.isEmpty()) return@forEach
                        val key = tag?.id ?: -1
                        val isCollapsed = collapsed.contains(key)
                        val label = tag?.name ?: AppStrings.get("タグなし")
                        val topGap = if (first) 0.dp else 28.dp
                        first = false
                        item(key = "group-$key") {
                            Row(
                                modifier = Modifier
                                    .padding(top = topGap)
                                    .fillMaxWidth()
                                    .heightIn(min = 40.dp)
                                    .bottomBorder(Filo.colors.border)
                                    .padding(bottom = 4.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                FiloIconButton(
                                    if (isCollapsed) FiloIconName.ChevronRight else FiloIconName.ChevronDown,
                                    "$label: ${if (isCollapsed) tr("展開") else tr("折りたたむ")}",
                                    { collapsed = if (isCollapsed) collapsed - key else collapsed + key },
                                    size = 14.dp,
                                )
                                Row(
                                    modifier = Modifier.weight(1f),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    // タグ名タップでタグ絞り込み済み記事一覧へ遷移する (SCREENS.md)
                                    Text(
                                        label,
                                        fontSize = 15.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Filo.colors.text,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier
                                            .weight(1f, fill = false)
                                            .then(if (tag != null) Modifier.clickable { onSelectTag(tag.id) } else Modifier),
                                    )
                                    Text(trf("%d件の購読", items.size), fontSize = 12.sp, color = Filo.colors.muted, maxLines = 1)
                                }
                                if (tag != null) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                        FiloIconButton(FiloIconName.ChevronUp, tr("タグを上へ"), { moveTag(tag.id, -1) }, size = 16.dp)
                                        FiloIconButton(FiloIconName.ChevronDown, tr("タグを下へ"), { moveTag(tag.id, 1) }, size = 16.dp)
                                        FiloIconButton(FiloIconName.Pencil, tr("名前変更"), {
                                            renameText = tag.name
                                            renamingTag = tag
                                        }, size = 16.dp)
                                    }
                                }
                            }
                        }
                        if (!isCollapsed) {
                            items(items, key = { "sub-$key-${it.id}" }) { subscription ->
                                SubscriptionListRow(
                                    subscription,
                                    allTags = tags,
                                    onOpen = { onOpenSubscription(subscription.id) },
                                    moveEnabled = !isReordering,
                                    onMove = { direction -> move(subscription.id, direction, items.map { it.id }) },
                                    onTagsChange = { updateSubscriptionTags(subscription.id, it) },
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    renamingTag?.let { tag ->
        FiloDialog(
            title = tr("タグ名を変更"),
            onDismiss = { renamingTag = null },
            buttons = {
                FiloButton(tr("キャンセル"), { renamingTag = null })
                FiloButton(tr("変更"), {
                    scope.launch {
                        try {
                            ApiClient.updateTag(tag.id, renameText.trim())
                            reload()
                        } catch (e: Exception) {
                            errorMessage = ErrorMessages.forErrorText(e)
                        }
                    }
                    renamingTag = null
                }, kind = ButtonKind.Primary, enabled = renameText.isNotBlank())
            },
        ) {
            FiloTextField(renameText, { renameText = it }, modifier = Modifier.fillMaxWidth())
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SubscriptionListRow(
    subscription: Subscription,
    allTags: List<Tag>,
    onOpen: () -> Unit,
    moveEnabled: Boolean,
    onMove: (Int) -> Unit,
    onTagsChange: (List<Int>) -> Unit,
) {
    val colors = Filo.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .bottomBorder(colors.mutedBorder)
            .padding(start = DisclosureIndent, top = 8.dp, bottom = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                subscription.displayTitle,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = colors.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.clickable(onClick = onOpen),
            )
            FlowRow(
                modifier = Modifier.padding(top = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    trf("最終公開 %s", relativeTime(subscription.feed.latestPublishedAt).ifEmpty { "—" }),
                    fontSize = 12.sp,
                    color = colors.muted,
                )
                SubscriptionHealth(subscription)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            TagPicker(allTags, subscription.tagIds, onTagsChange)
            FiloIconButton(FiloIconName.ChevronUp, tr("上へ"), { onMove(-1) }, size = 16.dp, enabled = moveEnabled)
            FiloIconButton(FiloIconName.ChevronDown, tr("下へ"), { onMove(1) }, size = 16.dp, enabled = moveEnabled)
        }
    }
}

/**
 * Checklist popover for assigning tags to one subscription: an icon button in
 * dense lists, a labelled button on the detail screen (web `TagPicker`).
 */
@Composable
fun TagPicker(
    tags: List<Tag>,
    selectedIds: List<Int>,
    onChange: (List<Int>) -> Unit,
    asButton: Boolean = false,
) {
    if (tags.isEmpty()) return
    var open by remember { mutableStateOf(false) }
    val colors = Filo.colors
    Box {
        if (asButton) {
            FiloButton(tr("タグを編集"), { open = true }, small = true, icon = FiloIconName.Tag)
        } else {
            FiloIconButton(FiloIconName.Tag, tr("タグを編集"), { open = true }, size = 16.dp, expanded = open)
        }
        FiloMenu(expanded = open, onDismiss = { open = false }, modifier = Modifier.width(220.dp)) {
            tags.forEach { tag ->
                val checked = selectedIds.contains(tag.id)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = Filo.TouchTarget)
                        .clip(RoundedCornerShape(Filo.RadiusSm))
                        .clickable { onChange(if (checked) selectedIds - tag.id else selectedIds + tag.id) }
                        .padding(horizontal = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .size(16.dp)
                            .background(if (checked) colors.primary else colors.surface, RoundedCornerShape(4.dp))
                            .border(1.dp, if (checked) colors.primary else colors.border, RoundedCornerShape(4.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (checked) FiloIcon(FiloIconName.CheckMark, size = 12.dp, tint = colors.onPrimary)
                    }
                    if (tag.color != null) TagDot(tag.color, size = 8.dp)
                    Text(tag.name, fontSize = 14.sp, color = colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AddFeedScreen(
    onBack: () -> Unit,
    onOpenArticles: () -> Unit = {},
    onCreated: suspend () -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf("") }
    var tags by remember { mutableStateOf<List<Tag>>(emptyList()) }
    var selectedTagIds by remember { mutableStateOf<Set<Int>>(emptySet()) }
    var newTagNames by remember { mutableStateOf("") }
    var isSubmitting by remember { mutableStateOf(false) }
    var isRetrying by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<AppText?>(null) }
    var created by remember { mutableStateOf<Subscription?>(null) }

    LaunchedEffect(Unit) {
        runCatching { tags = ApiClient.listTags() }
    }

    fun submit() {
        if (isSubmitting || url.isBlank()) return
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
                onCreated()
                val newTagCount = newTagNames.split(",", "、").count { it.trim().isNotEmpty() }
                com.filo.app.Analytics.track(
                    "add_feed",
                    mapOf(
                        "has_custom_tags" to (newTagCount > 0),
                        "tag_count" to (selectedTagIds.size + newTagCount),
                    ),
                )
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forErrorText(e)
            }
            isSubmitting = false
        }
    }

    Column(Modifier.fillMaxSize()) {
        FiloHeader(tr("フィードを追加"), lead = HeaderLead.Back, onLead = onBack)
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PagePadding,
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            item {
                FiloField(tr("RSS/Atom URL または サイトURL")) {
                    FiloTextField(
                        url,
                        { url = it },
                        placeholder = "https://example.com/feed.xml",
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next, autoCorrectEnabled = false),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            if (tags.isNotEmpty()) {
                item {
                    FiloField(tr("タグ")) {
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            tags.forEach { tag ->
                                FiloChip(tag.name, selectedTagIds.contains(tag.id), {
                                    selectedTagIds = if (selectedTagIds.contains(tag.id)) selectedTagIds - tag.id else selectedTagIds + tag.id
                                })
                            }
                        }
                    }
                }
            }
            item {
                FiloField(tr("新規タグ（カンマ区切り）")) {
                    FiloTextField(
                        newTagNames,
                        { newTagNames = it },
                        placeholder = "AI, Engineering",
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { submit() }),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            item {
                Row {
                    FiloButton(
                        if (isSubmitting) tr("フィードを確認中…") else tr("追加"),
                        ::submit,
                        kind = ButtonKind.Primary,
                        icon = FiloIconName.Plus,
                        enabled = !isSubmitting && url.isNotBlank(),
                    )
                }
            }
            errorMessage?.let { message -> item { FiloErrorBox(tr(message)) } }
            created?.let { subscription ->
                item {
                    FiloCard {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    subscription.displayTitle,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Filo.colors.text,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f),
                                )
                                when (subscription.initialFetchStatus) {
                                    "ready" -> FiloBadge(tr("追加完了"), BadgeTone.Ok)
                                    "fetching" -> FiloBadge(tr("記事取得中"))
                                    else -> FiloBadge(tr("初回取得失敗"), BadgeTone.Danger)
                                }
                            }
                            Text(
                                when (subscription.initialFetchStatus) {
                                    "ready" -> tr("記事の取得が完了しています。")
                                    "fetching" -> tr("購読の追加は完了しました。記事を取得しています。")
                                    else -> trf("購読は作成されましたが、%s", ErrorMessages.initialFetchMessage(subscription.initialFetchErrorCode))
                                },
                                fontSize = 13.sp,
                                lineHeight = 21.sp,
                                color = Filo.colors.muted,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (subscription.initialFetchStatus == "failed") {
                                    FiloButton(if (isRetrying) tr("再試行中…") else tr("再試行"), {
                                        scope.launch {
                                            isRetrying = true
                                            try {
                                                created = ApiClient.retryInitialFetch(subscription.id)
                                                com.filo.app.Analytics.track("retry_feed_fetch")
                                            } catch (e: Exception) {
                                                errorMessage = ErrorMessages.forErrorText(e)
                                            }
                                            isRetrying = false
                                        }
                                    }, enabled = !isRetrying)
                                }
                                FiloButton(tr("記事一覧へ"), onOpenArticles)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun TagsScreen(onOpenMenu: (() -> Unit)?) {
    val scope = rememberCoroutineScope()
    var tags by remember { mutableStateOf<List<Tag>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<AppText?>(null) }
    var newName by remember { mutableStateOf("") }
    var isCreating by remember { mutableStateOf(false) }
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
            errorMessage = ErrorMessages.forErrorText(e)
        }
        isLoading = false
    }

    LaunchedEffect(Unit) { reload() }

    fun create() {
        if (isCreating || newName.isBlank()) return
        scope.launch {
            isCreating = true
            try {
                ApiClient.createTag(newName.trim())
                newName = ""
                reload()
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forErrorText(e)
            }
            isCreating = false
        }
    }

    fun move(tagId: Int, direction: Int) {
        val index = tags.indexOfFirst { it.id == tagId }
        val target = index + direction
        if (index < 0 || target < 0 || target >= tags.size) return
        val next = tags.toMutableList()
        val item = next.removeAt(index)
        next.add(target, item)
        tags = next
        scope.launch {
            try {
                ApiClient.reorderTags(next.map { it.id })
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forErrorText(e)
                reload()
            }
        }
    }

    fun saveEdit(tag: Tag) {
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
                errorMessage = ErrorMessages.forErrorText(e)
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        FiloHeader(
            title = tr("タグ管理"),
            lead = if (onOpenMenu != null) HeaderLead.Menu else HeaderLead.None,
            onLead = { onOpenMenu?.invoke() },
        )
        LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PagePadding) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    FiloTextField(
                        newName,
                        { newName = it },
                        placeholder = tr("新しいタグ名"),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { create() }),
                        modifier = Modifier.weight(1f),
                    )
                    FiloButton(tr("追加"), ::create, kind = ButtonKind.Primary, icon = FiloIconName.Plus, enabled = !isCreating && newName.isNotBlank())
                }
                Spacer(Modifier.height(16.dp))
            }
            errorMessage?.let { message ->
                item {
                    FiloErrorBox(tr(message)) { scope.launch { reload() } }
                    Spacer(Modifier.height(16.dp))
                }
            }
            if (isLoading) {
                item { FiloSpinner() }
            } else if (tags.isEmpty()) {
                item { FiloEmptyState(tr("タグがありません。上の入力欄から作成できます。"), FiloIconName.Tag) }
            } else {
                item { FiloDivider() }
                items(tags, key = { it.id }) { tag ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 56.dp)
                            .bottomBorder(Filo.colors.mutedBorder)
                            .padding(start = 4.dp, top = 8.dp, bottom = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (editingTagId == tag.id) {
                            TagEditor(
                                name = editName,
                                color = editColor,
                                onNameChange = { editName = it },
                                onColorChange = { editColor = it },
                                onCancel = { editingTagId = null },
                                onSave = { saveEdit(tag) },
                            )
                        } else {
                            TagDot(tag.color)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(
                                    tag.name,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Filo.colors.text,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(trf("%d件の購読", tag.subscriptionCount), fontSize = 12.sp, color = Filo.colors.muted)
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                FiloIconButton(FiloIconName.ChevronUp, tr("上へ"), { move(tag.id, -1) }, size = 16.dp)
                                FiloIconButton(FiloIconName.ChevronDown, tr("下へ"), { move(tag.id, 1) }, size = 16.dp)
                                FiloIconButton(FiloIconName.Pencil, tr("編集"), {
                                    editingTagId = tag.id
                                    editName = tag.name
                                    editColor = tag.color.orEmpty()
                                }, size = 16.dp)
                                FiloIconButton(FiloIconName.Trash, tr("削除"), { deletingTag = tag }, size = 16.dp)
                            }
                        }
                    }
                }
            }
        }
    }

    deletingTag?.let { tag ->
        FiloConfirmDialog(
            title = trf("タグ「%s」を削除しますか？", tag.name),
            message = tr("購読は削除されません。"),
            confirmLabel = tr("削除"),
            danger = true,
            onConfirm = {
                scope.launch {
                    try {
                        ApiClient.deleteTag(tag.id)
                        reload()
                    } catch (e: Exception) {
                        errorMessage = ErrorMessages.forErrorText(e)
                    }
                }
                deletingTag = null
            },
            onDismiss = { deletingTag = null },
        )
    }
}

// Inline tag editor: a colour swatch beside the hex value and the name, then
// the actions (web edits the colour with the native colour input).
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TagEditor(
    name: String,
    color: String,
    onNameChange: (String) -> Unit,
    onColorChange: (String) -> Unit,
    onCancel: () -> Unit,
    onSave: () -> Unit,
) {
    val colors = Filo.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        FiloTextField(name, onNameChange, placeholder = tr("タグ名"), modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(Filo.ControlHeight)
                    .border(1.dp, colors.border, RoundedCornerShape(Filo.Radius))
                    .padding(8.dp),
                contentAlignment = Alignment.Center,
            ) { TagDot(color.ifBlank { null }, size = 18.dp) }
            FiloTextField(color, onColorChange, placeholder = tr("色 (#hex)"), modifier = Modifier.weight(1f))
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (color.isNotBlank()) FiloButton(tr("色を解除"), { onColorChange("") }, kind = ButtonKind.Ghost)
            FiloButton(tr("キャンセル"), onCancel)
            FiloButton(tr("保存"), onSave, kind = ButtonKind.Primary, enabled = name.isNotBlank())
        }
    }
}
