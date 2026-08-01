package com.filo.app.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.filo.app.ThemePreference
import com.filo.app.LanguagePreference
import com.filo.app.api.ApiClient
import com.filo.app.api.ErrorMessages
import com.filo.app.api.OpmlImportJob
import com.filo.app.api.UserSettings
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    translations: TitleTranslationStore,
    onBack: () -> Unit,
    onSignOut: () -> Unit,
    onDeletionAccepted: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var settings by remember { mutableStateOf<UserSettings?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var importJob by remember { mutableStateOf<OpmlImportJob?>(null) }
    var showDeleteConfirm by remember { mutableStateOf(false) }
    var exportedBytes by remember { mutableStateOf<ByteArray?>(null) }

    suspend fun reload() {
        isLoading = true
        errorMessage = null
        try {
            settings = ApiClient.getSettings()
            settings?.let { ThemePreference.set(context, it.theme) }
        } catch (e: Exception) {
            errorMessage = ErrorMessages.forError(e)
        }
        isLoading = false
    }

    LaunchedEffect(Unit) { reload() }

    fun update(
        theme: String? = null,
        language: String? = null,
        readableLanguages: List<String>? = null,
        articleSortOrder: String? = null,
        openInBrowserByDefault: Boolean? = null,
    ) {
        scope.launch {
            try {
                val previousLanguage = settings?.language
                settings = ApiClient.updateSettings(
                    theme, language, readableLanguages, articleSortOrder, openInBrowserByDefault,
                )
                settings?.let {
                    ThemePreference.set(context, it.theme)
                    LanguagePreference.set(context, it.language)
                    if (previousLanguage != null) LanguagePreference.recreateIfNeeded(context, previousLanguage, it.language)
                }
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forError(e)
            }
        }
    }

    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            try {
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    ?: throw IllegalStateException("could not read file")
                var job = ApiClient.importOpml(bytes, "import.opml")
                importJob = job
                while (job.status == "pending" || job.status == "running") {
                    delay(3000)
                    job = ApiClient.getOpmlImport(job.jobId)
                    importJob = job
                }
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forError(e)
            }
        }
    }

    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("text/x-opml"),
    ) { uri ->
        val bytes = exportedBytes
        if (uri == null || bytes == null) return@rememberLauncherForActivityResult
        scope.launch {
            runCatching {
                context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
            }
            exportedBytes = null
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(com.filo.app.R.string.settings)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(com.filo.app.R.string.back))
                    }
                },
            )
        },
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            errorMessage?.let { ErrorBanner(it) { scope.launch { reload() } } }
            if (isLoading || settings == null) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(40.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) { CircularProgressIndicator() }
            } else {
                val current = settings!!
                Text(stringResource(com.filo.app.R.string.display), fontWeight = FontWeight.SemiBold)
                ChoiceRow(
                    label = stringResource(com.filo.app.R.string.theme),
                    options = listOf("system" to stringResource(com.filo.app.R.string.system), "light" to stringResource(com.filo.app.R.string.light), "dark" to stringResource(com.filo.app.R.string.dark)),
                    selected = current.theme,
                ) { update(theme = it) }
                ChoiceRow(
                    label = stringResource(com.filo.app.R.string.language),
                    options = listOf("ja" to "日本語", "en" to "English", "zh" to "简体中文", "ko" to "한국어", "es" to "Español"),
                    selected = current.language,
                ) { update(language = it) }
                Text(
                    stringResource(com.filo.app.R.string.display_language_help),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = { translations.isShowingSetup = true }) {
                    Text(stringResource(com.filo.app.R.string.prepare_translation))
                }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(com.filo.app.R.string.readable_languages), style = MaterialTheme.typography.labelLarge)
                    Text(
                        stringResource(com.filo.app.R.string.original_language_help),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("ja" to "日本語", "en" to "English", "zh" to "简体中文", "ko" to "한국어", "es" to "Español").forEach { (code, name) ->
                            FilterChipButton(name, current.readableLanguages.contains(code)) {
                                val next = if (current.readableLanguages.contains(code)) {
                                    current.readableLanguages - code
                                } else {
                                    current.readableLanguages + code
                                }
                                update(readableLanguages = next)
                            }
                        }
                    }
                }
                ChoiceRow(
                    label = stringResource(com.filo.app.R.string.article_order),
                    options = listOf("published_at_desc" to stringResource(com.filo.app.R.string.published_newest), "fetched_at_desc" to stringResource(com.filo.app.R.string.fetched_newest)),
                    selected = current.articleSortOrder,
                ) { update(articleSortOrder = it) }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(stringResource(com.filo.app.R.string.browser_links))
                    Switch(
                        checked = current.openInBrowserByDefault,
                        onCheckedChange = { update(openInBrowserByDefault = it) },
                    )
                }
                HorizontalDivider()

                Text(stringResource(com.filo.app.R.string.opml), fontWeight = FontWeight.SemiBold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { importLauncher.launch("*/*") }) { Text(stringResource(com.filo.app.R.string.import_opml)) }
                    OutlinedButton(onClick = {
                        scope.launch {
                            try {
                                exportedBytes = ApiClient.exportOpml()
                                exportLauncher.launch("filo-subscriptions.opml")
                            } catch (e: Exception) {
                                errorMessage = ErrorMessages.forError(e)
                            }
                        }
                    }) { Text(stringResource(com.filo.app.R.string.export_opml)) }
                }
                importJob?.let { job ->
                    when (job.status) {
                        "pending", "running" -> Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            CircularProgressIndicator(modifier = Modifier.padding(4.dp))
                            Text(stringResource(com.filo.app.R.string.importing))
                        }
                        "completed" -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            StatusBadge("インポート完了", BadgeTone.Ok)
                            Text(
                                "追加 ${job.created ?: 0} / スキップ ${job.skipped ?: 0} / 失敗 ${job.failed ?: 0}",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            job.failures.take(5).forEach { failure ->
                                Text(
                                    failure.feedUrl,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                )
                            }
                        }
                        else -> StatusBadge("インポート失敗", BadgeTone.Danger)
                    }
                }
                HorizontalDivider()

                Text(stringResource(com.filo.app.R.string.read_history), fontWeight = FontWeight.SemiBold)
                Text(
                    "閲覧履歴は既読記事として扱われます。記事一覧の絞り込みから既読記事を確認できます。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                HorizontalDivider()

                Text(stringResource(com.filo.app.R.string.session), fontWeight = FontWeight.SemiBold)
                OutlinedButton(onClick = onSignOut) { Text(stringResource(com.filo.app.R.string.sign_out)) }
                HorizontalDivider()

                Text(stringResource(com.filo.app.R.string.dangerous_actions), fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.error)
                Text(
                    "アカウントを削除すると購読・タグ・記事の状態がすべて削除され、再ログインしても復元されません。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Button(
                    onClick = { showDeleteConfirm = true },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                ) { Text(stringResource(com.filo.app.R.string.delete_account)) }
            }
        }
    }

    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text(stringResource(com.filo.app.R.string.delete_account_confirm)) },
            text = { Text(stringResource(com.filo.app.R.string.irreversible)) },
            confirmButton = {
                TextButton(onClick = {
                    showDeleteConfirm = false
                    scope.launch {
                        try {
                            val accepted = ApiClient.deleteAccount()
                            onDeletionAccepted(accepted.deletionToken)
                        } catch (e: Exception) {
                            errorMessage = ErrorMessages.forError(e)
                        }
                    }
                }) { Text(stringResource(com.filo.app.R.string.delete), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { showDeleteConfirm = false }) { Text(stringResource(com.filo.app.R.string.cancel)) } },
        )
    }
}

@Composable
private fun ChoiceRow(
    label: String,
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { (value, name) ->
                FilterChipButton(name, selected == value) { onSelect(value) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountDeletionScreen(
    deletionToken: String?,
    onSignOut: () -> Unit,
) {
    var status by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        while (true) {
            val result = runCatching { ApiClient.deletionStatus(deletionToken) }.getOrNull()
            if (result != null) {
                status = result.status
                if (result.status == "completed") {
                    // Clerk deletion done: force local sign-out
                    onSignOut()
                    break
                }
                if (result.status == "none") break
            }
            delay(4000)
        }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("アカウント削除") }) },
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            when (status) {
                null -> {
                    CircularProgressIndicator()
                    Text("状態を確認しています…")
                }
                "completed" -> {
                    StatusBadge("削除完了", BadgeTone.Ok)
                    Text("アカウントの削除が完了しました。ご利用ありがとうございました。")
                    Text(
                        "再ログインしてもデータは復元されません。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                "failed" -> {
                    StatusBadge("削除処理に失敗しました", BadgeTone.Danger)
                    Text("削除処理は自動的に再試行されます。時間をおいてもこの状態が続く場合はお問い合わせください。")
                }
                "none" -> Text("進行中の削除処理はありません。")
                else -> {
                    CircularProgressIndicator()
                    Text("削除処理中…")
                    Text(
                        "この画面を閉じても削除処理は継続されます。再ログインでデータが復活することはありません。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
