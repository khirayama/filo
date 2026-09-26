package com.filo.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.filo.app.api.Subscription
import com.filo.app.api.Tag
import com.filo.app.api.UnreadCounts

private const val DRAWER_ANIMATION_MS = 200
private val DrawerEasing = CubicBezierEasing(0.32f, 0.72f, 0f, 1f)

/** The phone drawer: a sidebar panel sliding over a scrim (web `AppShell`). */
@Composable
fun FiloDrawer(open: Boolean, onClose: () -> Unit, content: @Composable () -> Unit) {
    val colors = Filo.colors
    BackHandler(enabled = open, onBack = onClose)
    Box(Modifier.fillMaxSize()) {
        AnimatedVisibility(
            visible = open,
            enter = fadeIn(tween(DRAWER_ANIMATION_MS)),
            exit = fadeOut(tween(DRAWER_ANIMATION_MS)),
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(colors.scrim)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = onClose,
                    ),
            )
        }
        AnimatedVisibility(
            visible = open,
            enter = slideInHorizontally(tween(DRAWER_ANIMATION_MS, easing = DrawerEasing)) { -it },
            exit = slideOutHorizontally(tween(DRAWER_ANIMATION_MS, easing = DrawerEasing)) { -it },
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .shadow(32.dp)
                    .background(colors.sidebar)
                    .padding(start = 12.dp, end = 12.dp, top = 8.dp),
            ) { content() }
        }
    }
}

/**
 * Main navigation shared by the phone drawer and the wide-screen sidebar
 * (web `SidebarNav`). `onClose` is null where the sidebar is always visible.
 */
@Composable
fun SidebarNav(
    tags: List<Tag>,
    subscriptions: List<Subscription>,
    unreadCounts: UnreadCounts,
    selectedTagId: Int?,
    readingListOnly: Boolean,
    bookmarkedOnly: Boolean,
    activeRoute: String?,
    activeSubscriptionId: Int?,
    onClose: (() -> Unit)?,
    onSelectView: (tagId: Int?, readingList: Boolean, bookmarked: Boolean) -> Unit,
    onOpenSubscription: (Int) -> Unit,
    onOpenAddFeed: () -> Unit,
    onOpenAddArticle: () -> Unit,
    onOpenSubscriptions: () -> Unit,
    onOpenTags: () -> Unit,
    onOpenStatus: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val colors = Filo.colors
    var expandedTags by remember { mutableStateOf<Set<Int>>(emptySet()) }
    var addMenuOpen by remember { mutableStateOf(false) }
    val onArticles = activeRoute == "articles"
    val allArticles = onArticles && selectedTagId == null && !readingListOnly && !bookmarkedOnly

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(1.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 40.dp)
                .padding(bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FiloBrand(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(Filo.RadiusSm))
                    .clickable { onSelectView(null, false, false) }
                    .padding(horizontal = 6.dp, vertical = 4.dp),
            )
            Box {
                FiloIconButton(FiloIconName.Plus, tr("追加"), { addMenuOpen = true }, expanded = addMenuOpen)
                FiloMenu(expanded = addMenuOpen, onDismiss = { addMenuOpen = false }) {
                    FiloMenuItem(tr("フィードを追加"), {
                        addMenuOpen = false
                        onOpenAddFeed()
                    }, icon = FiloIconName.Rss)
                    FiloMenuItem(tr("記事を追加"), {
                        addMenuOpen = false
                        onOpenAddArticle()
                    }, icon = FiloIconName.Playlist)
                }
            }
            if (onClose != null) FiloIconButton(FiloIconName.Close, tr("閉じる"), onClose)
        }

        NavRow(
            label = tr("全ての記事"),
            icon = FiloIconName.Inbox,
            count = unreadCounts.allArticles,
            active = allArticles,
            onClick = { onSelectView(null, false, false) },
        )
        NavRow(
            label = tr("リーディングリスト"),
            icon = FiloIconName.Playlist,
            count = unreadCounts.readingList,
            active = onArticles && readingListOnly && selectedTagId == null,
            onClick = { onSelectView(null, true, false) },
        )
        NavRow(
            label = tr("ブックマーク"),
            icon = FiloIconName.Bookmark,
            active = onArticles && bookmarkedOnly && selectedTagId == null,
            onClick = { onSelectView(null, false, true) },
        )

        Text(
            tr("フィード"),
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            color = colors.muted,
            modifier = Modifier.padding(start = 8.dp, end = 8.dp, top = 20.dp, bottom = 6.dp),
        )
        val groups = tags.map { tag -> tag to subscriptions.filter { it.tagIds.contains(tag.id) } } +
            listOf<Pair<Tag?, List<Subscription>>>(null to subscriptions.filter { it.tagIds.isEmpty() })
        groups.forEach { (tag, items) ->
            if (tag == null && items.isEmpty()) return@forEach
            val key = tag?.id ?: -1
            val expanded = expandedTags.contains(key)
            NavGroupRow(
                label = tag?.name ?: tr("タグなし"),
                count = items.sumOf { it.unreadCount },
                expanded = expanded,
                active = onArticles && tag != null && selectedTagId == tag.id,
                onToggle = { expandedTags = if (expanded) expandedTags - key else expandedTags + key },
                onClick = tag?.let { { onSelectView(it.id, false, false) } },
            )
            if (expanded) {
                items.forEach { subscription ->
                    SubscriptionNavRow(
                        subscription,
                        active = activeRoute == "subscription/{id}" && activeSubscriptionId == subscription.id,
                        onClick = { onOpenSubscription(subscription.id) },
                    )
                }
            }
        }

        Spacer(Modifier.height(15.dp))
        FiloDivider()
        Spacer(Modifier.height(10.dp))
        NavRow(tr("購読管理"), FiloIconName.Rss, active = activeRoute == "subscriptions", onClick = onOpenSubscriptions)
        NavRow(tr("タグ管理"), FiloIconName.Tag, active = activeRoute == "tags", onClick = onOpenTags)
        NavRow(tr("処理ステータス"), FiloIconName.Activity, active = activeRoute == "status", onClick = onOpenStatus)
        NavRow(tr("設定"), FiloIconName.Gear, active = activeRoute == "settings", onClick = onOpenSettings)
    }
}

// Rows are 40dp for touch (web rows are 32px for the pointer); labels of every
// row kind start at the same x.
private val NavRowHeight = 40.dp
private val NavLabelInset = 38.dp

@Composable
private fun navRowModifier(active: Boolean, onClick: (() -> Unit)?): Modifier {
    val colors = Filo.colors
    return Modifier
        .fillMaxWidth()
        .heightIn(min = NavRowHeight)
        .clip(RoundedCornerShape(Filo.RadiusSm))
        .background(if (active) colors.accentSoft else androidx.compose.ui.graphics.Color.Transparent)
        .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
}

@Composable
private fun NavLabel(label: String, active: Boolean, modifier: Modifier, muted: Boolean = false) {
    Text(
        label,
        fontSize = 14.sp,
        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
        color = if (muted) Filo.colors.muted else Filo.colors.text,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier,
    )
}

@Composable
private fun NavCount(count: Int, active: Boolean) {
    if (count > 0) {
        Text(
            "$count",
            fontSize = 12.sp,
            color = if (active) Filo.colors.text else Filo.colors.muted,
        )
    }
}

@Composable
private fun NavRow(
    label: String,
    icon: FiloIconName,
    active: Boolean,
    onClick: () -> Unit,
    count: Int = 0,
) {
    Row(
        modifier = navRowModifier(active, onClick).padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) {
            FiloIcon(icon, size = 16.dp, tint = if (active) Filo.colors.accent else Filo.colors.muted)
        }
        NavLabel(label, active, Modifier.weight(1f))
        NavCount(count, active)
    }
}

// A tag row: the disclosure button sits in the icon slot so labels line up
// with the plain rows above. The untagged group has no list of its own.
@Composable
private fun NavGroupRow(
    label: String,
    count: Int,
    expanded: Boolean,
    active: Boolean,
    onToggle: () -> Unit,
    onClick: (() -> Unit)?,
) {
    Box(navRowModifier(active, onClick)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = NavRowHeight)
                .padding(start = NavLabelInset, end = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            NavLabel(label, active, Modifier.weight(1f), muted = onClick == null)
            NavCount(count, active)
        }
        Box(
            modifier = Modifier
                .align(Alignment.CenterStart)
                .padding(start = 2.dp)
                .size(36.dp)
                .clip(RoundedCornerShape(Filo.RadiusSm))
                .clickable(onClick = onToggle),
            contentAlignment = Alignment.Center,
        ) {
            FiloIcon(
                if (expanded) FiloIconName.ChevronDown else FiloIconName.ChevronRight,
                size = 14.dp,
                contentDescription = "$label: ${if (expanded) tr("折りたたむ") else tr("展開")}",
            )
        }
    }
}

@Composable
private fun SubscriptionNavRow(subscription: Subscription, active: Boolean, onClick: () -> Unit) {
    val unhealthy = subscription.initialFetchStatus == "failed" || subscription.feedHealthStatus == "paused"
    val stale = subscription.feedHealthStatus == "stale"
    val label = tr("更新異常")
    Row(
        modifier = navRowModifier(active, onClick).padding(start = NavLabelInset, end = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        NavLabel(subscription.displayTitle, active, Modifier.weight(1f), muted = stale)
        if (unhealthy) {
            Box(
                Modifier
                    .size(6.dp)
                    .background(Filo.colors.danger, CircleShape)
                    .semantics { contentDescription = label },
            )
        }
        NavCount(subscription.unreadCount, active)
    }
}
