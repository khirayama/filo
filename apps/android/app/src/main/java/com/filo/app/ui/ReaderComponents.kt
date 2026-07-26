package com.filo.app.ui

import android.annotation.SuppressLint
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

data class TtsQueueItem(
    val id: String = java.util.UUID.randomUUID().toString(),
    val url: String,
    val title: String,
    val extractionState: String = "loading",
    val chunks: List<String> = emptyList(),
    val lang: String? = null,
    // サーバー playback-queue 上の記事 id。サーバー未同期(未解決)の項目は null。
    val articleId: Int? = null,
)

// MARK: - Reader WebView (実際の Web ページを開いて読む + 音読用テキスト抽出)

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ReaderWebView(
    url: String,
    onTextExtracted: (text: String, lang: String?) -> Unit,
    onExtractionFailed: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    AndroidView(
        factory = { ctx ->
                var hasExtracted = false
                val readabilityJs = ctx.assets.open("Readability.js").bufferedReader().readText()

                WebView(ctx).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true

                    webViewClient = object : WebViewClient() {
                        override fun onPageFinished(view: WebView, pageUrl: String?) {
                            if (hasExtracted) return
                            hasExtracted = true

                            val script = """
                                $readabilityJs
                                ;(function() {
                                    var lang = document.documentElement.lang || null;
                                    var desc = '';
                                    try {
                                        var m = document.querySelector('meta[property="og:description"]') ||
                                                document.querySelector('meta[name="description"]');
                                        if (m) desc = (m.getAttribute('content') || '').trim();
                                    } catch(e) {}

                                    function prependDesc(text) {
                                        if (desc && text.indexOf(desc) === -1 && text.indexOf(desc.substring(0, 40)) === -1) {
                                            return desc + '\n\n' + text;
                                        }
                                        return text;
                                    }

                                    try {
                                        var article = new Readability(document.cloneNode(true)).parse();
                                        if (article && article.textContent && article.textContent.trim().length > 50) {
                                            return JSON.stringify({
                                                text: prependDesc(article.textContent.trim()),
                                                lang: article.lang || lang
                                            });
                                        }
                                    } catch(e) {}
                                    try {
                                        var fallback = document.body.innerText || '';
                                        if (fallback.trim().length > 50) {
                                            return JSON.stringify({ text: prependDesc(fallback.trim()), lang: lang });
                                        }
                                    } catch(e2) {}
                                    return null;
                                })()
                            """.trimIndent()

                            view.evaluateJavascript(script) { result ->
                                if (result == null || result == "null") {
                                    onExtractionFailed()
                                    return@evaluateJavascript
                                }
                                val jsonStr = result
                                    .removeSurrounding("\"")
                                    .replace("\\\"", "\"")
                                    .replace("\\\\", "\\")
                                    .replace("\\/", "/")
                                    .replace("\\n", "\n")
                                    .replace("\\t", "\t")

                                try {
                                    val json = org.json.JSONObject(jsonStr)
                                    val articleText = json.optString("text", "")
                                    val articleLang = json.optString("lang", null.toString())
                                        .takeIf { it != "null" }
                                    onTextExtracted(articleText, articleLang)
                                } catch (_: Exception) {
                                }
                            }
                        }
                    }
                    loadUrl(url)
                }
            },
        modifier = modifier,
    )
}

// MARK: - TTS player bar (placed in AppNavigation)

@Composable
fun TtsPlayerBar(
    displayUrl: String,
    displayTitle: String,
    isPlaying: Boolean,
    canPlay: Boolean,
    queueCount: Int,
    showAddButton: Boolean,
    speechRate: Float,
    voiceOptions: List<String> = emptyList(),
    selectedVoice: String? = null,
    onSelectVoice: (String?) -> Unit = {},
    onPlayPause: () -> Unit,
    onAdd: () -> Unit,
    onShowQueue: () -> Unit,
    onCycleRate: () -> Unit,
) {
    val domain = remember(displayUrl) {
        try { java.net.URI(displayUrl).host?.removePrefix("www.") ?: "" }
        catch (_: Exception) { "" }
    }

    HorizontalDivider()
    Surface(tonalElevation = 1.dp) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(20.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(MaterialTheme.colorScheme.surfaceContainerHigh),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        domain.take(1).uppercase(),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                Row(
                    modifier = Modifier
                        .weight(1f)
                        .horizontalScroll(rememberScrollState()),
                ) {
                    Text(
                        displayTitle.ifEmpty { "読み上げ" },
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                        maxLines = 1,
                        softWrap = false,
                    )
                }

                IconButton(
                    onClick = onPlayPause,
                    enabled = canPlay,
                    modifier = Modifier.size(36.dp),
                ) {
                    Icon(
                        if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = if (isPlaying) "一時停止" else "再生",
                        modifier = Modifier.size(24.dp),
                    )
                }
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Surface(
                    onClick = onShowQueue,
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                ) {
                    Text(
                        "${queueCount}件",
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }

                if (showAddButton) {
                    Surface(
                        onClick = onAdd,
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.surfaceContainerHigh,
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Icon(
                                Icons.Default.Add,
                                contentDescription = null,
                                modifier = Modifier.size(14.dp),
                            )
                            Text("追加", style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }

                Spacer(modifier = Modifier.weight(1f))

                // 再生中記事の言語の読み上げ音声を選ぶ。「自動」でデフォルト音声に戻す
                if (voiceOptions.isNotEmpty()) {
                    var voiceMenuOpen by remember { mutableStateOf(false) }
                    Box {
                        Surface(
                            onClick = { voiceMenuOpen = true },
                            shape = CircleShape,
                            color = MaterialTheme.colorScheme.surfaceContainerHigh,
                        ) {
                            Text(
                                "音声",
                                style = MaterialTheme.typography.labelMedium,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                            )
                        }
                        DropdownMenu(expanded = voiceMenuOpen, onDismissRequest = { voiceMenuOpen = false }) {
                            DropdownMenuItem(
                                text = { Text(if (selectedVoice == null) "自動 ✓" else "自動") },
                                onClick = {
                                    onSelectVoice(null)
                                    voiceMenuOpen = false
                                },
                            )
                            voiceOptions.forEach { name ->
                                DropdownMenuItem(
                                    text = { Text(if (selectedVoice == name) "$name ✓" else name) },
                                    onClick = {
                                        onSelectVoice(name)
                                        voiceMenuOpen = false
                                    },
                                )
                            }
                        }
                    }
                }

                Surface(
                    onClick = onCycleRate,
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                ) {
                    Text(
                        formatRate(speechRate),
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
            }
        }
    }
}

internal fun formatRate(r: Float): String =
    if (r % 1.0f == 0f) "${r.toInt()}.0x" else "${r}x"

// MARK: - Queue sheet

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TtsQueueSheet(
    queue: List<TtsQueueItem>,
    currentIndex: Int,
    playState: String,
    onSkipTo: (Int) -> Unit,
    onRemove: (Int) -> Unit,
    onMove: (index: Int, direction: Int) -> Unit,
    onClearAll: () -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(modifier = Modifier.padding(bottom = 32.dp)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("再生キュー", style = MaterialTheme.typography.titleMedium)
                if (queue.size > 1) {
                    TextButton(onClick = {
                        onClearAll()
                        onDismiss()
                    }) {
                        Text("すべて削除", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
            queue.forEachIndexed { index, item ->
                Surface(
                    onClick = { onSkipTo(index) },
                    color = if (index == currentIndex) {
                        MaterialTheme.colorScheme.primaryContainer
                    } else {
                        Color.Transparent
                    },
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = 16.dp, end = 4.dp, top = 12.dp, bottom = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text(
                            "${index + 1}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (index == currentIndex) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                            fontWeight = if (index == currentIndex) FontWeight.Bold else FontWeight.Normal,
                            modifier = Modifier.width(24.dp),
                        )
                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                item.title,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = if (index == currentIndex) FontWeight.SemiBold else FontWeight.Normal,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            when (item.extractionState) {
                                "loading" -> Text(
                                    "読み込み中...",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                "failed" -> Text(
                                    "取得失敗",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.error,
                                )
                                "ready" -> {}
                            }
                        }
                        IconButton(
                            onClick = { onMove(index, -1) },
                            enabled = index > 0,
                            modifier = Modifier.size(32.dp),
                        ) {
                            Icon(
                                Icons.Default.KeyboardArrowUp,
                                contentDescription = "上へ移動",
                                modifier = Modifier.size(18.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        IconButton(
                            onClick = { onMove(index, 1) },
                            enabled = index < queue.size - 1,
                            modifier = Modifier.size(32.dp),
                        ) {
                            Icon(
                                Icons.Default.KeyboardArrowDown,
                                contentDescription = "下へ移動",
                                modifier = Modifier.size(18.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        IconButton(
                            onClick = {
                                val wasLast = queue.size == 1
                                onRemove(index)
                                if (wasLast) onDismiss()
                            },
                            modifier = Modifier.size(36.dp),
                        ) {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = "削除",
                                modifier = Modifier.size(16.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}

// Text preparation (ported from extension ttsTextPrep.ts)

internal fun cleanTextForSpeech(text: String): String {
    var t = text
    t = t.replace(Regex("```[\\s\\S]*?```"), "")
    t = t.replace(Regex("`[^`]+`"), "")
    t = t.replace(Regex("<[^>]+>"), "")
    t = t.replace(Regex("https?://[^\\s)}\\]>]+"), "")
    t = t.replace(Regex("[\\w.+\\-]+@[\\w\\-]+\\.[\\w.\\-]+"), "")
    t = t.replace(Regex("\\[(image|photo|img|figure|caption|ad|advertisement|banner|nav|menu|sidebar|footer|header)]", RegexOption.IGNORE_CASE), "")
    t = t.replace(Regex("[^\\S\\n]{2,}"), " ")
    t = t.replace(Regex("\\n{3,}"), "\n\n")
    return t.trim()
}

internal fun splitIntoChunks(text: String, maxLength: Int = 3000): List<String> {
    val paragraphs = text.split(Regex("\\n\\n+"))
    val chunks = mutableListOf<String>()
    var current = ""
    for (para in paragraphs) {
        val trimmed = para.trim()
        if (trimmed.isEmpty()) continue
        if (current.length + trimmed.length + 1 <= maxLength) {
            current += (if (current.isEmpty()) "" else "\n\n") + trimmed
            continue
        }
        if (current.isNotEmpty()) { chunks.add(current); current = "" }
        if (trimmed.length <= maxLength) { current = trimmed; continue }
        splitLongText(trimmed, maxLength, chunks)
    }
    if (current.isNotEmpty()) chunks.add(current)
    return chunks.ifEmpty { listOf(text.trim()) }
}

private fun splitLongText(text: String, maxLength: Int, out: MutableList<String>) {
    var remaining = text
    while (remaining.length > maxLength) {
        val slice = remaining.take(maxLength)
        var splitAt = findLastMatch(slice, Regex("[。.!?！？]\\s*"))
        if (splitAt < maxLength * 3 / 10) splitAt = findLastMatch(slice, Regex("[、,;；]\\s*"))
        if (splitAt < maxLength * 3 / 10) splitAt = slice.lastIndexOf(' ').let { if (it >= 0) it + 1 else -1 }
        if (splitAt < maxLength * 3 / 10) splitAt = maxLength
        out.add(remaining.take(splitAt).trim())
        remaining = remaining.drop(splitAt).trim()
    }
    if (remaining.isNotEmpty()) out.add(remaining)
}

private fun findLastMatch(text: String, pattern: Regex): Int {
    var last = -1
    pattern.findAll(text).forEach { match -> last = match.range.last + 1 }
    return last
}
