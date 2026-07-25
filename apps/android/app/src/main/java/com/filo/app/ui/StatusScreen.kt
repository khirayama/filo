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
import com.filo.app.api.TranslationCoverage
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
    var isTranslating by remember { mutableStateOf(false) }
    var isDiscarding by remember { mutableStateOf(false) }
    var busyFeedId by remember { mutableStateOf<Int?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var polling by remember { mutableStateOf(true) }
    var showDiscardAllConfirm by remember { mutableStateOf(false) }
    var discardFeedTarget by remember { mutableStateOf<Int?>(null) }

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

    fun discardOutcome(removed: Int) =
        if (removed > 0) "${removed}件を破棄しました。" else "破棄する項目がありません。"

    fun runDiscardAll() {
        scope.launch {
            isDiscarding = true
            notice = null
            try {
                notice = discardOutcome(ApiClient.discardTranslations().removed)
                load()
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forError(e)
            }
            isDiscarding = false
        }
    }

    fun runDiscardFeed(feedId: Int) {
        scope.launch {
            busyFeedId = feedId
            isDiscarding = true
            notice = null
            try {
                notice = discardOutcome(ApiClient.discardFeedTranslations(feedId).removed)
                load()
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forError(e)
            }
            isDiscarding = false
            busyFeedId = null
        }
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
                    OutlinedButton(
                        enabled = !isTranslating && s.subscriptionStatuses.any {
                            it.translation.ready < it.translation.needed
                        },
                        onClick = {
                            scope.launch {
                                isTranslating = true
                                notice = null
                                try {
                                    val result = ApiClient.translateAll()
                                    notice = if (result.enqueued > 0) {
                                        "${result.enqueued}件のタイトル翻訳をキューに追加しました。完了すると一覧に反映されます。"
                                    } else {
                                        "翻訳が必要なタイトルはありません。"
                                    }
                                    load()
                                } catch (e: Exception) {
                                    errorMessage = ErrorMessages.forError(e)
                                }
                                isTranslating = false
                            }
                        },
                    ) { Text(if (isTranslating) "翻訳中…" else "すべて翻訳") }
                    val discardable = s.subscriptionStatuses.sumOf { it.translation.pending + it.translation.failed }
                    OutlinedButton(
                        enabled = !isDiscarding && discardable > 0,
                        onClick = { showDiscardAllConfirm = true },
                    ) { Text("キューを破棄") }
                }
                notice?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(
                    "購読 ${s.feeds.total}件・記事 ${s.articleTotal}件" +
                        (if (s.translatorPending > 0) "・翻訳キュー 残り${s.translatorPending}件" else "") +
                        (s.feeds.lastFetchedAt?.let { "・最終取得 ${relativeTime(it)}" } ?: "") +
                        "・約${POLL_INTERVAL_MS / 1000}秒ごとに自動更新",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TranslationProgress(s)
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
                        // Pending rows keep the action available so a stalled queue
                        // can be re-kicked, but completed feeds do not need a
                        // translation action.
                        val translateInFlight = busyFeedId == sub.feedId && isTranslating
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
                                TranslationBadge(sub.translation)
                                Text(
                                    sub.lastFetchedAt?.let { relativeTime(it) } ?: "—",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Text(
                                coverageLine(sub.translation),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
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
                            if (sub.translation.failed > 0) {
                                sub.translation.lastError?.let {
                                    Text(
                                        "翻訳失敗: $it",
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
                                TextButton(
                                    enabled = !isTranslating && sub.translation.ready < sub.translation.needed,
                                    onClick = {
                                        scope.launch {
                                            busyFeedId = sub.feedId
                                            isTranslating = true
                                            notice = null
                                            try {
                                                val result = ApiClient.translateFeed(sub.feedId)
                                                notice = if (result.enqueued > 0) {
                                                    "${result.enqueued}件のタイトル翻訳をキューに追加しました。"
                                                } else {
                                                    "翻訳が必要なタイトルはありません。"
                                                }
                                                load()
                                            } catch (e: Exception) {
                                                errorMessage = ErrorMessages.forError(e)
                                            }
                                            isTranslating = false
                                            busyFeedId = null
                                        }
                                    },
                                ) { Text(if (translateInFlight) "翻訳中…" else "翻訳") }
                                TextButton(
                                    enabled = !isDiscarding && (sub.translation.pending + sub.translation.failed) > 0,
                                    onClick = { discardFeedTarget = sub.feedId },
                                ) { Text("破棄") }
                            }
                        }
                        HorizontalDivider()
                    }
                }
            }
        }
    }

    if (showDiscardAllConfirm) {
        AlertDialog(
            onDismissRequest = { showDiscardAllConfirm = false },
            title = { Text("キューを破棄") },
            text = { Text("翻訳キューを破棄しますか？完了した翻訳は残ります。") },
            confirmButton = {
                TextButton(onClick = {
                    showDiscardAllConfirm = false
                    runDiscardAll()
                }) { Text("破棄") }
            },
            dismissButton = {
                TextButton(onClick = { showDiscardAllConfirm = false }) { Text("キャンセル") }
            },
        )
    }

    discardFeedTarget?.let { feedId ->
        AlertDialog(
            onDismissRequest = { discardFeedTarget = null },
            title = { Text("キューを破棄") },
            text = { Text("このフィードの翻訳待ち・失敗を破棄しますか？完了した翻訳は残ります。") },
            confirmButton = {
                TextButton(onClick = {
                    discardFeedTarget = null
                    runDiscardFeed(feedId)
                }) { Text("破棄") }
            },
            dismissButton = {
                TextButton(onClick = { discardFeedTarget = null }) { Text("キャンセル") }
            },
        )
    }
}

// Keep the same actionable-first order as the web and iOS status screens.
// This is recalculated from every polled snapshot, so rows move when a fetch
// or translation changes state.
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
    if (sub.translation.processing > 0) return 4
    if (sub.translation.queued > 0) return 5
    if (sub.feedStatus == "paused") return 6
    if (sub.translation.missing > 0) return 7
    return 8
}

private fun hasStatusAttention(sub: StatusSubscription): Boolean =
    sub.consecutiveFailures > 0 ||
        sub.fetchJob?.status == "failed" ||
        sub.lastResult == "error" ||
        sub.translation.failed > 0

// Full per-feed translation picture: how much is done, and if incomplete,
// exactly why (in flight / queued / failed / not yet requested / not translatable).
private fun coverageLine(t: TranslationCoverage): String {
    if (t.articles == 0) return "翻訳: 記事なし"
    val bits = buildList {
        add("翻訳: 完了 ${t.ready}/${t.needed}")
        if (t.processing > 0) add("翻訳中 ${t.processing}")
        if (t.queued > 0) add("順番待ち ${t.queued}")
        if (t.failed > 0) add("失敗 ${t.failed}")
        if (t.missing > 0) add("未リクエスト ${t.missing}")
        if (t.untranslatable > 0) add("対象外 ${t.untranslatable}記事(言語不明等)")
    }
    return bits.joinToString("・")
}

// Per-feed translation state, most urgent first: in flight to the model
// (翻訳中), then waiting in line (順番待ち), then failures.
@Composable
private fun TranslationBadge(t: TranslationCoverage) {
    when {
        t.processing > 0 -> StatusBadge("翻訳中 ${t.processing}", BadgeTone.Warn)
        t.queued > 0 -> StatusBadge("順番待ち ${t.queued}", BadgeTone.Warn)
        t.failed > 0 -> StatusBadge("翻訳失敗 ${t.failed}", BadgeTone.Danger)
    }
}

// Overall translation queue progress: a done/needed bar, the live state
// breakdown, and the titles currently in flight to the model.
@Composable
private fun TranslationProgress(s: StatusOverview) {
    val subs = s.subscriptionStatuses
    val needed = subs.sumOf { it.translation.needed }
    if (needed == 0) return
    val ready = subs.sumOf { it.translation.ready }
    val processing = subs.sumOf { it.translation.processing }
    val queued = subs.sumOf { it.translation.queued }
    val failed = subs.sumOf { it.translation.failed }
    val missing = subs.sumOf { it.translation.missing }
    val fraction = ready.toFloat() / needed.toFloat()
    val percent = (fraction * 100).roundToInt()
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Bottom,
        ) {
            Text("翻訳の進行状況", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
            Text(
                "完了 $ready / $needed（$percent%）",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        LinearProgressIndicator(
            progress = { fraction },
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            "翻訳中 $processing・順番待ち $queued・失敗 $failed" +
                (if (missing > 0) "・未リクエスト $missing" else ""),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (s.translatorCurrent.isNotEmpty()) {
            val live = s.translatorCurrent.joinToString("　") { c ->
                if (c.languages.isEmpty()) c.title else "${c.title}（${c.languages.joinToString("/")}）"
            }
            Text(
                "今翻訳中: $live",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

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
