package com.filo.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// Path data is copied verbatim from apps/web/src/components/icons.tsx (circles
// and polygons written as path commands). Keep the two in sync when an icon is
// added or changed on the web.
enum class FiloIconName(val pathData: String) {
    Menu("M3 6h18 M3 12h18 M3 18h18"),
    Plus("M12 5v14 M5 12h14"),
    Star("M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26Z"),
    Bookmark("M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"),
    CheckCircle("M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0 M16 9.5l-5 5-2.5-2.5"),
    Refresh("M23 4v6h-6 M20.49 15a9 9 0 1 1-2.12-9.36L23 10"),
    ExternalLink("M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3"),
    ChevronRight("M9 18l6-6-6-6"),
    ChevronDown("M6 9l6 6 6-6"),
    ChevronUp("M18 15l-6-6-6 6"),
    Tag("M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z M7 7h.01"),
    Gear(
        "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 " +
            "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 " +
            "1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06" +
            "a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2" +
            "h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33" +
            "H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06" +
            "a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2" +
            "h-.09a1.65 1.65 0 0 0-1.51 1z",
    ),
    List("M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01"),
    QueueAdd("M3 6h13 M3 12h13 M3 18h9 M18 15v6 M15 18h6"),
    Inbox(
        "M22 12h-6l-2 3h-4l-2-3H2 " +
            "M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
    ),
    Playlist("M3 6h13 M3 12h9 M3 18h7 M15 13.5v7l5.5-3.5z"),
    Rss("M4 11a9 9 0 0 1 9 9 M4 4a16 16 0 0 1 16 16 M4 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"),
    Activity("M22 12h-4l-3 9L9 3l-3 9H2"),
    Pencil("M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"),
    BookOpen("M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"),
    Back("M19 12H5 M12 19l-7-7 7-7"),
    More(
        "M10.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0 " +
            "M17.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0 " +
            "M3.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0",
    ),
    Close("M18 6L6 18 M6 6l12 12"),
    Play("M6 4L20 12L6 20Z"),
    Pause("M6 4h4v16H6z M14 4h4v16h-4z"),
    Trash("M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"),
    // Android-only: the web uses the native checkbox for tag checklists.
    CheckMark("M20 6L9 17l-5-5"),
    Translate("M4 5h7 M7.5 5v1c0 2.5-1.5 4.5-3.5 5.5 M4.5 8c1.5 1 3 2.5 3.5 4.5 M14 14l2 6 M20 14l-2 6 M15 17h4 M12 12l4-4"),
}

// Web icons are 24x24 SVGs stroked at 1.8 with round caps and joins.
private const val ICON_VIEWBOX = 24f
private const val ICON_STROKE = 1.8f

private val iconPaths = mutableMapOf<FiloIconName, Path>()

private fun iconPath(name: FiloIconName): Path =
    iconPaths.getOrPut(name) { PathParser().parsePathString(name.pathData).toPath() }

@Composable
fun FiloIcon(
    name: FiloIconName,
    modifier: Modifier = Modifier,
    size: Dp = 18.dp,
    tint: Color = Filo.colors.muted,
    filled: Boolean = false,
    contentDescription: String? = null,
) {
    Canvas(
        modifier = modifier
            .size(size)
            .semantics { contentDescription?.let { this.contentDescription = it } },
    ) {
        val scale = this.size.minDimension / ICON_VIEWBOX
        val path = iconPath(name)
        withTransform({ scale(scale, scale, pivot = Offset.Zero) }) {
            if (filled) drawPath(path, color = tint, style = Fill)
            drawPath(
                path,
                color = tint,
                style = Stroke(width = ICON_STROKE, cap = StrokeCap.Round, join = StrokeJoin.Round),
            )
        }
    }
}
