package com.filo.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// Geometry mirrors apps/web/src/components/icons.tsx. Keep these names and
// paths in sync when an icon is added or changed on the web.
enum class FiloIconName {
    Menu,
    Plus,
    Star,
    Bookmark,
    CheckCircle,
    Refresh,
    ExternalLink,
    ChevronRight,
    ChevronDown,
    ChevronUp,
    Tag,
    Gear,
    List,
    QueueAdd,
    Back,
    More,
    Close,
    Play,
    Pause,
    Trash,
    Translate,
}

@Composable
fun FiloIcon(
    name: FiloIconName,
    modifier: Modifier = Modifier,
    size: Dp = 18.dp,
    tint: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    filled: Boolean = false,
    contentDescription: String? = null,
) {
    Canvas(
        modifier = modifier
            .size(size)
            .semantics { contentDescription?.let { this.contentDescription = it } },
    ) {
        val scale = this.size.minDimension / 24f
        val path = iconPath(name)
        // SVG coordinates are in a 24x24 viewBox. Compose's scale transform
        // defaults to the canvas center; scaling around the origin keeps the
        // viewBox's top-left at the icon's top-left instead of clipping it.
        withTransform({ scale(scale, scale, pivot = Offset.Zero) }) {
            if (filled) drawPath(path, color = tint, style = Fill)
            drawPath(
                path,
                color = tint,
                style = Stroke(width = 2f, cap = StrokeCap.Round, join = StrokeJoin.Round),
            )
        }
    }
}

private fun iconPath(name: FiloIconName): Path {
    val path = Path()
    when (name) {
        FiloIconName.Menu -> {
            line(path, 3f, 6f, 21f, 6f)
            line(path, 3f, 12f, 21f, 12f)
            line(path, 3f, 18f, 21f, 18f)
        }
        FiloIconName.Plus -> {
            line(path, 12f, 5f, 12f, 19f)
            line(path, 5f, 12f, 19f, 12f)
        }
        FiloIconName.Star -> polygon(path, listOf(12f to 2f, 15.09f to 8.26f, 22f to 9.27f, 17f to 14.14f, 18.18f to 21.02f, 12f to 17.77f, 5.82f to 21.02f, 7f to 14.14f, 2f to 9.27f, 8.91f to 8.26f))
        FiloIconName.Bookmark -> {
            path.moveTo(19f, 21f)
            path.lineTo(12f, 16f)
            path.lineTo(5f, 21f)
            path.lineTo(5f, 5f)
            path.cubicTo(5f, 3.9f, 5.9f, 3f, 7f, 3f)
            path.lineTo(17f, 3f)
            path.cubicTo(18.1f, 3f, 19f, 3.9f, 19f, 5f)
            path.close()
        }
        FiloIconName.CheckCircle -> {
            path.addOval(Rect(3f, 3f, 21f, 21f))
            path.moveTo(16f, 9.5f)
            path.lineTo(11f, 14.5f)
            path.lineTo(8.5f, 12f)
        }
        FiloIconName.Refresh -> {
            path.moveTo(23f, 4f)
            path.lineTo(23f, 10f)
            path.lineTo(17f, 10f)
            path.moveTo(20.49f, 15f)
            path.addArc(Rect(3f, 3f, 21f, 21f), 19.47f, 295.6f)
            path.lineTo(23f, 10f)
        }
        FiloIconName.ExternalLink -> {
            path.moveTo(18f, 13f)
            path.lineTo(18f, 19f)
            path.cubicTo(18f, 20.1f, 17.1f, 21f, 16f, 21f)
            path.lineTo(5f, 21f)
            path.cubicTo(3.9f, 21f, 3f, 20.1f, 3f, 19f)
            path.lineTo(3f, 8f)
            path.cubicTo(3f, 6.9f, 3.9f, 6f, 5f, 6f)
            path.lineTo(11f, 6f)
            path.moveTo(15f, 3f)
            path.lineTo(21f, 3f)
            path.lineTo(21f, 9f)
            path.moveTo(10f, 14f)
            path.lineTo(21f, 3f)
        }
        FiloIconName.ChevronRight -> {
            path.moveTo(9f, 18f)
            path.lineTo(15f, 12f)
            path.lineTo(9f, 6f)
        }
        FiloIconName.ChevronDown -> {
            path.moveTo(6f, 9f)
            path.lineTo(12f, 15f)
            path.lineTo(18f, 9f)
        }
        FiloIconName.ChevronUp -> {
            path.moveTo(18f, 15f)
            path.lineTo(12f, 9f)
            path.lineTo(6f, 15f)
        }
        FiloIconName.Tag -> {
            path.moveTo(20.59f, 13.41f)
            path.lineTo(13.42f, 20.58f)
            path.cubicTo(12.64f, 21.36f, 11.37f, 21.36f, 10.59f, 20.58f)
            path.lineTo(2f, 12f)
            path.lineTo(2f, 2f)
            path.lineTo(12f, 2f)
            path.lineTo(20.59f, 10.59f)
            path.cubicTo(21.37f, 11.37f, 21.37f, 12.64f, 20.59f, 13.41f)
            path.close()
            path.moveTo(7f, 7f)
            path.lineTo(7.01f, 7f)
        }
        FiloIconName.Gear -> gearPath(path)
        FiloIconName.List -> {
            line(path, 8f, 6f, 21f, 6f)
            line(path, 8f, 12f, 21f, 12f)
            line(path, 8f, 18f, 21f, 18f)
            line(path, 3f, 6f, 3.01f, 6f)
            line(path, 3f, 12f, 3.01f, 12f)
            line(path, 3f, 18f, 3.01f, 18f)
        }
        FiloIconName.QueueAdd -> {
            line(path, 3f, 6f, 16f, 6f)
            line(path, 3f, 12f, 16f, 12f)
            line(path, 3f, 18f, 12f, 18f)
            line(path, 18f, 15f, 18f, 21f)
            line(path, 15f, 18f, 21f, 18f)
        }
        FiloIconName.Back -> {
            line(path, 19f, 12f, 5f, 12f)
            path.moveTo(12f, 19f)
            path.lineTo(5f, 12f)
            path.lineTo(12f, 5f)
        }
        FiloIconName.More -> {
            path.addOval(Rect(3.5f, 10.5f, 6.5f, 13.5f))
            path.addOval(Rect(10.5f, 10.5f, 13.5f, 13.5f))
            path.addOval(Rect(17.5f, 10.5f, 20.5f, 13.5f))
        }
        FiloIconName.Close -> {
            line(path, 18f, 6f, 6f, 18f)
            line(path, 6f, 6f, 18f, 18f)
        }
        FiloIconName.Play -> polygon(path, listOf(6f to 4f, 20f to 12f, 6f to 20f))
        FiloIconName.Pause -> {
            path.moveTo(6f, 4f)
            path.lineTo(10f, 4f)
            path.lineTo(10f, 20f)
            path.lineTo(6f, 20f)
            path.close()
            path.moveTo(14f, 4f)
            path.lineTo(18f, 4f)
            path.lineTo(18f, 20f)
            path.lineTo(14f, 20f)
            path.close()
        }
        FiloIconName.Trash -> {
            line(path, 3f, 6f, 21f, 6f)
            path.moveTo(8f, 6f)
            path.lineTo(8f, 4f)
            path.cubicTo(8f, 2.9f, 8.9f, 2f, 10f, 2f)
            path.lineTo(14f, 2f)
            path.cubicTo(15.1f, 2f, 16f, 2.9f, 16f, 4f)
            path.lineTo(16f, 6f)
            path.moveTo(19f, 6f)
            path.lineTo(18f, 20f)
            path.cubicTo(17.9f, 22f, 17.1f, 22f, 16f, 22f)
            path.lineTo(8f, 22f)
            path.cubicTo(6.9f, 22f, 6.1f, 22f, 6f, 20f)
            path.lineTo(5f, 6f)
        }
        FiloIconName.Translate -> {
            line(path, 4f, 5f, 11f, 5f)
            path.moveTo(7.5f, 5f)
            path.lineTo(7.5f, 6f)
            path.cubicTo(7.5f, 8.5f, 6.1f, 10.5f, 4f, 11.5f)
            path.moveTo(4.5f, 8f)
            path.cubicTo(6f, 9f, 7.5f, 11f, 8f, 12.5f)
            path.moveTo(14f, 14f)
            path.lineTo(16f, 20f)
            path.moveTo(20f, 14f)
            path.lineTo(18f, 20f)
            line(path, 15f, 17f, 19f, 17f)
            path.moveTo(12f, 12f)
            path.lineTo(16f, 8f)
        }
    }
    return path
}

private fun line(path: Path, x1: Float, y1: Float, x2: Float, y2: Float) {
    path.moveTo(x1, y1)
    path.lineTo(x2, y2)
}

private fun polygon(path: Path, points: List<Pair<Float, Float>>) {
    val first = points.firstOrNull() ?: return
    path.moveTo(first.first, first.second)
    points.drop(1).forEach { path.lineTo(it.first, it.second) }
    path.close()
}

private fun gearPath(path: Path) {
    path.addOval(Rect(10.5f, 10.5f, 13.5f, 13.5f))
    val centerX = 12f
    val centerY = 12f
    for (index in 0 until 16) {
        val angle = index * Math.PI / 8 - Math.PI / 2
        val radius = if (index % 2 == 0) 10f else 8.6f
        val x = centerX + kotlin.math.cos(angle).toFloat() * radius
        val y = centerY + kotlin.math.sin(angle).toFloat() * radius
        if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
    }
    path.close()
}
