package com.filo.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.filo.app.LanguagePreference
import com.filo.app.api.ArticleListItem
import com.filo.app.api.ErrorMessages
import com.filo.app.api.Subscription
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// Feed health as a quiet inline status; renders nothing for healthy feeds.
@Composable
fun SubscriptionHealth(subscription: Subscription) {
    when {
        subscription.initialFetchStatus == "failed" ->
            FiloStatusText(ErrorMessages.initialFetchMessage(subscription.initialFetchErrorCode), BadgeTone.Danger)
        subscription.initialFetchStatus == "fetching" -> FiloStatusText(tr("記事取得中"))
        subscription.feedHealthStatus == "paused" -> FiloStatusText(tr("更新停止中"), BadgeTone.Danger)
        subscription.feedHealthStatus == "stale" -> FiloStatusText(tr("しばらく更新なし"), BadgeTone.Warn)
    }
}

@Composable
fun ArticleRow(
    article: ArticleListItem,
    onOpen: () -> Unit,
    selected: Boolean = false,
    // Off inside a single subscription, where every row has the same feed.
    showFeed: Boolean = true,
    onOpenFeed: (() -> Unit)? = null,
    onLongPress: (() -> Unit)? = null,
    onToggleRead: (() -> Unit)? = null,
    onToggleReadingList: (() -> Unit)? = null,
    onToggleBookmark: (() -> Unit)? = null,
    translations: TitleTranslationStore? = null,
) {
    val colors = Filo.colors
    var showOriginal by remember { mutableStateOf(false) }
    // 翻訳は端末内で走るので、届いた分から順に差し替わる。行のトグルで原文に戻せる。
    val translatedTitle = translations?.titleFor(article.id)
    val isTranslated = translatedTitle != null
    val displayTitle = if (showOriginal) article.title else translatedTitle ?: article.title
    val isDesktop = LocalConfiguration.current.screenWidthDp >= 1024
    val hoverInteractionSource = remember { MutableInteractionSource() }
    val isHovered by hoverInteractionSource.collectIsHoveredAsState()
    val isRead = article.userState.isRead
    val active = selected || (isDesktop && isHovered)

    val rowModifier = Modifier
        .fillMaxWidth()
        .then(if (isDesktop) Modifier.hoverable(hoverInteractionSource) else Modifier)
        .background(if (active) colors.rowHover else colors.bg)
        .drawBehind {
            if (selected) drawRect(colors.accent, size = size.copy(width = 3.dp.toPx()))
        }
        .bottomBorder(colors.mutedBorder)

    val title: @Composable (Modifier, Boolean) -> Unit = { modifier, singleLine ->
        Text(
            displayTitle,
            fontSize = if (singleLine) 14.sp else 15.sp,
            lineHeight = if (singleLine) 20.sp else 22.sp,
            fontWeight = if (isRead) FontWeight.Normal else FontWeight.SemiBold,
            color = if (isRead) colors.muted else colors.text,
            maxLines = if (singleLine) 1 else 2,
            overflow = TextOverflow.Ellipsis,
            modifier = modifier.combinedClickable(onClick = onOpen, onLongClick = onLongPress),
        )
    }
    val feed: @Composable (Modifier) -> Unit = { modifier ->
        Text(
            article.feedTitle,
            fontSize = 12.sp,
            color = colors.muted,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = modifier.then(if (onOpenFeed != null) Modifier.clickable(onClick = onOpenFeed) else Modifier),
        )
    }
    val date: @Composable () -> Unit = {
        Text(compactRelativeTime(article.publishedAt ?: article.fetchedAt), fontSize = 12.sp, color = colors.muted, maxLines = 1)
    }
    val toggle: @Composable () -> Unit = {
        if (isTranslated) TranslationToggle(showOriginal) { showOriginal = !showOriginal }
    }

    if (isDesktop) {
        // One dense line per article; the toggles replace the date on hover.
        Row(
            modifier = rowModifier.height(40.dp).padding(horizontal = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (showFeed) feed(Modifier.width(160.dp))
            Row(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                toggle()
                title(Modifier.weight(1f, fill = false), true)
                article.previewText?.takeIf { it.isNotBlank() }?.let {
                    Text(
                        it,
                        fontSize = 13.sp,
                        color = colors.muted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            if (active) {
                ArticleActions(article, onToggleRead, onToggleReadingList, onToggleBookmark)
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (article.userState.inReadingList) FiloIcon(FiloIconName.Playlist, size = 14.dp, tint = colors.accent)
                    if (article.userState.isBookmarked) FiloIcon(FiloIconName.Bookmark, size = 14.dp, tint = colors.star, filled = true)
                    date()
                }
            }
        }
    } else {
        // Feed/date line, then a two-line title.
        Column(modifier = rowModifier.padding(horizontal = Filo.Gutter, vertical = 12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth().heightIn(min = 24.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    modifier = Modifier.weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (showFeed) feed(Modifier.weight(1f, fill = false))
                    toggle()
                }
                date()
                // The 40dp touch targets overhang the 24dp line and the gutter,
                // like the web's negative margins, so the icons end on the edge.
                ArticleActions(
                    article,
                    onToggleRead,
                    onToggleReadingList,
                    onToggleBookmark,
                    modifier = Modifier
                        .height(24.dp)
                        .wrapContentHeight(unbounded = true)
                        .offset(x = 10.dp),
                )
            }
            title(Modifier.fillMaxWidth().padding(top = 4.dp), false)
        }
    }
}

@Composable
private fun TranslationToggle(showOriginal: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(4.dp)
    Box(
        modifier = Modifier
            .height(18.dp)
            .clip(shape)
            .border(1.dp, Filo.colors.border, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 5.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(tr(if (showOriginal) "翻訳" else "原文"), fontSize = 10.sp, lineHeight = 16.sp, color = Filo.colors.muted)
    }
}

@Composable
private fun ArticleActions(
    article: ArticleListItem,
    onToggleRead: (() -> Unit)?,
    onToggleReadingList: (() -> Unit)?,
    onToggleBookmark: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val colors = Filo.colors
    val state = article.userState
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onToggleRead != null) {
            FiloIconButton(
                FiloIconName.CheckCircle,
                tr(if (state.isRead) "未読にする" else "既読にする"),
                onToggleRead,
                tint = if (state.isRead) colors.accent else null,
                filled = false,
            )
        }
        if (onToggleReadingList != null) {
            FiloIconButton(
                FiloIconName.QueueAdd,
                tr(if (state.inReadingList) "リーディングリストから削除" else "リーディングリストに追加"),
                onToggleReadingList,
                active = state.inReadingList,
                tint = if (state.inReadingList) colors.accent else null,
            )
        }
        if (onToggleBookmark != null) {
            FiloIconButton(
                FiloIconName.Bookmark,
                tr(if (state.isBookmarked) "ブックマークを解除" else "ブックマーク"),
                onToggleBookmark,
                active = state.isBookmarked,
                tint = if (state.isBookmarked) colors.star else null,
            )
        }
    }
}

// Relative times match apps/web/src/components/ui.tsx: minutes, hours and days
// for the last week, then a locale date.
private data class RelativeLabels(val now: String, val minutes: String, val hours: String, val days: String)

private fun relativeTime(iso: String?, labels: RelativeLabels, datePattern: (String) -> String): String {
    if (iso.isNullOrBlank()) return ""
    return try {
        val instant = Instant.from(DateTimeFormatter.ISO_DATE_TIME.parse(iso))
        val minutes = (System.currentTimeMillis() - instant.toEpochMilli()) / 60_000
        when {
            minutes < 1 -> labels.now
            minutes < 60 -> "$minutes${labels.minutes}"
            minutes < 60 * 24 -> "${minutes / 60}${labels.hours}"
            minutes < 60 * 24 * 7 -> "${minutes / (60 * 24)}${labels.days}"
            else -> {
                val language = LanguagePreference.value
                DateTimeFormatter.ofPattern(datePattern(language), Locale.forLanguageTag(language))
                    .format(instant.atZone(ZoneId.systemDefault()))
            }
        }
    } catch (e: Exception) {
        ""
    }
}

fun relativeTime(iso: String?): String {
    val labels = when (LanguagePreference.value) {
        "en" -> RelativeLabels("just now", " min ago", " hr ago", " days ago")
        "zh" -> RelativeLabels("刚刚", "分钟前", "小时前", "天前")
        "ko" -> RelativeLabels("방금", "분 전", "시간 전", "일 전")
        "es" -> RelativeLabels("ahora", " min", " h", " días")
        else -> RelativeLabels("たった今", "分前", "時間前", "日前")
    }
    return relativeTime(iso, labels) { language ->
        when (language) {
            "en" -> "MMM d, yyyy"
            "es" -> "d MMM yyyy"
            "ko" -> "yyyy년 M월 d일"
            else -> "yyyy年M月d日"
        }
    }
}

fun compactRelativeTime(iso: String?): String {
    val labels = when (LanguagePreference.value) {
        "ja" -> RelativeLabels("今", "分", "時間", "日")
        "zh" -> RelativeLabels("刚刚", "分", "时", "天")
        "ko" -> RelativeLabels("방금", "분", "시간", "일")
        "es" -> RelativeLabels("ahora", "m", "h", "d")
        else -> RelativeLabels("now", "m", "h", "d")
    }
    return relativeTime(iso, labels) { language ->
        when (language) {
            "es" -> "d/M"
            "ko" -> "M. d."
            else -> "M/d"
        }
    }
}
