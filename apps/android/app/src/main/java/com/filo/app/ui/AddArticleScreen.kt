package com.filo.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddArticleScreen(initialUrl: String, onBack: () -> Unit, onReadAloud: (String) -> Unit = {}) {
    val scope = rememberCoroutineScope()
    var url by remember(initialUrl) { mutableStateOf(initialUrl) }
    var isSubmitting by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("記事を追加") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "戻る")
                    }
                },
            )
        },
    ) { innerPadding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(innerPadding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("共有されたURLを保存または読み上げます。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(
                value = url,
                onValueChange = { url = it; error = null; result = null },
                label = { Text("記事URL") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                enabled = !isSubmitting && url.isNotBlank(),
                onClick = {
                    scope.launch {
                        isSubmitting = true
                        error = null
                        result = null
                        try {
                            val saved = ApiClient.importArticle(url.trim())
                            result = if (saved.created) "リーディングリストに追加しました。" else "リーディングリストに保存済みです。"
                        } catch (cause: Exception) {
                            error = ErrorMessages.forError(cause)
                        } finally {
                            isSubmitting = false
                        }
                    }
                },
            ) { Text(if (isSubmitting) "保存中…" else "追加") }
            TextButton(
                enabled = !isSubmitting && url.isNotBlank(),
                onClick = { onReadAloud(url.trim()) },
            ) { Text("保存せずに読み上げ") }
            result?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
            error?.let { ErrorBanner(it) }
        }
    }
}
