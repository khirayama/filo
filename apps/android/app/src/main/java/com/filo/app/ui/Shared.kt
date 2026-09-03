package com.filo.app.ui

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.ui.draw.alpha
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.filo.app.api.ArticleListItem
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import com.filo.app.WirePalette

enum class BadgeTone { Muted, Warn, Danger, Ok }

@Composable
fun StatusBadge(label: String, tone: BadgeTone = BadgeTone.Muted) {
    val color = when (tone) {
        BadgeTone.Muted -> WirePalette.Muted
        BadgeTone.Warn -> WirePalette.Warn
        BadgeTone.Danger -> WirePalette.Danger
        BadgeTone.Ok -> WirePalette.Ok
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
                TextButton(onClick = onRetry) { Text(tr("再試行")) }
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
            style = MaterialTheme.typography.labelMedium,
            color = if (selected) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
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
fun FaviconImage(url: String?, modifier: Modifier = Modifier, siteUrl: String? = null) {
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
    onOpenFeed: (() -> Unit)? = null,
    onOpen: () -> Unit,
    onToggleRead: (() -> Unit)? = null,
    onToggleReadingList: (() -> Unit)? = null,
    onToggleBookmark: (() -> Unit)? = null,
    translations: TitleTranslationStore? = null,
    horizontalPadding: Dp = 16.dp,
) {
    var showOriginal by remember { mutableStateOf(false) }
    // 翻訳は端末内で走るので、届いた分から順に差し替わる。行のトグルで原文に戻せる。
    val translatedTitle = translations?.titleFor(article.id)
    val isTranslated = translatedTitle != null
    val displayTitle = if (showOriginal) article.title else translatedTitle ?: article.title
    val isDesktop = LocalConfiguration.current.screenWidthDp >= 1024
    val titleStyle = MaterialTheme.typography.bodyMedium.copy(lineHeight = 20.sp)
    val hoverInteractionSource = remember { MutableInteractionSource() }
    val isHovered by hoverInteractionSource.collectIsHoveredAsState()

    Surface(
        color = if (isDesktop && isHovered) {
            MaterialTheme.colorScheme.onSurface.copy(alpha = 0.03f)
        } else {
            Color.Transparent
        },
        border = if (selected) BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null,
        modifier = Modifier
            .fillMaxWidth()
            .then(if (isDesktop) Modifier.hoverable(hoverInteractionSource) else Modifier)
            .alpha(if (article.userState.isRead) 0.55f else 1f),
    ) {
        if (isDesktop) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    modifier = Modifier.width(120.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    feedTitle(article.feedTitle, onOpenFeed, Modifier.weight(1f))
                    translationButton(isTranslated, showOriginal) { showOriginal = !showOriginal }
                }
                articleTitle(
                    displayTitle,
                    titleStyle,
                    article.userState.isRead,
                    Modifier.weight(1f).padding(start = 16.dp),
                    singleLine = true,
                    onOpen = onOpen,
                )
                if (!article.previewText.isNullOrEmpty()) {
                    Text(
                        article.previewText.orEmpty(),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                }
                Text(
                    compactRelativeTime(article.publishedAt ?: article.fetchedAt),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                ArticleActions(
                    article = article,
                    onToggleRead = onToggleRead,
                    onToggleReadingList = onToggleReadingList,
                    onToggleBookmark = onToggleBookmark,
                    visible = isHovered || selected || article.userState.inReadingList || article.userState.isBookmarked,
                )
            }
        } else {
            Column(
                modifier = Modifier
                    .padding(horizontal = horizontalPadding)
                    .padding(top = 1.dp, bottom = 8.dp),
                verticalArrangement = Arrangement.spacedBy(0.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    feedTitle(article.feedTitle, onOpenFeed, Modifier.weight(1f))
                    translationButton(isTranslated, showOriginal) { showOriginal = !showOriginal }
                    Spacer(modifier = Modifier.weight(1f))
                    Text(
                        compactRelativeTime(article.publishedAt ?: article.fetchedAt),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    ArticleActions(
                        article = article,
                        onToggleRead = onToggleRead,
                        onToggleReadingList = onToggleReadingList,
                        onToggleBookmark = onToggleBookmark,
                    )
                }
                articleTitle(
                    displayTitle,
                    titleStyle,
                    article.userState.isRead,
                    Modifier.fillMaxWidth(),
                    singleLine = false,
                    onOpen = onOpen,
                )
                if (!article.previewText.isNullOrEmpty()) {
                    Text(
                        article.previewText.orEmpty(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
private fun feedTitle(title: String, onOpenFeed: (() -> Unit)?, modifier: Modifier) {
    val feedModifier = if (onOpenFeed != null) modifier.clickable { onOpenFeed() } else modifier
    Text(
        title,
        modifier = feedModifier,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun translationButton(isTranslated: Boolean, showOriginal: Boolean, onClick: () -> Unit) {
    if (isTranslated) {
        Surface(
            onClick = onClick,
            shape = MaterialTheme.shapes.extraSmall,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)),
            color = Color.Transparent,
        ) {
            Text(
                tr(if (showOriginal) "翻訳" else "原文"),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp),
            )
        }
    }
}

@Composable
private fun articleTitle(
    title: String,
    style: androidx.compose.ui.text.TextStyle,
    isRead: Boolean,
    modifier: Modifier,
    singleLine: Boolean,
    onOpen: () -> Unit,
) {
    Text(
        title,
        style = style,
        fontWeight = if (isRead) FontWeight.Normal else FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurface,
        maxLines = if (singleLine) 1 else Int.MAX_VALUE,
        overflow = if (singleLine) TextOverflow.Ellipsis else TextOverflow.Clip,
        modifier = modifier.clickable(onClick = onOpen),
    )
}

@Composable
private fun ArticleActions(
    article: ArticleListItem,
    onToggleRead: (() -> Unit)?,
    onToggleReadingList: (() -> Unit)?,
    onToggleBookmark: (() -> Unit)?,
    visible: Boolean = true,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.alpha(if (visible) 1f else 0f),
    ) {
        if (onToggleRead != null) {
            Surface(
                onClick = onToggleRead,
                color = Color.Transparent,
                modifier = Modifier.size(32.dp),
            ) {
                FiloIcon(
                    FiloIconName.CheckCircle,
                    contentDescription = tr(if (article.userState.isRead) "未読にする" else "既読にする"),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(7.dp),
                )
            }
        }
        if (onToggleReadingList != null) {
            Surface(
                onClick = onToggleReadingList,
                color = Color.Transparent,
                modifier = Modifier.size(32.dp),
            ) {
                FiloIcon(
                    FiloIconName.QueueAdd,
                    contentDescription = tr(if (article.userState.inReadingList) "リーディングリストから削除" else "リーディングリストに追加"),
                    tint = if (article.userState.inReadingList) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(7.dp),
                )
            }
        }
        if (onToggleBookmark != null) {
            Surface(
                onClick = onToggleBookmark,
                color = Color.Transparent,
                modifier = Modifier.size(32.dp),
            ) {
                FiloIcon(
                    FiloIconName.Bookmark,
                    contentDescription = tr(if (article.userState.isBookmarked) "ブックマークを解除" else "ブックマーク"),
                    tint = if (article.userState.isBookmarked) WirePalette.Star else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(7.dp),
                    filled = article.userState.isBookmarked,
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
            minutes < 1 -> AppStrings.get("たった今")
            minutes < 60 -> "$minutes${AppStrings.get("分前")}"
            minutes < 60 * 24 -> "${minutes / 60}${AppStrings.get("時間前")}"
            minutes < 60 * 24 * 7 -> "${minutes / (60 * 24)}${AppStrings.get("日前")}"
            else -> DateTimeFormatter.ofPattern("yyyy/M/d", Locale.getDefault())
                .format(instant.atZone(java.time.ZoneId.systemDefault()))
        }
    } catch (e: Exception) {
        ""
    }
}

fun compactRelativeTime(iso: String?): String {
    if (iso.isNullOrBlank()) return ""
    return try {
        val instant = Instant.from(DateTimeFormatter.ISO_DATE_TIME.parse(iso))
        val minutes = (System.currentTimeMillis() - instant.toEpochMilli()) / 60_000
        when {
            minutes < 1 -> "now"
            minutes < 60 -> "${minutes}${AppStrings.get("分")}"
            minutes < 60 * 24 -> "${minutes / 60}${AppStrings.get("時間")}"
            minutes < 60 * 24 * 7 -> "${minutes / (60 * 24)}${AppStrings.get("日")}"
            else -> DateTimeFormatter.ofPattern("M/d", Locale.getDefault())
                .format(instant.atZone(java.time.ZoneId.systemDefault()))
        }
    } catch (e: Exception) {
        ""
    }
}
