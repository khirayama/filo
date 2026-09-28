package com.filo.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.filo.app.Analytics
import com.filo.app.api.ApiClient
import com.filo.app.api.ErrorMessages
import kotlinx.coroutines.launch

@Composable
fun AddArticleScreen(initialUrl: String, onBack: () -> Unit, onSaved: (() -> Unit)? = null) {
    val scope = rememberCoroutineScope()
    var url by remember(initialUrl) { mutableStateOf(initialUrl) }
    var isSubmitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<AppText?>(null) }

    fun submit() {
        if (isSubmitting || url.isBlank()) return
        scope.launch {
            isSubmitting = true
            error = null
            try {
                val saved = ApiClient.importArticle(url.trim())
                Analytics.track(
                    "add_to_reading_list",
                    mapOf("source" to "manual_url", "created" to saved.created),
                )
                onSaved?.invoke()
            } catch (cause: Exception) {
                error = ErrorMessages.forErrorText(cause)
            } finally {
                isSubmitting = false
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        FiloHeader(tr("記事を追加"), lead = HeaderLead.Back, onLead = onBack)
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(PagePadding),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            FiloField(tr("記事URL"), hint = tr("URLをリーディングリストに保存します。")) {
                FiloTextField(
                    url,
                    {
                        url = it
                        error = null
                    },
                    placeholder = "https://example.com/article",
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done, autoCorrectEnabled = false),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Row {
                FiloButton(
                    tr(if (isSubmitting) "保存中…" else "追加"),
                    ::submit,
                    kind = ButtonKind.Primary,
                    icon = FiloIconName.Plus,
                    enabled = !isSubmitting && url.isNotBlank(),
                )
            }
            error?.let { FiloErrorBox(tr(it)) }
        }
    }
}
