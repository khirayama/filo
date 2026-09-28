package com.filo.app.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.filo.app.LanguagePreference
import com.filo.app.ThemePreference
import com.filo.app.api.ApiClient
import com.filo.app.api.ErrorMessages
import com.filo.app.api.OpmlImportJob
import com.filo.app.api.UserSettings
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val SupportedLanguages = listOf("ja", "en", "zh", "ko", "es")

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(
    translations: TitleTranslationStore,
    onOpenMenu: (() -> Unit)?,
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


    Column(Modifier.fillMaxSize()) {
        FiloHeader(
            title = tr("設定"),
            lead = if (onOpenMenu != null) HeaderLead.Menu else HeaderLead.None,
            onLead = { onOpenMenu?.invoke() },
        )
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(PagePadding),
            verticalArrangement = Arrangement.spacedBy(28.dp),
        ) {
            errorMessage?.let { FiloErrorBox(tr(it)) { scope.launch { reload() } } }
            val current = settings
            if (isLoading || current == null) {
                FiloSpinner()
                return@Column
            }
            SettingSection(tr("表示設定")) {
                SettingRow(tr("テーマ")) {
                    FiloSelect(
                        options = listOf("system" to tr("システムに合わせる"), "light" to tr("ライト"), "dark" to tr("ダーク")),
                        selected = current.theme,
                        onSelect = { update(theme = it) },
                        label = tr("テーマ"),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                SettingDivider()
                SettingRow(tr("言語"), hint = tr("一覧の翻訳トグルは、タイトルをこの言語へ翻訳します。")) {
                    FiloSelect(
                        options = SupportedLanguages.map { it to AppStrings.languageName(it) },
                        selected = current.language,
                        onSelect = { update(language = it) },
                        label = tr("言語"),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                SettingDivider()
                SettingRow(tr("記事の並び順")) {
                    FiloSelect(
                        options = listOf("published_at_desc" to tr("公開日時が新しい順"), "fetched_at_desc" to tr("取得日時が新しい順")),
                        selected = current.articleSortOrder,
                        onSelect = { update(articleSortOrder = it) },
                        label = tr("記事の並び順"),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                SettingDivider()
                SettingRow(tr("リンクを常にブラウザで開く"), inline = true) {
                    FiloSwitch(
                        current.openInBrowserByDefault,
                        { update(openInBrowserByDefault = it) },
                        tr("リンクを常にブラウザで開く"),
                    )
                }
            }

            SettingSection(tr("翻訳")) {
                if (translations.isSupported) {
                    SettingRow(tr("翻訳の準備"), inline = true) {
                        FiloButton(tr("言語を確認"), { translations.isShowingSetup = true }, small = true)
                    }
                    SettingDivider()
                }
                SettingRow(tr("原文のまま読む言語")) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        SupportedLanguages.forEach { code ->
                            val checked = current.readableLanguages.contains(code)
                            FiloChip(AppStrings.languageName(code), checked, {
                                update(readableLanguages = if (checked) current.readableLanguages - code else current.readableLanguages + code)
                            })
                        }
                    }
                }
            }

            SettingSection("OPML") {
                SettingBlock {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        val importing = importJob?.status == "pending" || importJob?.status == "running"
                        FiloButton(tr("インポート"), { importLauncher.launch("*/*") }, enabled = !importing)
                        FiloButton(tr("エクスポート"), {
                            scope.launch {
                                try {
                                    exportedBytes = ApiClient.exportOpml()
                                    com.filo.app.Analytics.track("export_opml")
                                    exportLauncher.launch("filo-subscriptions.opml")
                                } catch (e: Exception) {
                                    errorMessage = ErrorMessages.forErrorText(e)
                                }
                            }
                        })
                    }
                }
                importJob?.let { job ->
                    SettingDivider()
                    SettingBlock {
                        when (job.status) {
                            "pending", "running" -> FiloBadge(tr("インポート処理中…"))
                            "completed" -> {
                                FiloBadge(tr("インポート完了"), BadgeTone.Ok)
                                Text(
                                    trf("追加 %d / スキップ %d / 失敗 %d", job.created ?: 0, job.skipped ?: 0, job.failed ?: 0),
                                    fontSize = 13.sp,
                                    color = Filo.colors.muted,
                                )
                                job.failures.take(5).forEach { failure ->
                                    Text("・${failure.feedUrl}", fontSize = 12.sp, color = Filo.colors.muted, maxLines = 1)
                                }
                            }
                            else -> FiloBadge(tr("インポート失敗"), BadgeTone.Danger)
                        }
                    }
                }
            }

            SettingSection(tr("既読履歴について")) {
                SettingBlock {
                    Text(
                        tr("閲覧履歴は既読記事として扱われます。記事一覧の絞り込みから既読記事を確認できます。"),
                        fontSize = 13.sp,
                        lineHeight = 21.sp,
                        color = Filo.colors.muted,
                    )
                }
            }

            SettingSection(tr("セッション")) {
                SettingBlock { FiloButton(tr("サインアウト"), onSignOut) }
            }

            SettingSection(tr("危険な操作"), danger = true) {
                SettingBlock {
                    Text(
                        tr("アカウントを削除すると購読・タグ・記事の状態がすべて削除され、再ログインしても復元されません。"),
                        fontSize = 13.sp,
                        lineHeight = 21.sp,
                        color = Filo.colors.muted,
                    )
                    FiloButton(
                        tr("アカウント削除"),
                        { showDeleteConfirm = true },
                        kind = ButtonKind.Danger,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }

    if (showDeleteConfirm) {
        FiloConfirmDialog(
            title = tr("アカウントを削除しますか？"),
            message = tr("この操作は取り消せません。"),
            confirmLabel = tr("削除する"),
            danger = true,
            onConfirm = {
                showDeleteConfirm = false
                scope.launch {
                    try {
                        val accepted = ApiClient.deleteAccount()
                        onDeletionAccepted(accepted.deletionToken)
                    } catch (e: Exception) {
                        errorMessage = ErrorMessages.forErrorText(e)
                    }
                }
            },
            onDismiss = { showDeleteConfirm = false },
        )
    }
}

@Composable
private fun SettingSection(title: String, danger: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    Column {
        FiloSectionTitle(title, danger)
        FiloCard(danger = danger, content = content)
    }
}

@Composable
private fun SettingDivider() = FiloDivider()

// `inline` keeps the control beside the label (switches, small buttons); other
// rows stack the control under the label, as on narrow web screens.
@Composable
private fun SettingRow(
    label: String,
    hint: String? = null,
    inline: Boolean = false,
    control: @Composable () -> Unit,
) {
    val text: @Composable () -> Unit = {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, fontSize = 14.sp, color = Filo.colors.text)
            if (hint != null) Text(hint, fontSize = 12.sp, lineHeight = 18.sp, color = Filo.colors.muted)
        }
    }
    if (inline) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .padding(start = 16.dp, end = 12.dp, top = 6.dp, bottom = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) { text() }
            control()
        }
    } else {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            text()
            control()
        }
    }
}

@Composable
private fun SettingBlock(content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically),
        content = content,
    )
}

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

    Column(Modifier.fillMaxSize()) {
        FiloHeader(tr("アカウント削除"))
        Column(
            modifier = Modifier.fillMaxSize().padding(PagePadding),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val body: @Composable (String) -> Unit = { Text(it, fontSize = 14.sp, lineHeight = 22.sp, color = Filo.colors.text) }
            val note: @Composable (String) -> Unit = { Text(it, fontSize = 13.sp, lineHeight = 21.sp, color = Filo.colors.muted) }
            when (status) {
                null -> FiloSpinner(tr("状態を確認しています…"))
                "completed" -> {
                    FiloBadge(tr("削除完了"), BadgeTone.Ok)
                    body(tr("アカウントの削除が完了しました。ご利用ありがとうございました。"))
                    note(tr("再ログインしてもデータは復元されません。"))
                }
                "failed" -> {
                    FiloBadge(tr("削除処理に失敗しました"), BadgeTone.Danger)
                    body(tr("削除処理は自動的に再試行されます。時間をおいてもこの状態が続く場合はお問い合わせください。"))
                }
                "none" -> {
                    body(tr("進行中の削除処理はありません。"))
                    FiloButton(tr("設定へ戻る"), onBackToSettings)
                }
                else -> {
                    FiloSpinner(tr("削除処理中…"))
                    note(tr("この画面を閉じても削除処理は継続されます。再ログインでデータが復活することはありません。"))
                }
            }
        }
    }
}
