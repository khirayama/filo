package com.filo.app.ui

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.activity.ComponentActivity
import androidx.core.view.WindowCompat
import com.filo.app.R
import com.filo.app.ThemePreference
import kotlinx.coroutines.delay

// Native mirror of apps/web/src/global.css. Every color, size, gap and radius
// used by the screens comes from here so Android stays aligned with the web.

@Immutable
data class FiloColors(
    val isDark: Boolean,
    val bg: Color,
    val sidebar: Color,
    val surface: Color,
    val text: Color,
    val border: Color,
    val mutedBorder: Color,
    val muted: Color,
    val danger: Color,
    val dangerBg: Color,
    val accent: Color,
    val onAccent: Color,
    val primary: Color,
    val onPrimary: Color,
    val star: Color,
    val ok: Color,
    val okBg: Color,
    val warn: Color,
    val warnBg: Color,
    val hover: Color,
    val pressed: Color,
    val scrim: Color,
    val shadow: Color,
) {
    val accentSoft: Color get() = accent.copy(alpha = 0.14f)
    val rowHover: Color get() = text.copy(alpha = 0.04f).compositeOver(bg)
}

val LightFiloColors = FiloColors(
    isDark = false,
    bg = Color(0xFFFFFFFF),
    sidebar = Color(0xFFF7F7F8),
    surface = Color(0xFFFFFFFF),
    text = Color(0xFF1D1D1F),
    border = Color(0xFFD4D4D8),
    mutedBorder = Color(0xFFE7E7EA),
    muted = Color(0xFF6E6E76),
    danger = Color(0xFFB3261E),
    dangerBg = Color(0xFFFDECEA),
    accent = Color(0xFF1A56DB),
    onAccent = Color(0xFFFFFFFF),
    primary = Color(0xFF1A56DB),
    onPrimary = Color(0xFFFFFFFF),
    star = Color(0xFFD99400),
    ok = Color(0xFF2F6A3D),
    okBg = Color(0xFFE3F6E8),
    warn = Color(0xFF8A5D00),
    warnBg = Color(0xFFFDF3D3),
    hover = Color.Black.copy(alpha = 0.04f),
    pressed = Color.Black.copy(alpha = 0.07f),
    scrim = Color.Black.copy(alpha = 0.3f),
    shadow = Color.Black.copy(alpha = 0.12f),
)

val DarkFiloColors = FiloColors(
    isDark = true,
    bg = Color(0xFF16181C),
    sidebar = Color(0xFF1B1D22),
    surface = Color(0xFF1F2227),
    text = Color(0xFFE6E6E8),
    border = Color(0xFF41454D),
    mutedBorder = Color(0xFF2C2F35),
    muted = Color(0xFF9AA0A8),
    danger = Color(0xFFEF7B74),
    dangerBg = Color(0xFF3A1F1E),
    accent = Color(0xFF6A9BFF),
    onAccent = Color(0xFF10233F),
    primary = Color(0xFF3569D6),
    onPrimary = Color(0xFFFFFFFF),
    star = Color(0xFFFFC94D),
    ok = Color(0xFF6BCB8A),
    okBg = Color(0xFF1C3324),
    warn = Color(0xFFE3B341),
    warnBg = Color(0xFF38300F),
    hover = Color.White.copy(alpha = 0.05f),
    pressed = Color.White.copy(alpha = 0.09f),
    scrim = Color.Black.copy(alpha = 0.5f),
    shadow = Color.Black.copy(alpha = 0.5f),
)

private val LocalFiloColors = staticCompositionLocalOf { LightFiloColors }

object Filo {
    val colors: FiloColors
        @Composable @ReadOnlyComposable get() = LocalFiloColors.current

    val RadiusSm = 6.dp
    val Radius = 8.dp
    val RadiusLg = 12.dp
    val ControlHeight = 36.dp
    val ControlHeightSm = 28.dp
    val HeaderHeight = 52.dp
    val Gutter = 16.dp
    // Touch screens get the web's `pointer: coarse` minimum for icon buttons.
    val TouchTarget = 40.dp
}

@Composable
fun FiloTheme(content: @Composable () -> Unit) {
    val darkTheme = when (ThemePreference.value) {
        "dark" -> true
        "light" -> false
        else -> isSystemInDarkTheme()
    }
    val colors = if (darkTheme) DarkFiloColors else LightFiloColors
    val scheme = if (darkTheme) darkColorScheme() else lightColorScheme()
    MaterialTheme(
        colorScheme = scheme.copy(
            primary = colors.accent,
            onPrimary = colors.onAccent,
            secondary = colors.text,
            onSecondary = colors.bg,
            tertiary = colors.ok,
            onTertiary = colors.bg,
            background = colors.bg,
            onBackground = colors.text,
            surface = colors.surface,
            onSurface = colors.text,
            surfaceVariant = colors.surface,
            onSurfaceVariant = colors.muted,
            surfaceContainerLow = colors.surface,
            surfaceContainer = colors.surface,
            surfaceContainerHigh = colors.surface,
            surfaceContainerHighest = colors.surface,
            outline = colors.border,
            outlineVariant = colors.mutedBorder,
            error = colors.danger,
            onError = colors.bg,
            errorContainer = colors.dangerBg,
            onErrorContainer = colors.danger,
            scrim = colors.scrim,
        ),
        typography = Typography(
            bodyLarge = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
            bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
            bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 18.sp),
            labelLarge = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium),
            labelMedium = TextStyle(fontSize = 13.sp, lineHeight = 18.sp),
            labelSmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp),
            titleLarge = TextStyle(fontSize = 18.sp, lineHeight = 24.sp, fontWeight = FontWeight.Bold),
            titleMedium = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Bold),
            titleSmall = TextStyle(fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Bold),
        ),
    ) {
        CompositionLocalProvider(LocalFiloColors provides colors, content = content)
    }
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            (view.context as? ComponentActivity)?.window?.let { window ->
                WindowCompat.getInsetsController(window, view).apply {
                    isAppearanceLightStatusBars = !darkTheme
                    isAppearanceLightNavigationBars = !darkTheme
                }
            }
        }
    }
}

// ---------- Header ----------

enum class HeaderLead { None, Menu, Back }

/**
 * The one header every signed-in screen shares (web `AppShell`): an optional
 * menu/back button, a single-line title and trailing actions.
 */
@Composable
fun FiloHeader(
    title: String,
    modifier: Modifier = Modifier,
    lead: HeaderLead = HeaderLead.None,
    onLead: () -> Unit = {},
    actions: @Composable RowScope.() -> Unit = {},
) {
    val colors = Filo.colors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(Filo.HeaderHeight)
            .background(colors.bg)
            .bottomBorder(colors.mutedBorder)
            .padding(start = if (lead == HeaderLead.None) Filo.Gutter else 8.dp, end = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        when (lead) {
            HeaderLead.Menu -> FiloIconButton(FiloIconName.Menu, tr("メニュー"), onLead)
            HeaderLead.Back -> FiloIconButton(FiloIconName.Back, tr("戻る"), onLead)
            HeaderLead.None -> Unit
        }
        Text(
            title,
            style = MaterialTheme.typography.titleLarge,
            color = colors.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .weight(1f)
                .padding(start = if (lead == HeaderLead.None) 0.dp else 8.dp),
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
            content = actions,
        )
    }
}

fun Modifier.bottomBorder(color: Color, width: Dp = 1.dp): Modifier = drawBehind {
    val stroke = width.toPx()
    drawRect(color, topLeft = Offset(0f, size.height - stroke), size = size.copy(height = stroke))
}

fun Modifier.topBorder(color: Color, width: Dp = 1.dp): Modifier = drawBehind {
    drawRect(color, size = size.copy(height = width.toPx()))
}

// ---------- Buttons ----------

@Composable
fun FiloIconButton(
    icon: FiloIconName,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 18.dp,
    enabled: Boolean = true,
    active: Boolean = false,
    filled: Boolean = active,
    tint: Color? = null,
    // A menu trigger keeps the pressed background while its menu is open.
    expanded: Boolean = false,
) {
    val colors = Filo.colors
    Box(
        modifier = modifier
            .size(maxOf(size + 14.dp, Filo.TouchTarget))
            .clip(RoundedCornerShape(Filo.Radius))
            .background(if (expanded) colors.pressed else Color.Transparent)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        FiloIcon(
            icon,
            size = size,
            tint = tint ?: if (active) colors.text else colors.muted,
            filled = filled,
            modifier = Modifier.alpha(if (enabled) 1f else 0.4f),
        )
    }
}

enum class ButtonKind { Primary, Secondary, Ghost, Danger }

@Composable
fun FiloButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: ButtonKind = ButtonKind.Secondary,
    small: Boolean = false,
    icon: FiloIconName? = null,
    enabled: Boolean = true,
) {
    val colors = Filo.colors
    val shape = RoundedCornerShape(if (small) Filo.RadiusSm else Filo.Radius)
    val primaryDisabled = kind == ButtonKind.Primary && !enabled
    val background = when {
        primaryDisabled -> colors.pressed
        kind == ButtonKind.Primary -> colors.primary
        kind == ButtonKind.Secondary -> colors.surface
        else -> Color.Transparent
    }
    val content = when {
        primaryDisabled -> colors.muted
        kind == ButtonKind.Primary -> colors.onPrimary
        kind == ButtonKind.Ghost -> colors.muted
        kind == ButtonKind.Danger -> colors.danger
        else -> colors.text
    }
    val border = when (kind) {
        ButtonKind.Secondary -> colors.border
        ButtonKind.Danger -> colors.danger.copy(alpha = 0.45f)
        else -> Color.Transparent
    }
    Row(
        modifier = modifier
            .height(if (small) Filo.ControlHeightSm else Filo.ControlHeight)
            .alpha(if (!enabled && !primaryDisabled) 0.45f else 1f)
            .clip(shape)
            .background(background)
            .border(1.dp, border, shape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = if (small) 10.dp else 14.dp),
        horizontalArrangement = Arrangement.spacedBy(if (small) 4.dp else 6.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) FiloIcon(icon, size = if (small) 14.dp else 16.dp, tint = content)
        Text(
            text,
            color = content,
            fontSize = if (small) 13.sp else 14.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
        )
    }
}

@Composable
fun FiloChip(
    label: String,
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    dotColor: Color? = null,
) {
    val colors = Filo.colors
    Row(
        modifier = modifier
            .height(Filo.ControlHeightSm)
            .clip(CircleShape)
            .background(if (active) colors.accentSoft else Color.Transparent)
            .border(1.dp, if (active) colors.accent.copy(alpha = 0.45f) else colors.border, CircleShape)
            .clickable(role = Role.Checkbox, onClick = onClick)
            .padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (dotColor != null) Box(Modifier.size(8.dp).background(dotColor, CircleShape))
        Text(
            label,
            fontSize = 13.sp,
            color = if (active) colors.accent else colors.text,
            fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1,
        )
    }
}

@Composable
fun FiloSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit, label: String? = null) {
    val colors = Filo.colors
    val thumbOffset by animateDpAsState(if (checked) 16.dp else 0.dp, tween(160), label = "switch")
    Box(
        modifier = Modifier
            .size(width = 48.dp, height = Filo.TouchTarget)
            .clickable(role = Role.Switch) { onCheckedChange(!checked) }
            .semantics { label?.let { contentDescription = it } },
        contentAlignment = Alignment.CenterEnd,
    ) {
        Box(
            modifier = Modifier
                .size(width = 38.dp, height = 22.dp)
                .background(if (checked) colors.primary else colors.border, CircleShape)
                .padding(2.dp),
        ) {
            Box(
                Modifier
                    .offset(x = thumbOffset)
                    .size(18.dp)
                    .shadow(1.dp, CircleShape)
                    .background(Color.White, CircleShape),
            )
        }
    }
}

// ---------- Form controls ----------

@Composable
fun FiloTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    enabled: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    height: Dp = Filo.ControlHeight,
    shape: RoundedCornerShape = RoundedCornerShape(Filo.Radius),
    background: Color = Filo.colors.surface,
    textSize: Int = 14,
) {
    val colors = Filo.colors
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        enabled = enabled,
        singleLine = true,
        interactionSource = interaction,
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        visualTransformation = visualTransformation,
        cursorBrush = SolidColor(colors.accent),
        textStyle = TextStyle(fontSize = textSize.sp, color = colors.text),
        modifier = modifier
            .height(height)
            .alpha(if (enabled) 1f else 0.6f)
            .then(if (focused) Modifier.border(3.dp, colors.accentSoft, shape) else Modifier)
            .background(if (focused) colors.surface else background, shape)
            .border(1.dp, if (focused) colors.accent else colors.border, shape),
        decorationBox = { inner ->
            Box(Modifier.padding(horizontal = 12.dp), contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty() && placeholder != null) {
                    Text(placeholder, fontSize = textSize.sp, color = colors.muted, maxLines = 1)
                }
                inner()
            }
        },
    )
}

/** A form field: label above the control, optional hint below (web `.fl-field`). */
@Composable
fun FiloField(
    label: String,
    modifier: Modifier = Modifier,
    hint: String? = null,
    content: @Composable () -> Unit,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Filo.colors.text)
        content()
        if (hint != null) Text(hint, fontSize = 12.sp, lineHeight = 18.sp, color = Filo.colors.muted)
    }
}

/** A select control (web `.fl-select`) that opens a menu of options. */
@Composable
fun <T> FiloSelect(
    options: List<Pair<T, String>>,
    selected: T,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
) {
    val colors = Filo.colors
    var open by remember { mutableStateOf(false) }
    var fieldWidth by remember { mutableStateOf(0.dp) }
    val density = LocalDensity.current
    val shape = RoundedCornerShape(Filo.Radius)
    Box(modifier) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .onSizeChanged { fieldWidth = with(density) { it.width.toDp() } }
                .height(Filo.ControlHeight)
                .clip(shape)
                .background(colors.surface)
                .border(1.dp, colors.border, shape)
                .clickable(role = Role.DropdownList, onClickLabel = label) { open = true }
                .padding(start = 12.dp, end = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                options.firstOrNull { it.first == selected }?.second.orEmpty(),
                fontSize = 14.sp,
                color = colors.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            FiloIcon(FiloIconName.ChevronDown, size = 16.dp)
        }
        // The menu lines up with the field it opens from (minus the menu's inset).
        FiloMenu(expanded = open, onDismiss = { open = false }, modifier = Modifier.width(fieldWidth - 8.dp)) {
            options.forEach { (value, name) ->
                FiloMenuItem(
                    label = name,
                    selected = value == selected,
                    onClick = {
                        open = false
                        onSelect(value)
                    },
                )
            }
        }
    }
}

// ---------- Menus ----------

@Composable
fun FiloMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = Filo.colors
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        modifier = modifier.padding(horizontal = 4.dp),
        shape = RoundedCornerShape(Filo.Radius),
        containerColor = colors.surface,
        tonalElevation = 0.dp,
        shadowElevation = 8.dp,
        border = BorderStroke(1.dp, colors.mutedBorder),
        content = content,
    )
}

@Composable
fun FiloMenuItem(
    label: String,
    onClick: () -> Unit,
    icon: FiloIconName? = null,
    danger: Boolean = false,
    selected: Boolean = false,
    trailing: (@Composable () -> Unit)? = null,
) {
    val colors = Filo.colors
    val content = when {
        danger -> colors.danger
        selected -> colors.accent
        else -> colors.text
    }
    Row(
        modifier = Modifier
            .widthIn(min = 200.dp)
            .heightIn(min = Filo.TouchTarget)
            .clip(RoundedCornerShape(Filo.RadiusSm))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) FiloIcon(icon, size = 16.dp, tint = if (danger) colors.danger else colors.muted)
        Text(
            label,
            fontSize = 14.sp,
            color = content,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        trailing?.invoke()
    }
}

@Composable
fun FiloDivider(modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(Filo.colors.mutedBorder),
    )
}

// ---------- Surfaces ----------

@Composable
fun FiloCard(
    modifier: Modifier = Modifier,
    danger: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = Filo.colors
    val shape = RoundedCornerShape(Filo.RadiusLg)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(colors.surface)
            .border(1.dp, if (danger) colors.danger.copy(alpha = 0.35f) else colors.mutedBorder, shape),
        content = content,
    )
}

@Composable
fun FiloSectionTitle(title: String, danger: Boolean = false) {
    Text(
        title,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        color = if (danger) Filo.colors.danger else Filo.colors.muted,
        modifier = Modifier.padding(start = 4.dp, bottom = 8.dp),
    )
}

enum class BadgeTone { Muted, Warn, Danger, Ok }

private data class ToneColors(val background: Color, val content: Color)

@Composable
@ReadOnlyComposable
private fun toneColors(tone: BadgeTone): ToneColors {
    val colors = Filo.colors
    return when (tone) {
        BadgeTone.Muted -> ToneColors(colors.pressed, colors.muted)
        BadgeTone.Warn -> ToneColors(colors.warnBg, colors.warn)
        BadgeTone.Danger -> ToneColors(colors.dangerBg, colors.danger)
        BadgeTone.Ok -> ToneColors(colors.okBg, colors.ok)
    }
}

@Composable
fun FiloBadge(label: String, tone: BadgeTone = BadgeTone.Muted) {
    val tones = toneColors(tone)
    Box(
        modifier = Modifier
            .height(20.dp)
            .background(tones.background, RoundedCornerShape(Filo.RadiusSm))
            .padding(horizontal = 7.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontSize = 12.sp, lineHeight = 12.sp, fontWeight = FontWeight.Medium, color = tones.content, maxLines = 1)
    }
}

/** Inline status with a leading dot: quieter than a badge (web `StatusText`). */
@Composable
fun FiloStatusText(label: String, tone: BadgeTone = BadgeTone.Muted) {
    val color = toneColors(tone).content
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(6.dp).background(color, CircleShape))
        Text(label, fontSize = 12.sp, color = color, maxLines = 1)
    }
}

@Composable
fun FiloEmptyState(
    message: String,
    icon: FiloIconName? = null,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
) {
    val colors = Filo.colors
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 56.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (icon != null) {
            Box(
                Modifier.size(48.dp).background(colors.hover, CircleShape),
                contentAlignment = Alignment.Center,
            ) { FiloIcon(icon, size = 22.dp) }
        }
        Text(message, fontSize = 14.sp, lineHeight = 22.sp, color = colors.muted, textAlign = TextAlign.Center)
        action?.invoke()
    }
}

@Composable
fun FiloSpinnerMark(size: Dp = 16.dp) {
    CircularProgressIndicator(
        modifier = Modifier.size(size),
        strokeWidth = 2.dp,
        color = Filo.colors.accent,
        trackColor = Filo.colors.mutedBorder,
    )
}

@Composable
fun FiloSpinner(label: String = tr("読み込み中…"), modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 32.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FiloSpinnerMark()
        Text(label, fontSize = 13.sp, color = Filo.colors.muted)
    }
}

@Composable
fun FiloErrorBox(message: String, modifier: Modifier = Modifier, onRetry: (() -> Unit)? = null) {
    val colors = Filo.colors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(colors.dangerBg, RoundedCornerShape(Filo.Radius))
            .padding(start = 16.dp, end = 12.dp, top = 10.dp, bottom = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(message, fontSize = 14.sp, lineHeight = 21.sp, color = colors.danger, modifier = Modifier.weight(1f))
        if (onRetry != null) FiloButton(tr("再試行"), onRetry, small = true)
    }
}

/** A transient notice at the bottom of the screen (web `.fl-toast`). */
@Composable
fun BoxScope.FiloToast(message: String?, onDismiss: () -> Unit, durationMillis: Long = 4000) {
    if (message == null) return
    LaunchedEffect(message) {
        delay(durationMillis)
        onDismiss()
    }
    val colors = Filo.colors
    val shape = RoundedCornerShape(Filo.Radius)
    Text(
        message,
        fontSize = 13.sp,
        lineHeight = 20.sp,
        color = colors.bg,
        modifier = Modifier
            .align(Alignment.BottomCenter)
            .padding(horizontal = 16.dp, vertical = 24.dp)
            .widthIn(max = 480.dp)
            .shadow(8.dp, shape)
            .background(colors.text, shape)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    )
}

@Composable
fun BlockingProgressOverlay(message: String) {
    val colors = Filo.colors
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.scrim)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = {},
            ),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            modifier = Modifier
                .shadow(24.dp, RoundedCornerShape(Filo.RadiusLg))
                .background(colors.surface, RoundedCornerShape(Filo.RadiusLg))
                .border(1.dp, colors.mutedBorder, RoundedCornerShape(Filo.RadiusLg))
                .padding(horizontal = 18.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FiloSpinnerMark()
            Text(message, fontSize = 14.sp, color = colors.text)
        }
    }
}

// ---------- Dialogs ----------

@Composable
fun FiloDialog(
    title: String,
    onDismiss: () -> Unit,
    buttons: (@Composable RowScope.() -> Unit)? = null,
    // Dialogs without actions close from a header button, as on the web.
    showClose: Boolean = buttons == null,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val colors = Filo.colors
    val shape = RoundedCornerShape(Filo.RadiusLg)
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            modifier = Modifier
                .padding(16.dp)
                .widthIn(max = 420.dp)
                .fillMaxWidth()
                .shadow(24.dp, shape)
                .background(colors.surface, shape)
                .border(1.dp, colors.mutedBorder, shape)
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    title,
                    fontSize = 16.sp,
                    lineHeight = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = colors.text,
                    modifier = Modifier.weight(1f),
                )
                if (showClose) {
                    FiloIconButton(FiloIconName.Close, tr("閉じる"), onDismiss, modifier = Modifier.offset(x = 8.dp))
                }
            }
            content?.invoke(this)
            if (buttons != null) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                    content = buttons,
                )
            }
        }
    }
}

@Composable
fun FiloConfirmDialog(
    title: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    message: String? = null,
    danger: Boolean = false,
) {
    FiloDialog(
        title = title,
        onDismiss = onDismiss,
        buttons = {
            FiloButton(tr("キャンセル"), onDismiss)
            FiloButton(confirmLabel, onConfirm, kind = if (danger) ButtonKind.Danger else ButtonKind.Primary)
        },
        content = message?.let {
            { Text(it, fontSize = 14.sp, lineHeight = 22.sp, color = Filo.colors.muted) }
        },
    )
}

// ---------- Sheets ----------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FiloSheet(onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Filo.colors.surface,
        contentColor = Filo.colors.text,
        scrimColor = Filo.colors.scrim,
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        content = content,
    )
}

@Composable
fun SheetTitle(title: String, top: Dp = 0.dp) {
    Text(
        title,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        color = Filo.colors.muted,
        modifier = Modifier.padding(top = top, bottom = 4.dp),
    )
}

// ---------- Brand & feed icons ----------

@Composable
fun FiloBrand(
    modifier: Modifier = Modifier,
    size: Dp = 26.dp,
    nameStyle: TextStyle = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.Bold),
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(painterResource(R.drawable.filo_logo), contentDescription = null, modifier = Modifier.size(size))
        Text("Filo", style = nameStyle, color = Filo.colors.text)
    }
}

/** Standard page padding (web `.fl-page`). */
val PagePadding = PaddingValues(start = Filo.Gutter, end = Filo.Gutter, top = 24.dp, bottom = 64.dp)

fun parseTagColor(color: String): Color? =
    runCatching { Color(android.graphics.Color.parseColor(color)) }.getOrNull()

@Composable
fun TagDot(color: String?, size: Dp = 10.dp) {
    Box(Modifier.size(size).background(color?.let(::parseTagColor) ?: Filo.colors.border, CircleShape))
}
