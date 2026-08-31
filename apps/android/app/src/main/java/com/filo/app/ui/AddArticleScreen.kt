package com.filo.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.filo.app.api.ApiClient
import com.filo.app.api.ErrorMessages
import com.filo.app.Analytics
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddArticleScreen(initialUrl: String, onBack: () -> Unit, onSaved: (() -> Unit)? = null) {
    val scope = rememberCoroutineScope()
    var url by remember(initialUrl) { mutableStateOf(initialUrl) }
    var isSubmitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(tr("記事を追加")) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        FiloIcon(FiloIconName.Back, contentDescription = tr("戻る"))
                    }
                },
            )
        },
    ) { innerPadding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(innerPadding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(tr("URLをリーディングリストに保存します。"), color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(
                value = url,
                onValueChange = { url = it; error = null },
                label = { Text(tr("記事URL")) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                enabled = !isSubmitting && url.isNotBlank(),
                onClick = {
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
                            error = ErrorMessages.forError(cause)
                        } finally {
                            isSubmitting = false
                        }
                    }
                },
            ) { Text(tr(if (isSubmitting) "保存中…" else "追加")) }
            error?.let { ErrorBanner(it) }
        }
    }
}
