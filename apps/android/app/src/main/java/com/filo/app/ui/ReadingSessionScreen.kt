package com.filo.app.ui

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.filo.app.TtsMediaService
import com.filo.app.api.ApiClient
import com.filo.app.api.ArticleListFilters
import com.filo.app.api.ReadingSessionArticle
import com.filo.app.api.ReadingSessionItem
import com.google.android.gms.tasks.Task
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.TranslatorOptions
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

// What "read aloud" captures from the page: the page (displayed text, then
// Readability, then the server's extraction) or the current selection.
enum class CaptureKind { Page, Selection }

data class ReadingCaptureRequest(
    val id: Long,
    val kind: CaptureKind,
)

class ReadingPlayerController(
    private val context: Context,
    private val scope: CoroutineScope,
) {
    var items by mutableStateOf<List<ReadingSessionItem>>(emptyList())
        private set
    var readingListItems by mutableStateOf<List<ReadingSessionItem>>(emptyList())
        private set
    var index by mutableStateOf(-1)
        private set
    var isLoading by mutableStateOf(false)
        private set
    var isPlaying by mutableStateOf(false)
        private set
    var isPreparing by mutableStateOf(false)
        private set
    var captureRequest by mutableStateOf<ReadingCaptureRequest?>(null)
        private set
    var isPageLoaded by mutableStateOf(false)
        private set
    var hasSelection by mutableStateOf(false)
    var errorMessage by mutableStateOf<AppText?>(null)
        private set
    var isAddingToReadingList by mutableStateOf(false)
        private set
    var removedReadingListArticleIds by mutableStateOf<Set<Int>>(emptySet())
        private set
    var removingReadingListArticleIds by mutableStateOf<Set<Int>>(emptySet())
        private set
    var rate by mutableStateOf(prefs().getFloat("rate", 1f))
        private set
    var targetLanguage by mutableStateOf(prefs().getString("language", "ja") ?: "ja")
        private set
    var voiceName by mutableStateOf(prefs().getString("voice", null))
        private set
    var voices by mutableStateOf<List<String>>(emptyList())
        private set

    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var temporary = false
    private var chunks = emptyList<String>()
    private var chunkIndex = 0
    private var speechLanguage: String? = null
    private var playbackKind = CaptureKind.Page
    private var autoplayWhenReady = false
    private var nextCaptureId = 0L
    private var playbackGeneration = 0
    private var playbackArticleId: Int? = null
    private var playbackArticleTitle: String? = null

    val currentItem: ReadingSessionItem?
        get() = items.getOrNull(index)
    val isTemporary: Boolean get() = temporary
    val currentPlaybackTitle: String? get() = playbackArticleTitle
    val visibleReadingListItems: List<ReadingSessionItem>
        get() = readingListItems.filterNot { removedReadingListArticleIds.contains(it.articleId) }

    init {
        tts = TextToSpeech(context) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            refreshVoices()
        }.also { engine ->
            engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) = Unit
                override fun onError(utteranceId: String?) {
                    scope.launch { isPlaying = false; notifyMedia() }
                }
                override fun onDone(utteranceId: String?) {
                    scope.launch { finishChunk() }
                }
            })
        }
        TtsMediaService.onPlayPause = { if (isPlaying) pause() else play() }
        TtsMediaService.onDismiss = { pause() }
    }

    suspend fun start(
        autoplay: Boolean,
        temporaryUrl: String? = null,
        article: ReadingSessionArticle? = null,
    ) {
        if (isLoading) return
        isLoading = true
        errorMessage = null
        autoplayWhenReady = autoplay
        removedReadingListArticleIds = emptySet()
        runCatching {
            runCatching { ApiClient.getSettings() }.getOrNull()?.let { applyLanguage(it.language) }
            if (article != null) {
                temporary = false
                items = listOf(
                    ReadingSessionItem(
                        articleId = article.id,
                        sortOrder = 0,
                        article = article,
                    ),
                )
                index = 0
                readingListItems = runCatching { loadReadingList() }.getOrDefault(emptyList())
            } else if (temporaryUrl != null) {
                temporary = true
                readingListItems = emptyList()
                items = listOf(
                    ReadingSessionItem(
                        articleId = 0,
                        sortOrder = 0,
                        article = ReadingSessionArticle(
                            id = 0,
                            title = temporaryUrl,
                            sourceLanguage = null,
                            canonicalUrl = temporaryUrl,
                            feedTitle = AppStrings.get("共有ページ"),
                        ),
                    ),
                )
                index = 0
            } else {
                temporary = false
                val readingList = loadReadingList()
                items = readingList
                readingListItems = readingList
                index = items.indexOfFirst { !it.isRead }
                if (index < 0) errorMessage = AppText("未読の記事がありません。")
            }
            resetPage()
        }.onFailure { errorMessage = AppText("リーディングリストを開始できませんでした。") }
        isLoading = false
    }

    fun pageLoaded() {
        isPageLoaded = true
        if (autoplayWhenReady) {
            autoplayWhenReady = false
            play()
        }
    }

    fun play() = requestCapture(CaptureKind.Page)

    fun playSelection() {
        if (hasSelection) requestCapture(CaptureKind.Selection)
    }

    private fun requestCapture(kind: CaptureKind) {
        if (currentItem == null) return
        pause()
        errorMessage = null
        isPreparing = true
        captureRequest = ReadingCaptureRequest(++nextCaptureId, kind)
    }

    // The page's answer to a capture request. An empty page capture falls back
    // to the server's extraction for reading-list articles.
    fun receiveCapture(request: ReadingCaptureRequest, text: String?, language: String?) {
        if (captureRequest?.id != request.id) return
        captureRequest = null
        val generation = playbackGeneration
        if (!text.isNullOrBlank()) {
            speak(text, language, request.kind)
            return
        }
        val articleId = currentItem?.articleId?.takeIf { it > 0 && !temporary }
        if (request.kind == CaptureKind.Selection || articleId == null) {
            isPreparing = false
            errorMessage = AppText(if (request.kind == CaptureKind.Selection) "読み上げる文章がありません。" else "本文を抽出できませんでした。")
            return
        }
        scope.launch {
            val content = fetchServerText(articleId)
            if (generation != playbackGeneration) return@launch
            if (content == null) {
                isPreparing = false
                errorMessage = AppText("本文を抽出できませんでした。")
            } else {
                speak(content.first, content.second, CaptureKind.Page)
            }
        }
    }

    private suspend fun fetchServerText(articleId: Int): Pair<String, String?>? {
        runCatching { ApiClient.requestArticleContent(articleId) }
        repeat(12) {
            val content = runCatching { ApiClient.getArticleContent(articleId) }.getOrNull()
            if (content?.status == "ready" && content.text != null) return content.text to content.sourceLanguage
            if (content?.status == "error") return null
            kotlinx.coroutines.delay(500)
        }
        return null
    }

    // Finishing the page of a reading-list article marks it read; a selection
    // or a shared page does not.
    private fun speak(text: String, language: String?, kind: CaptureKind) {
        val source = clean(text)
        playbackArticleId = currentItem?.articleId?.takeIf { kind == CaptureKind.Page && !temporary }
        playbackArticleTitle = currentItem?.article?.title
        playbackKind = kind
        val generation = playbackGeneration
        scope.launch {
            val translated = translateBestEffort(source, language ?: currentItem?.article?.sourceLanguage)
            if (generation != playbackGeneration) return@launch
            chunks = split(translated.first)
            speechLanguage = translated.second
            chunkIndex = 0
            isPreparing = false
            isPlaying = true
            speakChunk()
        }
    }

    fun pause() {
        playbackGeneration += 1
        autoplayWhenReady = false
        captureRequest = null
        isPreparing = false
        tts?.stop()
        isPlaying = false
        notifyMedia()
    }

    fun select(articleId: Int) {
        val nextIndex = items.indexOfFirst { it.articleId == articleId }
        if (nextIndex >= 0) {
            if (nextIndex == index) return
            markArticleRead(currentItem?.articleId)
            pause()
            index = nextIndex
            resetPage()
            return
        }
        val listIndex = readingListItems.indexOfFirst { it.articleId == articleId }
        if (listIndex < 0) return
        markArticleRead(currentItem?.articleId)
        pause()
        items = readingListItems
        index = listIndex
        resetPage()
    }

    fun selectNext() {
        items.getOrNull(index + 1)?.let { select(it.articleId) }
    }

    fun selectPrevious() {
        if (index > 0) items.getOrNull(index - 1)?.let { select(it.articleId) }
    }

    fun updateRate(value: Float) {
        rate = value.coerceIn(0.75f, 3f)
        prefs().edit().putFloat("rate", rate).apply()
        restartIfPlaying()
    }

    fun setLanguage(value: String) {
        applyLanguage(value)
        restartIfPlaying()
    }

    private fun applyLanguage(value: String) {
        targetLanguage = value
        prefs().edit().putString("language", value).apply()
        refreshVoices()
    }

    // A settings change while speaking restarts with the new settings.
    private fun restartIfPlaying() {
        if (isPlaying) requestCapture(playbackKind)
    }

    fun setVoice(value: String?) {
        voiceName = value
        prefs().edit().putString("voice", value).apply()
        restartIfPlaying()
    }

    fun addCurrentPageToReadingList() {
        if (isAddingToReadingList) return
        val item = currentItem ?: return
        val url = item.article.canonicalUrl ?: return
        isAddingToReadingList = true
        scope.launch {
            runCatching { ApiClient.importArticle(url, item.article.title) }
                .onSuccess {
                    if (!temporary && item.articleId > 0 && readingListItems.none { it.articleId == item.articleId }) {
                        readingListItems = readingListItems + item
                    }
                }
                .onFailure { errorMessage = AppText("リーディングリストに追加できませんでした。") }
            isAddingToReadingList = false
        }
    }

    fun removeFromReadingList(articleId: Int) {
        if (articleId <= 0 || removingReadingListArticleIds.contains(articleId)) return
        removingReadingListArticleIds += articleId
        scope.launch {
            runCatching { ApiClient.setReadingListMembership(articleId, false) }
                .onSuccess { removedReadingListArticleIds += articleId }
                .onFailure { errorMessage = AppText("リーディングリストから削除できませんでした。") }
            removingReadingListArticleIds -= articleId
        }
    }

    private suspend fun loadReadingList(): List<ReadingSessionItem> {
        val result = mutableListOf<ReadingSessionItem>()
        var cursor: String? = null
        do {
            val page = ApiClient.listArticles(ArticleListFilters(readingList = true), cursor, 100)
            page.articles.forEach { article ->
                result += ReadingSessionItem(
                    articleId = article.id,
                    sortOrder = result.size,
                    article = ReadingSessionArticle(
                        id = article.id,
                        title = article.title,
                        sourceLanguage = article.sourceLanguage,
                        canonicalUrl = article.canonicalUrl,
                        feedTitle = article.feedTitle,
                    ),
                    isRead = article.userState.isRead,
                )
            }
            cursor = page.nextCursor
        } while (cursor != null)
        return result
    }

    fun shutdown() {
        pause()
        tts?.shutdown()
        tts = null
        TtsMediaService.onPlayPause = null
        TtsMediaService.onDismiss = null
        context.stopService(Intent(context, TtsMediaService::class.java))
    }

    private fun resetPage() {
        isPageLoaded = false
        hasSelection = false
        chunks = emptyList()
        chunkIndex = 0
        notifyMedia()
    }

    private fun speakChunk() {
        if (!ttsReady || chunkIndex !in chunks.indices) {
            isPlaying = false
            return
        }
        val locale = Locale.forLanguageTag(speechLanguage ?: targetLanguage)
        tts?.language = locale
        tts?.setSpeechRate(rate)
        voiceName?.let { selected -> tts?.voices?.firstOrNull { it.name == selected }?.let { tts?.voice = it } }
        tts?.speak(chunks[chunkIndex], TextToSpeech.QUEUE_FLUSH, null, "filo-$chunkIndex")
        notifyMedia()
    }

    private suspend fun finishChunk() {
        if (!isPlaying) return
        chunkIndex += 1
        if (chunkIndex < chunks.size) {
            speakChunk()
            return
        }
        isPlaying = false
        notifyMedia()
        markArticleRead(playbackArticleId)
    }

    private fun markArticleRead(articleId: Int?) {
        if (articleId == null || articleId <= 0) return
        val knownRead = (items + readingListItems)
            .firstOrNull { it.articleId == articleId }
            ?.isRead == true
        if (knownRead) return
        items = items.map { if (it.articleId == articleId) it.copy(isRead = true) else it }
        readingListItems = readingListItems.map { if (it.articleId == articleId) it.copy(isRead = true) else it }
        scope.launch { runCatching { ApiClient.setArticleRead(articleId, true) } }
    }

    private suspend fun translateBestEffort(text: String, sourceLanguage: String?): Pair<String, String?> {
        val source = sourceLanguage?.substringBefore('-') ?: return text to sourceLanguage
        val target = targetLanguage.substringBefore('-')
        if (source == target) return text to sourceLanguage
        val sourceCode = TranslateLanguage.fromLanguageTag(source) ?: return text to sourceLanguage
        val targetCode = TranslateLanguage.fromLanguageTag(target) ?: return text to sourceLanguage
        val translator = Translation.getClient(
            TranslatorOptions.Builder().setSourceLanguage(sourceCode).setTargetLanguage(targetCode).build(),
        )
        return try {
            translator.downloadModelIfNeeded(DownloadConditions.Builder().build()).awaitReading()
            val output = mutableListOf<String>()
            for (chunk in split(text)) output += translator.translate(chunk).awaitReading()
            output.joinToString("\n\n") to target
        } catch (_: Exception) {
            text to sourceLanguage
        } finally {
            translator.close()
        }
    }

    private fun refreshVoices() {
        voices = tts?.voices.orEmpty()
            .filter { it.locale.language == targetLanguage.substringBefore('-') }
            .map { it.name }
            .sorted()
    }

    private fun notifyMedia() {
        val item = currentItem ?: return
        val intent = Intent(context, TtsMediaService::class.java).apply {
            action = TtsMediaService.ACTION_UPDATE
            putExtra("title", playbackArticleTitle ?: item.article.title)
            putExtra("playState", if (isPlaying) "playing" else "paused")
            putExtra("chunk", chunkIndex)
            putExtra("total", chunks.size)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ContextCompat.startForegroundService(context, intent)
        else context.startService(intent)
    }

    private fun clean(text: String): String = text
        .replace(Regex("https?://\\S+"), "")
        .replace(Regex("\\s+"), " ")
        .trim()

    private fun split(text: String, limit: Int = 3000): List<String> {
        if (text.length <= limit) return listOf(text)
        val result = mutableListOf<String>()
        var rest = text
        while (rest.length > limit) {
            val slice = rest.take(limit)
            val split = maxOf(slice.lastIndexOf('。'), slice.lastIndexOf('.'), slice.lastIndexOf(' '))
                .takeIf { it > limit * 0.4 } ?: limit
            result += rest.take(split + if (split < limit) 1 else 0).trim()
            rest = rest.drop(split + if (split < limit) 1 else 0).trim()
        }
        if (rest.isNotEmpty()) result += rest
        return result
    }

    private fun prefs() = context.getSharedPreferences("filo_reading", Context.MODE_PRIVATE)
}

private suspend fun <T> Task<T>.awaitReading(): T = suspendCancellableCoroutine { continuation ->
    addOnSuccessListener { continuation.resume(it) }
    addOnFailureListener { continuation.resumeWithException(it) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReadingSessionScreen(
    player: ReadingPlayerController,
    autoplay: Boolean,
    onBack: () -> Unit,
    temporaryUrl: String? = null,
    directArticle: ReadingSessionArticle? = null,
) {
    var showReadingList by remember { mutableStateOf(false) }
    var showReadingSettings by remember { mutableStateOf(false) }
    var showShortcutHelp by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val busy = player.isPlaying || player.isPreparing
    LaunchedEffect(autoplay, temporaryUrl, directArticle) { player.start(autoplay, temporaryUrl, directArticle) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .onPreviewKeyEvent { event ->
            if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
            val hasModifier = event.isCtrlPressed || event.isAltPressed || event.isMetaPressed
            if (event.isShiftPressed && event.key == Key.Slash && !hasModifier) {
                showShortcutHelp = true
                true
            } else if (hasModifier) {
                false
            } else if (
                event.nativeKeyEvent.repeatCount > 0
                && event.key != Key.J
                && event.key != Key.K
            ) {
                false
            } else {
                when {
                    event.key == Key.Spacebar -> {
                        if (busy) player.pause() else player.play()
                        true
                    }
                    event.key == Key.J -> {
                        player.selectNext()
                        true
                    }
                    event.key == Key.K -> {
                        player.selectPrevious()
                        true
                    }
                    event.key == Key.S -> {
                        player.addCurrentPageToReadingList()
                        true
                    }
                    event.key == Key.V -> {
                        player.currentItem?.article?.canonicalUrl?.let {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it)))
                        }
                        true
                    }
                    event.key == Key.Escape -> {
                        onBack()
                        true
                    }
                    else -> false
                }
            }
        },
    ) {
        FiloHeader(
            title = player.currentItem?.article?.title ?: tr("リーディングリスト"),
            lead = HeaderLead.Back,
            onLead = onBack,
        ) {
            FiloIconButton(
                if (busy) FiloIconName.Pause else FiloIconName.Play,
                tr(if (busy) "読み上げを停止" else "このページを読み上げ"),
                { if (busy) player.pause() else player.play() },
                tint = Filo.colors.accent,
                filled = busy,
                enabled = player.currentItem != null,
            )
        }
        val currentItem = player.currentItem
        val currentUrl = currentItem?.article?.canonicalUrl
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                player.isLoading -> FiloSpinner(modifier = Modifier.align(Alignment.Center))
                currentItem != null && currentUrl != null -> ReadingWebView(
                    url = currentUrl,
                    articleId = currentItem.articleId,
                    captureRequest = player.captureRequest,
                    pageLoaded = player.isPageLoaded,
                    onPageLoaded = player::pageLoaded,
                    onCaptured = player::receiveCapture,
                    onSelectionChanged = { player.hasSelection = it },
                    modifier = Modifier.fillMaxSize(),
                )
                else -> FiloEmptyState(
                    tr(player.errorMessage ?: AppText("未読の記事がありません。")),
                    FiloIconName.Playlist,
                    modifier = Modifier.align(Alignment.Center),
                )
            }
        }
        if (currentItem != null) {
            player.errorMessage?.let { message ->
                Text(
                    tr(message),
                    fontSize = 13.sp,
                    color = Filo.colors.danger,
                    modifier = Modifier.fillMaxWidth().background(Filo.colors.bg).padding(horizontal = Filo.Gutter, vertical = 8.dp),
                )
            }
        }
        ReadingToolbar(
            player = player,
            onShowReadingList = { showReadingList = true },
            onShowSettings = { showReadingSettings = true },
        )
    }
    if (showReadingList) {
        FiloSheet(onDismiss = { showReadingList = false }) {
            ReadingListSheet(
                player = player,
                onSelect = { articleId ->
                    player.select(articleId)
                    showReadingList = false
                },
            )
        }
    }
    if (showShortcutHelp) {
        ShortcutHelpDialog(
            listOf(
                tr("J / ↓  次の記事").replace(" / ↓", ""),
                tr("K / ↑  前の記事").replace(" / ↑", ""),
                tr("Space  読み上げ開始／停止"),
                tr("S  リーディングリストに追加"),
                tr("V  元記事を開く"),
                tr("Esc  戻る"),
            ),
        ) { showShortcutHelp = false }
    }
    if (showReadingSettings) {
        FiloSheet(onDismiss = { showReadingSettings = false }) {
            ReadingSettingsSheet(player)
        }
    }
}

@Composable
private fun ReadingToolbar(
    player: ReadingPlayerController,
    onShowReadingList: () -> Unit,
    onShowSettings: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Filo.colors.bg)
            .topBorder(Filo.colors.mutedBorder)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FiloButton(
            tr("リスト"),
            onShowReadingList,
            kind = ButtonKind.Ghost,
            icon = FiloIconName.Playlist,
            enabled = !player.isTemporary,
        )
        FiloButton(
            tr("追加"),
            player::addCurrentPageToReadingList,
            kind = ButtonKind.Ghost,
            icon = FiloIconName.QueueAdd,
            enabled = !player.isAddingToReadingList && player.currentItem != null,
        )
        FiloButton(
            tr("選択範囲を読み上げ"),
            player::playSelection,
            kind = ButtonKind.Ghost,
            icon = FiloIconName.Play,
            enabled = player.hasSelection,
        )
        Spacer(Modifier.weight(1f))
        FiloIconButton(FiloIconName.Gear, tr("読み上げ設定"), onShowSettings)
    }
}

@Composable
private fun ReadingSettingsSheet(player: ReadingPlayerController) {
    var voiceOpen by remember { mutableStateOf(false) }
    var languageOpen by remember { mutableStateOf(false) }
    var rateOpen by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 24.dp)) {
        SheetTitle(tr("読み上げ設定"))
        Box(Modifier.fillMaxWidth()) {
            ReadingSettingRow(tr("声"), player.voiceName ?: tr("自動"), onClick = { voiceOpen = true })
            FiloMenu(expanded = voiceOpen, onDismiss = { voiceOpen = false }) {
                FiloMenuItem(tr("自動"), { player.setVoice(null); voiceOpen = false }, selected = player.voiceName == null)
                player.voices.forEach { voice ->
                    FiloMenuItem(voice, { player.setVoice(voice); voiceOpen = false }, selected = player.voiceName == voice)
                }
            }
        }
        FiloDivider()
        Box(Modifier.fillMaxWidth()) {
            ReadingSettingRow(tr("言語"), AppStrings.languageName(player.targetLanguage), onClick = { languageOpen = true })
            FiloMenu(expanded = languageOpen, onDismiss = { languageOpen = false }) {
                listOf("ja", "en", "zh", "ko", "es").forEach { language ->
                    FiloMenuItem(
                        AppStrings.languageName(language),
                        { player.setLanguage(language); languageOpen = false },
                        selected = player.targetLanguage == language,
                    )
                }
            }
        }
        FiloDivider()
        Box(Modifier.fillMaxWidth()) {
            ReadingSettingRow(tr("速度"), "${player.rate}x", onClick = { rateOpen = true })
            FiloMenu(expanded = rateOpen, onDismiss = { rateOpen = false }) {
                listOf(0.75f, 1f, 1.25f, 1.5f, 2f, 3f).forEach { rate ->
                    FiloMenuItem("${rate}x", { player.updateRate(rate); rateOpen = false }, selected = player.rate == rate)
                }
            }
        }
    }
}

@Composable
private fun ReadingSettingRow(label: String, value: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clickable(onClick = onClick),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, fontSize = 14.sp, color = Filo.colors.text, modifier = Modifier.weight(1f))
        Text(value, fontSize = 14.sp, color = Filo.colors.muted, maxLines = 1)
        FiloIcon(FiloIconName.ChevronDown, size = 16.dp)
    }
}

@Composable
fun ReadingMiniPlayer(player: ReadingPlayerController) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Filo.colors.bg)
            .topBorder(Filo.colors.mutedBorder)
            .padding(start = Filo.Gutter, end = 8.dp, top = 6.dp, bottom = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FiloIcon(FiloIconName.Play, size = 14.dp, tint = Filo.colors.accent, filled = true)
        Text(
            text = player.currentPlaybackTitle ?: player.currentItem?.article?.title ?: tr("読み上げ中"),
            fontSize = 14.sp,
            color = Filo.colors.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        FiloButton(tr("停止"), player::pause, small = true, icon = FiloIconName.Pause)
    }
}

@Composable
private fun ReadingListSheet(
    player: ReadingPlayerController,
    onSelect: (Int) -> Unit,
) {
    val colors = Filo.colors
    Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, bottom = 24.dp)) {
        SheetTitle(tr("リーディングリスト"))
        if (player.visibleReadingListItems.isEmpty()) {
            FiloEmptyState(tr("リーディングリストに記事がありません。"), FiloIconName.Playlist)
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .fillMaxHeight(0.75f),
            ) {
                items(
                    items = player.visibleReadingListItems,
                    key = { it.articleId },
                ) { item ->
                    val current = item.articleId == player.currentItem?.articleId
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .bottomBorder(colors.mutedBorder),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            Modifier
                                .weight(1f)
                                .heightIn(min = 48.dp)
                                .clickable(enabled = item.article.canonicalUrl != null) { onSelect(item.articleId) }
                                .padding(vertical = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            FiloIcon(
                                if (current) FiloIconName.Play else FiloIconName.CheckCircle,
                                size = 14.dp,
                                tint = if (current || item.isRead) colors.accent else colors.muted,
                                filled = current,
                            )
                            Text(
                                text = item.article.title,
                                fontSize = 14.sp,
                                lineHeight = 20.sp,
                                fontWeight = if (current) FontWeight.SemiBold else FontWeight.Normal,
                                color = if (item.isRead && !current) colors.muted else colors.text,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        FiloIconButton(
                            FiloIconName.Trash,
                            tr("リーディングリストから削除"),
                            { player.removeFromReadingList(item.articleId) },
                            size = 16.dp,
                            enabled = item.articleId !in player.removingReadingListArticleIds,
                        )
                    }
                }
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun ReadingWebView(
    url: String,
    articleId: Int,
    captureRequest: ReadingCaptureRequest?,
    pageLoaded: Boolean,
    onPageLoaded: () -> Unit,
    onCaptured: (ReadingCaptureRequest, String?, String?) -> Unit,
    onSelectionChanged: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    key(articleId, url) {
        val webView = remember {
            val scripts = listOf("Readability.js", "FiloCapture.js").joinToString(";\n") { name ->
                context.assets.open(name).bufferedReader().use { it.readText() }
            }
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                isVerticalScrollBarEnabled = true
                overScrollMode = WebView.OVER_SCROLL_IF_CONTENT_SCROLLS
                addJavascriptInterface(SelectionBridge(onSelectionChanged), "FiloReader")
                webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView, loadedUrl: String) {
                        view.evaluateJavascript(
                            "$scripts;(() => { const report = () => FiloReader.selectionChanged(window.__filoHasSelection());" +
                                "document.addEventListener('selectionchange', report); report(); })();",
                        ) { onPageLoaded() }
                    }
                }
                loadUrl(url)
            }
        }
        // Capture when asked, once the page has loaded. A page that renders
        // after load gets one more try before the controller falls back.
        LaunchedEffect(webView, captureRequest?.id, pageLoaded) {
            val request = captureRequest ?: return@LaunchedEffect
            if (!pageLoaded) return@LaunchedEffect
            val kind = if (request.kind == CaptureKind.Selection) "selection" else "page"
            var captured = webView.capture(kind)
            if (captured == null && request.kind == CaptureKind.Page) {
                kotlinx.coroutines.delay(800)
                captured = webView.capture(kind)
            }
            onCaptured(request, captured?.first, captured?.second)
        }
        DisposableEffect(webView) { onDispose { webView.destroy() } }
        AndroidView(
            factory = { webView },
            update = { view -> view.isVerticalScrollBarEnabled = true },
            modifier = modifier,
        )
    }
}

private suspend fun WebView.capture(kind: String): Pair<String, String?>? = suspendCancellableCoroutine { continuation ->
    evaluateJavascript("window.__filoCapture ? window.__filoCapture(${JSONObject.quote(kind)}) : null") { json ->
        val result = runCatching {
            val value = JSONObject(json)
            val text = value.optString("text", "")
            if (text.isBlank()) null else text to value.optString("lang").takeIf { it.isNotBlank() && it != "null" }
        }.getOrNull()
        if (continuation.isActive) continuation.resume(result)
    }
}

private class SelectionBridge(private val onSelectionChanged: (Boolean) -> Unit) {
    @JavascriptInterface
    fun selectionChanged(value: Boolean) {
        Handler(Looper.getMainLooper()).post { onSelectionChanged(value) }
    }
}
