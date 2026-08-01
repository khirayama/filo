package com.filo.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.filo.app.api.ApiClient
import com.filo.app.api.ErrorMessages
import com.filo.app.api.FeedJob
import com.filo.app.api.StatusOverview
import com.filo.app.api.StatusSubscription
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

private const val POLL_INTERVAL_MS = 5000L

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatusScreen(onBack: () -> Unit, onOpenSubscription: (Int) -> Unit) {
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<StatusOverview?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var isRefreshing by remember { mutableStateOf(false) }
    var busyFeedId by remember { mutableStateOf<Int?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var polling by remember { mutableStateOf(true) }

    suspend fun load(showSpinner: Boolean = false) {
        if (showSpinner) isLoading = true
        try {
            status = ApiClient.getStatus()
            errorMessage = null
        } catch (e: Exception) {
            // only surface load errors when there is nothing to show;
            // background poll failures keep the last good snapshot
            if (status == null || showSpinner) {
                errorMessage = ErrorMessages.forError(e)
            }
        }
        if (showSpinner) isLoading = false
    }

    LaunchedEffect(Unit) { load(showSpinner = true) }

    LaunchedEffect(polling) {
        while (polling) {
            delay(POLL_INTERVAL_MS)
            load()
        }
    }

    DisposableEffect(Unit) { onDispose { polling = false } }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("処理ステータス") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "戻る")
                    }
                },
                actions = {
                    IconButton(onClick = { scope.launch { load(showSpinner = true) } }) {
                        Icon(Icons.Default.Refresh, contentDescription = "再読み込み")
                    }
                },
            )
        },
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            errorMessage?.let { ErrorBanner(it) { scope.launch { load(showSpinner = true) } } }

            if (isLoading || status == null) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(40.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) { CircularProgressIndicator() }
            } else {
                val s = status!!

                // Actions
                Text("操作", fontWeight = FontWeight.SemiBold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        enabled = !isRefreshing,
                        onClick = {
                            scope.launch {
                                isRefreshing = true
                                notice = null
                                try {
                                    val result = ApiClient.refreshFeeds(force = true)
                                    notice = if (result.enqueued > 0) {
                                        "${result.enqueued}件のフィードの取得を開始しました。"
                                    } else {
                                        "取得対象のフィードがありません。"
                                    }
                                    load()
                                } catch (e: Exception) {
                                    errorMessage = ErrorMessages.forError(e)
                                }
                                isRefreshing = false
                            }
                        },
                    ) { Text(if (isRefreshing) "取得中…" else "すべて取得") }
                }
                notice?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(
                    "購読 ${s.feeds.total}件・記事 ${s.articleTotal}件" +
                        (s.feeds.lastFetchedAt?.let { "・最終取得 ${relativeTime(it)}" } ?: "") +
                        "・約${POLL_INTERVAL_MS / 1000}秒ごとに自動更新",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                HorizontalDivider()

                // Subscription statuses
                Text("購読一覧（状態順・${s.subscriptionStatuses.size}件）", fontWeight = FontWeight.SemiBold)
                if (s.subscriptionStatuses.isEmpty()) {
                    Text(
                        "購読がありません。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    sortedStatusSubscriptions(s.subscriptionStatuses).forEach { sub ->
                        val isError = hasStatusAttention(sub)
                        val fetchBusy = sub.fetchJob?.isActive == true || (busyFeedId == sub.feedId && isRefreshing)
                        Column(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Surface(
                                    onClick = { onOpenSubscription(sub.subscriptionId) },
                                    color = androidx.compose.ui.graphics.Color.Transparent,
                                    modifier = Modifier.weight(1f),
                                ) {
                                    Text(
                                        sub.feedTitle,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        textDecoration = TextDecoration.Underline,
                                    )
                                }
                                if (sub.feedStatus == "paused") {
                                    StatusBadge("停止", BadgeTone.Muted)
                                }
                                JobBadge("取得", sub.fetchJob, fallbackDanger = sub.lastResult == "error")
                                Text(
                                    sub.lastFetchedAt?.let { relativeTime(it) } ?: "—",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            if (isError) {
                                (sub.fetchJob?.lastError ?: sub.lastError)?.let {
                                    Text(
                                        it,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.error,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TextButton(
                                    enabled = !isRefreshing && !fetchBusy,
                                    onClick = {
                                        scope.launch {
                                            busyFeedId = sub.feedId
                                            isRefreshing = true
                                            notice = null
                                            try {
                                                ApiClient.refreshFeed(sub.feedId)
                                                notice = "フィードの取得を開始しました。"
                                                load()
                                            } catch (e: Exception) {
                                                errorMessage = ErrorMessages.forError(e)
                                            }
                                            isRefreshing = false
                                            busyFeedId = null
                                        }
                                    },
                                ) { Text(if (fetchBusy) "取得中…" else "取得") }
                            }
                        }
                        HorizontalDivider()
                    }
                }
            }
        }
    }
}

// Keep the same actionable-first order as the web and iOS status screens.
// This is recalculated from every polled snapshot, so rows move when a fetch
// changes state.
private fun sortedStatusSubscriptions(subscriptions: List<StatusSubscription>) =
    subscriptions.sortedWith(
        compareBy<StatusSubscription> { statusRank(it) }
            .thenBy { it.feedTitle.lowercase() },
    )

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

// Per-row job badge: hidden when idle (never requested or completed), so the
// list stays quiet unless something is queued, running, or broken.
@Composable
private fun JobBadge(label: String, job: FeedJob?, fallbackDanger: Boolean) {
    if (job == null || job.status == "completed") {
        if (fallbackDanger) StatusBadge("${label}失敗", BadgeTone.Danger)
        return
    }
    when {
        job.stalled -> StatusBadge("${label}中断", BadgeTone.Danger)
        job.status == "failed" -> StatusBadge("${label}失敗", BadgeTone.Danger)
        job.status == "running" -> StatusBadge("${label}中", BadgeTone.Warn)
        else -> StatusBadge("${label}待ち", BadgeTone.Warn)
    }
}
