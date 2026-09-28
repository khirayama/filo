package com.filo.app.ui

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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.filo.app.LanguagePreference
import com.filo.app.api.ApiClient
import com.filo.app.api.ErrorMessages
import com.filo.app.api.FeedJob
import com.filo.app.api.StatusOverview
import com.filo.app.api.StatusSubscription
import java.text.NumberFormat
import java.util.Locale
import kotlinx.coroutines.launch

private enum class StatusFilter { All, Attention, Fetching, Paused }

@Composable
fun StatusScreen(onOpenMenu: (() -> Unit)?, onOpenSubscription: (Int) -> Unit) {
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<StatusOverview?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<AppText?>(null) }
    var isRefreshing by remember { mutableStateOf(false) }
    // The feed a manual fetch is running for; null while the bulk fetch runs.
    var busyTarget by remember { mutableStateOf<Int?>(null) }
    var notice by remember { mutableStateOf<AppText?>(null) }
    var filterText by remember { mutableStateOf("") }
    var statusFilter by remember { mutableStateOf(StatusFilter.All) }

    suspend fun load(showSpinner: Boolean = false) {
        if (showSpinner) isLoading = true
        try {
            status = ApiClient.getStatus()
            errorMessage = null
        } catch (e: Exception) {
            // Keep showing the last good snapshot and only surface errors when
            // there is nothing to show.
            if (status == null || showSpinner) {
                errorMessage = ErrorMessages.forErrorText(e)
            }
        }
        if (showSpinner) isLoading = false
    }

    // Every manual operation shares the same shape: mark busy, clear the
    // notice, run, show the outcome, reload.
    fun run(target: Int?, action: suspend () -> AppText) {
        scope.launch {
            isRefreshing = true
            busyTarget = target
            notice = null
            try {
                notice = action()
                load()
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forErrorText(e)
            }
            isRefreshing = false
            busyTarget = null
        }
    }

    fun refreshAll() = run(null) {
        val result = ApiClient.refreshFeeds(force = true)
        com.filo.app.Analytics.track("refresh_feeds", mapOf("source" to "status", "enqueued" to result.enqueued))
        if (result.enqueued > 0) {
            AppText("%d件のフィードの取得を開始しました。", listOf(result.enqueued))
        } else {
            AppText("取得対象のフィードがありません。")
        }
    }

    fun refreshFeed(feedId: Int) = run(feedId) {
        ApiClient.refreshFeed(feedId)
        com.filo.app.Analytics.track("refresh_feed", mapOf("source" to "status", "feed_id" to feedId))
        AppText("フィードの取得を開始しました。")
    }

    LaunchedEffect(Unit) { load(showSpinner = true) }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            FiloHeader(
                title = tr("処理ステータス"),
                lead = if (onOpenMenu != null) HeaderLead.Menu else HeaderLead.None,
                onLead = { onOpenMenu?.invoke() },
            ) {
                FiloIconButton(FiloIconName.Refresh, tr("再読み込み"), { scope.launch { load(showSpinner = true) } })
                FiloButton(
                    if (isRefreshing && busyTarget == null) tr("取得中…") else tr("すべて取得"),
                    ::refreshAll,
                    kind = ButtonKind.Primary,
                    small = true,
                    enabled = !isRefreshing,
                    modifier = Modifier.padding(end = 8.dp),
                )
            }
            val s = status
            LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PagePadding) {
                errorMessage?.let {
                    item {
                        FiloErrorBox(tr(it)) { scope.launch { load(showSpinner = true) } }
                        Spacer(Modifier.height(24.dp))
                    }
                }
                if (isLoading || s == null) {
                    item { FiloSpinner() }
                    return@LazyColumn
                }
                item {
                    StatGrid(s)
                    Spacer(Modifier.height(24.dp))
                    Text(
                        trf("購読一覧（%d）", s.subscriptionStatuses.size),
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = Filo.colors.text,
                    )
                }
                if (s.subscriptionStatuses.isEmpty()) {
                    item { FiloEmptyState(tr("購読がありません。"), FiloIconName.Rss) }
                    return@LazyColumn
                }
                val visibleSubscriptions = s.subscriptionStatuses
                    .filter { sub ->
                        val query = filterText.trim().lowercase()
                        if (query.isNotEmpty() && !sub.feedTitle.lowercase().contains(query)) return@filter false
                        when (statusFilter) {
                            StatusFilter.All -> true
                            StatusFilter.Attention -> hasStatusAttention(sub)
                            StatusFilter.Fetching -> sub.fetchJob?.status == "pending" || sub.fetchJob?.status == "running"
                            StatusFilter.Paused -> sub.feedStatus == "paused"
                        }
                    }
                    // Keep the most actionable rows at the top, as on the web.
                    .sortedWith(compareBy<StatusSubscription> { statusRank(it) }.thenBy { it.feedTitle.lowercase() })
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        FiloTextField(
                            filterText,
                            { filterText = it },
                            placeholder = tr("購読名で検索"),
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                            modifier = Modifier.weight(1f),
                        )
                        FiloSelect(
                            options = listOf(
                                StatusFilter.All to tr("すべて"),
                                StatusFilter.Attention to tr("問題あり"),
                                StatusFilter.Fetching to tr("取得中"),
                                StatusFilter.Paused to tr("停止"),
                            ),
                            selected = statusFilter,
                            onSelect = { statusFilter = it },
                            label = tr("状態"),
                            modifier = Modifier.widthIn(min = 104.dp, max = 140.dp),
                        )
                        Text(
                            "${visibleSubscriptions.size}/${s.subscriptionStatuses.size}",
                            fontSize = 12.sp,
                            color = Filo.colors.muted,
                            textAlign = TextAlign.End,
                            modifier = Modifier.widthIn(min = 44.dp),
                        )
                    }
                }
                if (visibleSubscriptions.isEmpty()) {
                    item { FiloEmptyState(tr("条件に一致する購読がありません。")) }
                } else {
                    item { FiloDivider() }
                    items(visibleSubscriptions, key = { it.subscriptionId }) { sub ->
                        val fetchBusy = sub.fetchJob?.isActive == true || (isRefreshing && busyTarget == sub.feedId)
                        StatusRow(
                            sub = sub,
                            fetchBusy = fetchBusy,
                            refreshEnabled = !isRefreshing && !fetchBusy,
                            onOpen = { onOpenSubscription(sub.subscriptionId) },
                            onRefresh = { refreshFeed(sub.feedId) },
                        )
                    }
                }
            }
        }
        FiloToast(notice?.let { tr(it) }, onDismiss = { notice = null })
    }
}

@Composable
private fun StatGrid(status: StatusOverview) {
    val language = LanguagePreference.value
    FiloCard {
        Row(Modifier.fillMaxWidth()) {
            Stat(tr("購読"), "${status.feeds.total}", Modifier.weight(1f))
            Stat(tr("記事"), NumberFormat.getIntegerInstance(Locale.forLanguageTag(language)).format(status.articleTotal), Modifier.weight(1f))
            Stat(tr("最終取得"), status.feeds.lastFetchedAt?.let(::compactRelativeTime) ?: "—", Modifier.weight(1f))
        }
    }
}

@Composable
private fun Stat(label: String, value: String, modifier: Modifier) {
    Column(modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, fontSize = 12.sp, color = Filo.colors.muted)
        Text(
            value,
            fontSize = 15.sp,
            fontWeight = FontWeight.Bold,
            color = Filo.colors.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StatusRow(
    sub: StatusSubscription,
    fetchBusy: Boolean,
    refreshEnabled: Boolean,
    onOpen: () -> Unit,
    onRefresh: () -> Unit,
) {
    val colors = Filo.colors
    val rowError = when {
        sub.fetchJob?.status == "failed" -> sub.fetchJob.lastError ?: sub.lastError
        hasStatusAttention(sub) -> sub.lastError
        else -> null
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .bottomBorder(colors.mutedBorder)
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                sub.feedTitle,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = colors.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.clickable(onClick = onOpen),
            )
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                OverallStatusBadge(sub)
                if ((sub.fetchJob != null && sub.fetchJob.status != "completed") || sub.lastResult == "error") {
                    JobBadge(sub.fetchJob)
                }
                Text(sub.lastFetchedAt?.let(::relativeTime) ?: "—", fontSize = 12.sp, color = colors.muted)
            }
            rowError?.let {
                Text(tr(ErrorMessages.forStatusErrorText(it)), fontSize = 12.sp, color = colors.danger)
            }
        }
        FiloIconButton(
            FiloIconName.Refresh,
            if (fetchBusy) tr("取得中…") else tr("このフィードを取得"),
            onRefresh,
            size = 16.dp,
            enabled = refreshEnabled,
        )
    }
}

// Keep the same actionable-first order as the web and iOS status screens.
// This is recalculated from every snapshot, so rows move when a fetch changes
// state.
private fun statusRank(sub: StatusSubscription): Int {
    if (hasStatusAttention(sub)) return 0
    if (sub.fetchJob?.stalled == true) return 1
    if (sub.fetchJob?.status == "running") return 2
    if (sub.fetchJob?.status == "pending") return 3
    if (sub.feedStatus == "paused") return 4
    return 5
}

private fun hasStatusAttention(sub: StatusSubscription): Boolean =
    sub.consecutiveFailures > 0 ||
        sub.fetchJob?.status == "failed" ||
        sub.lastResult == "error"

@Composable
private fun OverallStatusBadge(sub: StatusSubscription) {
    when {
        hasStatusAttention(sub) -> FiloBadge(tr("失敗"), BadgeTone.Danger)
        sub.fetchJob?.stalled == true -> FiloBadge(tr("中断"), BadgeTone.Danger)
        sub.fetchJob?.status == "running" -> FiloBadge(tr("取得中"), BadgeTone.Warn)
        sub.fetchJob?.status == "pending" -> FiloBadge(tr("取得待ち"), BadgeTone.Warn)
        sub.feedStatus == "paused" -> FiloBadge(tr("停止"))
        else -> FiloBadge(tr("完了"), BadgeTone.Ok)
    }
}

// Per-row job badge: shown only while something is queued, running or broken.
@Composable
private fun JobBadge(job: FeedJob?) {
    when {
        job == null || job.status == "completed" -> FiloBadge(tr("取得失敗"), BadgeTone.Danger)
        job.stalled -> FiloBadge(tr("取得中断"), BadgeTone.Danger)
        job.status == "failed" -> FiloBadge(tr("取得失敗"), BadgeTone.Danger)
        job.status == "running" -> FiloBadge(tr("取得中"), BadgeTone.Warn)
        else -> FiloBadge(tr("取得待ち"), BadgeTone.Warn)
    }
}
