package com.filo.app.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay

@Composable
fun PollForNewArticles(onCheck: suspend () -> Unit) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val check by rememberUpdatedState(onCheck)
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                check()
                delay(30_000)
            }
        }
    }
}

@Composable
fun NewArticlesNotice(visible: Boolean, onLoad: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    if (!visible) return
    FiloButton(
        tr("新着記事があります"), onLoad,
        modifier = modifier.padding(top = 12.dp).semantics { liveRegion = LiveRegionMode.Polite },
        kind = ButtonKind.Primary, icon = FiloIconName.Refresh, enabled = enabled,
    )
}
