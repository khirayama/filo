package com.filo.app.ui

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.filo.app.api.ArticleListItem
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

enum class BadgeTone { Muted, Warn, Danger, Ok }

@Composable
fun StatusBadge(label: String, tone: BadgeTone = BadgeTone.Muted) {
    val color = when (tone) {
        BadgeTone.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
        BadgeTone.Warn -> Color(0xFF9A6700)
        BadgeTone.Danger -> MaterialTheme.colorScheme.error
        BadgeTone.Ok -> Color(0xFF2F6A3D)
    }
    Surface(
        shape = CircleShape,
        color = Color.Transparent,
        border = BorderStroke(1.dp, color.copy(alpha = 0.6f)),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = color,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
        )
    }
}

@Composable
fun ErrorBanner(message: String, onRetry: (() -> Unit)? = null) {
    Surface(
        shape = MaterialTheme.shapes.small,
        color = Color.Transparent,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.5f)),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = message,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
            )
            if (onRetry != null) {
                TextButton(onClick = onRetry) { Text("再試行") }
            }
        }
    }
}

@Composable
fun FilterChipButton(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        shape = CircleShape,
        color = if (selected) MaterialTheme.colorScheme.onSurface else Color.Transparent,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        onClick = onClick,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = if (selected) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
        )
    }
}

@Composable
fun FaviconPlaceholder(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(16.dp)
            .clip(RoundedCornerShape(3.dp))
            .background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.12f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = "F",
            style = MaterialTheme.typography.labelSmall.copy(
                fontSize = 9.sp,
                fontWeight = FontWeight.Bold,
                lineHeight = 9.sp,
            ),
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
        )
    }
}

@Composable
fun FaviconImage(url: String?, siteUrl: String? = null, modifier: Modifier = Modifier) {
    val effectiveUrl = url ?: siteUrl?.let { site ->
        try {
            val host = java.net.URI(site).host ?: return@let null
            "https://www.google.com/s2/favicons?domain=$host&sz=32"
        } catch (_: Exception) { null }
    }
    if (effectiveUrl != null) {
        var failed by remember(effectiveUrl) { mutableStateOf(false) }
        if (failed) {
            FaviconPlaceholder(modifier = modifier)
        } else {
            AsyncImage(
                model = effectiveUrl,
                contentDescription = null,
                modifier = modifier
                    .size(16.dp)
                    .clip(RoundedCornerShape(3.dp)),
                onError = { failed = true },
            )
        }
    } else {
        FaviconPlaceholder(modifier = modifier)
    }
}

@Composable
fun ArticleRow(
    article: ArticleListItem,
    selected: Boolean = false,
    onOpen: () -> Unit,
    onToggleRead: (() -> Unit)? = null,
    onToggleReadingList: (() -> Unit)? = null,
    onToggleBookmark: (() -> Unit)? = null,
    translations: TitleTranslationStore? = null,
) {
    var showOriginal by remember { mutableStateOf(false) }
    // 翻訳は端末内で走るので、届いた分から順に差し替わる。行のトグルで原文に戻せる。
    val translatedTitle = translations?.titleFor(article.id)
    val isTranslated = translatedTitle != null
    val displayTitle = if (showOriginal) article.title else translatedTitle ?: article.title

    Surface(
        onClick = onOpen,
        color = if (selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(1.dp),
        ) {
            Text(
                displayTitle,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (article.userState.isRead) FontWeight.Normal else FontWeight.SemiBold,
                color = if (article.userState.isRead) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (!article.previewText.isNullOrBlank()) {
                Text(
                    article.previewText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                FaviconImage(url = article.feedFaviconUrl, siteUrl = article.canonicalUrl)
                if (onToggleRead != null) {
                    Surface(onClick = onToggleRead, shape = MaterialTheme.shapes.extraSmall, color = Color.Transparent) {
                        Icon(
                            Icons.Default.CheckCircle,
                            contentDescription = if (article.userState.isRead) "未読にする" else "既読にする",
                            tint = if (article.userState.isRead) {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            } else {
                                MaterialTheme.colorScheme.primary
                            },
                            modifier = Modifier.size(18.dp).padding(horizontal = 1.dp),
                        )
                    }
                }
                if (onToggleReadingList != null) {
                    Surface(onClick = onToggleReadingList, shape = MaterialTheme.shapes.extraSmall, color = Color.Transparent) {
                        Icon(
                            Icons.AutoMirrored.Filled.List,
                            contentDescription = if (article.userState.inReadingList) "リーディングリストから削除" else "リーディングリストに追加",
                            tint = if (article.userState.inReadingList) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(18.dp).padding(horizontal = 1.dp),
                        )
                    }
                } else if (article.userState.inReadingList) {
                    Icon(Icons.AutoMirrored.Filled.List, contentDescription = "リーディングリスト済み", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp))
                }
                if (onToggleBookmark != null) {
                    Surface(onClick = onToggleBookmark, shape = MaterialTheme.shapes.extraSmall, color = Color.Transparent) {
                        Icon(
                            if (article.userState.isBookmarked) Icons.Default.Bookmark else Icons.Default.BookmarkBorder,
                            contentDescription = if (article.userState.isBookmarked) "ブックマークを解除" else "ブックマーク",
                            tint = if (article.userState.isBookmarked) Color(0xFFE8A100) else MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(18.dp).padding(horizontal = 1.dp),
                        )
                    }
                } else if (article.userState.isBookmarked) {
                    Icon(Icons.Default.Bookmark, contentDescription = "ブックマーク済み", tint = Color(0xFFE8A100), modifier = Modifier.size(16.dp))
                }
                if (isTranslated) {
                    Surface(
                        onClick = { showOriginal = !showOriginal },
                        shape = MaterialTheme.shapes.extraSmall,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)),
                        color = Color.Transparent,
                    ) {
                        Text(
                            if (showOriginal) "翻訳" else "原文",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp),
                        )
                    }
                }
                Text(
                    article.feedTitle,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Text(
                    relativeTime(article.publishedAt ?: article.fetchedAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

fun relativeTime(iso: String?): String {
    if (iso.isNullOrBlank()) return ""
    return try {
        val instant = Instant.from(DateTimeFormatter.ISO_DATE_TIME.parse(iso))
        val minutes = (System.currentTimeMillis() - instant.toEpochMilli()) / 60_000
        when {
            minutes < 1 -> "たった今"
            minutes < 60 -> "${minutes}分前"
            minutes < 60 * 24 -> "${minutes / 60}時間前"
            minutes < 60 * 24 * 7 -> "${minutes / (60 * 24)}日前"
            else -> DateTimeFormatter.ofPattern("yyyy/M/d", Locale.getDefault())
                .format(instant.atZone(java.time.ZoneId.systemDefault()))
        }
    } catch (e: Exception) {
        ""
    }
}
