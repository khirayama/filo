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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
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
    var errorMessage by remember { mutableStateOf<AppText?>(null) }
    var importJob by remember { mutableStateOf<OpmlImportJob?>(null) }
    var showDeleteConfirm by remember { mutableStateOf(false) }
    var exportedBytes by remember { mutableStateOf<ByteArray?>(null) }

    suspend fun reload() {
        isLoading = true
        errorMessage = null
        try {
            val loadedSettings = ApiClient.getSettings()
            // Apply the server language before publishing the screen state so
            // the first rendered settings frame cannot mix languages.
            ThemePreference.set(context, loadedSettings.theme)
            LanguagePreference.set(context, loadedSettings.language)
            settings = loadedSettings
        } catch (e: Exception) {
            errorMessage = ErrorMessages.forErrorText(e)
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
            val previous = settings
            if (language != null) LanguagePreference.set(context, language)
            if (theme != null) ThemePreference.set(context, theme)
            settings = previous?.copy(
                theme = theme ?: previous.theme,
                language = language ?: previous.language,
                readableLanguages = readableLanguages ?: previous.readableLanguages,
                articleSortOrder = articleSortOrder ?: previous.articleSortOrder,
                openInBrowserByDefault = openInBrowserByDefault ?: previous.openInBrowserByDefault,
            )
            try {
                val updatedSettings = ApiClient.updateSettings(
                    theme, language, readableLanguages, articleSortOrder, openInBrowserByDefault,
                )
                listOf(
                    "theme" to theme,
                    "language" to language,
                    "readable_languages" to readableLanguages?.size,
                    "article_sort_order" to articleSortOrder,
                    "open_in_browser_by_default" to openInBrowserByDefault,
                ).filter { it.second != null }.forEach { (setting, value) ->
                    com.filo.app.Analytics.track("settings_change", mapOf("setting" to setting, "value" to value.toString()))
                }
                ThemePreference.set(context, updatedSettings.theme)
                LanguagePreference.set(context, updatedSettings.language)
                settings = updatedSettings
            } catch (e: Exception) {
                previous?.let {
                    ThemePreference.set(context, it.theme)
                    LanguagePreference.set(context, it.language)
                }
                settings = previous
                errorMessage = ErrorMessages.forErrorText(e)
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
                com.filo.app.Analytics.track("import_opml", mapOf("file_type" to "opml"))
                importJob = job
                while (job.status == "pending" || job.status == "running") {
                    delay(3000)
                    job = ApiClient.getOpmlImport(job.jobId)
                    importJob = job
                }
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forErrorText(e)
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
                title = { Text(tr("設定")) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        FiloIcon(FiloIconName.Back, contentDescription = tr("戻る"))
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
            errorMessage?.let { ErrorBanner(tr(it)) { scope.launch { reload() } } }
            if (isLoading || settings == null) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(40.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) { CircularProgressIndicator() }
            } else {
                val current = settings!!
                Text(tr("表示"), fontWeight = FontWeight.SemiBold)
                ChoiceRow(
                    label = tr("テーマ"),
                    options = listOf("system" to tr("システム"), "light" to tr("ライト"), "dark" to tr("ダーク")),
                    selected = current.theme,
                ) { update(theme = it) }
                ChoiceRow(
                    label = tr("言語"),
                    options = listOf("ja" to tr("日本語"), "en" to tr("English"), "zh" to tr("简体中文"), "ko" to tr("한국어"), "es" to tr("Español")),
                    selected = current.language,
                ) { update(language = it) }
                Text(
                    tr("一覧の翻訳トグルは、タイトルをこの言語へ翻訳します。"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (translations.isSupported) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(tr("翻訳の準備"), fontWeight = FontWeight.SemiBold)
                        TextButton(onClick = { translations.isShowingSetup = true }) {
                            Text(tr("言語を確認"))
                        }
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(tr("原文のまま読む言語"), style = MaterialTheme.typography.labelLarge)
                    Text(
                        tr("選択した言語の記事は翻訳せず原文で表示します。"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("ja" to "日本語", "en" to "English", "zh" to "简体中文", "ko" to "한국어", "es" to "Español").forEach { (code, name) ->
                            FilterChipButton(tr(name), current.readableLanguages.contains(code)) {
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
                    label = tr("並び順"),
                    options = listOf("published_at_desc" to tr("公開日時が新しい順"), "fetched_at_desc" to tr("取得日時が新しい順")),
                    selected = current.articleSortOrder,
                ) { update(articleSortOrder = it) }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(tr("リンクを常にブラウザで開く"))
                    Switch(
                        checked = current.openInBrowserByDefault,
                        onCheckedChange = { update(openInBrowserByDefault = it) },
                    )
                }
                HorizontalDivider()

                Text(tr("OPML"), fontWeight = FontWeight.SemiBold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { importLauncher.launch("*/*") }) { Text(tr("インポート")) }
                    OutlinedButton(onClick = {
                        scope.launch {
                            try {
                                exportedBytes = ApiClient.exportOpml()
                                com.filo.app.Analytics.track("export_opml")
                                exportLauncher.launch("filo-subscriptions.opml")
                            } catch (e: Exception) {
                                errorMessage = ErrorMessages.forErrorText(e)
                            }
                        }
                    }) { Text(tr("エクスポート")) }
                }
                importJob?.let { job ->
                    when (job.status) {
                        "pending", "running" -> Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            CircularProgressIndicator(modifier = Modifier.padding(4.dp))
                            Text(tr("インポート処理中…"))
                        }
                        "completed" -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            StatusBadge(tr("インポート完了"), BadgeTone.Ok)
                            Text(
                                trf("追加 %d / スキップ %d / 失敗 %d", job.created ?: 0, job.skipped ?: 0, job.failed ?: 0),
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
                        else -> StatusBadge(tr("インポート失敗"), BadgeTone.Danger)
                    }
                }
                HorizontalDivider()

                Text(tr("既読履歴について"), fontWeight = FontWeight.SemiBold)
                Text(
                    tr("閲覧履歴は既読記事として扱われます。記事一覧の絞り込みから既読記事を確認できます。"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                HorizontalDivider()

                Text(tr("セッション"), fontWeight = FontWeight.SemiBold)
                OutlinedButton(onClick = onSignOut) { Text(tr("サインアウト")) }
                HorizontalDivider()

                Text(tr("危険な操作"), fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.error)
                Text(
                    tr("アカウントを削除すると購読・タグ・記事の状態がすべて削除され、再ログインしても復元されません。"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Button(
                    onClick = { showDeleteConfirm = true },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                ) { Text(tr("アカウント削除")) }
            }
        }
    }

    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text(tr("アカウントを削除しますか？")) },
            text = { Text(tr("この操作は取り消せません。")) },
            confirmButton = {
                TextButton(onClick = {
                    showDeleteConfirm = false
                    scope.launch {
                        try {
                            val accepted = ApiClient.deleteAccount()
                            onDeletionAccepted(accepted.deletionToken)
                        } catch (e: Exception) {
                            errorMessage = ErrorMessages.forErrorText(e)
                        }
                    }
                }) { Text(tr("削除する"), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { showDeleteConfirm = false }) { Text(tr("キャンセル")) } },
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
    onBackToSettings: () -> Unit = {},
) {
    var status by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        while (true) {
            val result = runCatching { ApiClient.deletionStatus(deletionToken) }.getOrNull()
            if (result != null) {
                status = result.status
                if (result.status == "completed") {
                    // Better Auth deletion done: force local sign-out
                    onSignOut()
                    break
                }
                if (result.status == "none") break
            }
            delay(4000)
        }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text(tr("アカウント削除")) }) },
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
                    Text(tr("状態を確認しています…"))
                }
                "completed" -> {
                    StatusBadge(tr("削除完了"), BadgeTone.Ok)
                    Text(tr("アカウントの削除が完了しました。ご利用ありがとうございました。"))
                    Text(
                        tr("再ログインしてもデータは復元されません。"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                "failed" -> {
                    StatusBadge(tr("削除処理に失敗しました"), BadgeTone.Danger)
                    Text(tr("削除処理は自動的に再試行されます。時間をおいてもこの状態が続く場合はお問い合わせください。"))
                }
                "none" -> {
                    Text(tr("進行中の削除処理はありません。"))
                    TextButton(onClick = onBackToSettings) { Text(tr("設定へ戻る")) }
                }
                else -> {
                    CircularProgressIndicator()
                    Text(tr("削除処理中…"))
                    Text(
                        tr("この画面を閉じても削除処理は継続されます。再ログインでデータが復活することはありません。"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
