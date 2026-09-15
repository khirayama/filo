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
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
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

private enum class ReadingSource { Article, Display, Selection }

private data class ReadingSourceRequest(
    val id: Long,
    val source: ReadingSource,
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
    var extractedText by mutableStateOf<String?>(null)
        private set
    var extractedLanguage by mutableStateOf<String?>(null)
        private set
    var isExtracting by mutableStateOf(false)
        private set
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
    private var autoplayWhenReady = false
    private var playWhenExtractionReady = false
    private var playbackGeneration = 0
    private var playbackArticleId: Int? = null
    private var playbackArticleTitle: String? = null
    private var playbackTemporary = false

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
            runCatching { ApiClient.getSettings() }.getOrNull()?.let { setLanguage(it.language) }
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

    fun receiveExtracted(text: String, language: String?) {
        extractedText = clean(text)
        extractedLanguage = language ?: currentItem?.article?.sourceLanguage
        isExtracting = false
        val shouldPlay = autoplayWhenReady || playWhenExtractionReady
        autoplayWhenReady = false
        playWhenExtractionReady = false
        if (shouldPlay) {
            play()
        }
    }

    fun extractionFailed() {
        isExtracting = false
        if (temporary) {
            autoplayWhenReady = false
            playWhenExtractionReady = false
            errorMessage = AppText("本文を抽出できませんでした。")
            return
        }
        val id = currentItem?.articleId ?: run {
            autoplayWhenReady = false
            playWhenExtractionReady = false
            return
        }
        scope.launch {
            runCatching { ApiClient.requestArticleContent(id) }
            repeat(12) {
                kotlinx.coroutines.delay(500)
                val content = runCatching { ApiClient.getArticleContent(id) }.getOrNull() ?: return@repeat
                if (content.status == "ready" && content.text != null) {
                    receiveExtracted(content.text, content.sourceLanguage)
                    return@launch
                }
                if (content.status == "error") return@repeat
            }
            autoplayWhenReady = false
            playWhenExtractionReady = false
            errorMessage = AppText("本文を抽出できませんでした。")
        }
    }

    fun play() {
        val source = extractedText
        if (source.isNullOrBlank()) {
            if (isExtracting) {
                playWhenExtractionReady = true
                return
            }
            extractionFailed()
            return
        }
        playText(source, extractedLanguage)
    }

    fun playText(text: String, language: String? = null) {
        val source = clean(text)
        if (source.isBlank()) {
            errorMessage = AppText("読み上げる文章がありません。")
            return
        }
        playbackArticleId = currentItem?.articleId
        playbackArticleTitle = currentItem?.article?.title
        playbackTemporary = temporary
        val generation = ++playbackGeneration
        scope.launch {
            val translated = translateBestEffort(
                source,
                language ?: currentItem?.article?.sourceLanguage,
            )
            if (generation != playbackGeneration) return@launch
            chunks = split(translated.first)
            extractedLanguage = translated.second
            chunkIndex = 0
            isPlaying = true
            speakChunk()
        }
    }

    fun pause() {
        playbackGeneration += 1
        autoplayWhenReady = false
        playWhenExtractionReady = false
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

    fun updateRate(value: Float) {
        rate = value.coerceIn(0.75f, 3f)
        prefs().edit().putFloat("rate", rate).apply()
        if (isPlaying) play()
    }

    fun setLanguage(value: String) {
        targetLanguage = value
        prefs().edit().putString("language", value).apply()
        refreshVoices()
    }

    fun setVoice(value: String?) {
        voiceName = value
        prefs().edit().putString("voice", value).apply()
        if (isPlaying) play()
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
        val preservePlayback = isPlaying
        extractedText = null
        extractedLanguage = null
        isExtracting = currentItem?.article?.canonicalUrl != null
        playWhenExtractionReady = false
        if (!preservePlayback) {
            chunks = emptyList()
            chunkIndex = 0
        }
        notifyMedia()
    }

    private fun speakChunk() {
        if (!ttsReady || chunkIndex !in chunks.indices) {
            isPlaying = false
            return
        }
        val locale = Locale.forLanguageTag(extractedLanguage ?: targetLanguage)
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
        if (!playbackTemporary) {
            markArticleRead(playbackArticleId)
        }
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
    var showReadingSource by remember { mutableStateOf(false) }
    var showShortcutHelp by remember { mutableStateOf(false) }
    var hasSelection by remember { mutableStateOf(false) }
    var nextSourceRequestId by remember { mutableStateOf(0L) }
    var sourceRequest by remember { mutableStateOf<ReadingSourceRequest?>(null) }
    val context = LocalContext.current
    LaunchedEffect(autoplay, temporaryUrl, directArticle) { player.start(autoplay, temporaryUrl, directArticle) }

    fun startReading(source: ReadingSource) {
        showReadingSource = false
        when (source) {
            ReadingSource.Article -> player.play()
            ReadingSource.Display, ReadingSource.Selection -> {
                nextSourceRequestId += 1
                sourceRequest = ReadingSourceRequest(nextSourceRequestId, source)
            }
        }
    }
    Scaffold(
        modifier = Modifier
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
                        if (player.isPlaying) player.pause() else player.play()
                        true
                    }
                    event.key == Key.J -> {
                        player.currentItem?.let { current ->
                            val index = player.items.indexOfFirst { it.articleId == current.articleId }
                            player.items.getOrNull(index + 1)?.let { player.select(it.articleId) }
                        }
                        true
                    }
                    event.key == Key.K -> {
                        player.currentItem?.let { current ->
                            val index = player.items.indexOfFirst { it.articleId == current.articleId }
                            player.items.getOrNull(index - 1)?.let { player.select(it.articleId) }
                        }
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
        topBar = {
            TopAppBar(
                title = { Text(player.currentItem?.article?.title ?: tr("リーディングリスト"), maxLines = 1) },
                navigationIcon = {
                    androidx.compose.material3.IconButton(onClick = onBack) {
                        FiloIcon(FiloIconName.Back, contentDescription = tr("戻る"))
                    }
                },
                actions = {
                    Box(
                        modifier = Modifier
                            .size(48.dp)
                            .combinedClickable(
                                onClick = { if (player.isPlaying) player.pause() else player.play() },
                                onLongClick = { showReadingSource = true },
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        FiloIcon(
                            if (player.isPlaying) FiloIconName.Pause else FiloIconName.Play,
                            size = 22.dp,
                            tint = MaterialTheme.colorScheme.primary,
                            contentDescription = tr(if (player.isPlaying) "読み上げを停止" else "再生"),
                        )
                    }
                },
            )
        },
        bottomBar = {
            ReadingSettingsPanel(
                player = player,
                onShowReadingList = { showReadingList = true },
                onShowSettings = { showReadingSettings = true },
            )
        },
    ) { padding ->
        val currentItem = player.currentItem
        val currentUrl = currentItem?.article?.canonicalUrl
        when {
            player.isLoading -> Column(
                Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) { CircularProgressIndicator() }
            currentItem != null && currentUrl != null -> Column(
                Modifier.fillMaxSize().padding(padding),
            ) {
                ReadingWebView(
                    url = currentUrl,
                    articleId = currentItem.articleId,
                    onExtracted = player::receiveExtracted,
                    onFailure = player::extractionFailed,
                    readRequest = sourceRequest,
                    pageReady = !player.isExtracting,
                    onSourceCaptured = { request, text, language ->
                        if (sourceRequest?.id == request.id) {
                            sourceRequest = null
                            player.playText(text, language)
                        }
                    },
                    onSelectionChanged = { hasSelection = it },
                    modifier = Modifier.fillMaxWidth().weight(1f),
                )
            }
            else -> Column(
                Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) { Text(tr(player.errorMessage ?: AppText("未読の記事がありません。"))) }
        }
    }
    if (showReadingSource) {
        ModalBottomSheet(onDismissRequest = { showReadingSource = false }) {
            ReadingSourceSheet(
                hasSelection = hasSelection,
                onSelect = ::startReading,
            )
        }
    }
    if (showReadingList) {
        ModalBottomSheet(onDismissRequest = { showReadingList = false }) {
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
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showShortcutHelp = false },
            title = { Text(tr("ショートカット")) },
            text = { Text(
                tr("J / ↓  次の記事").replace(" / ↓", "") + "\n" +
                    tr("K / ↑  前の記事").replace(" / ↑", "") + "\n" +
                    tr("Space  読み上げ開始／停止") + "\n" +
                    tr("S  リーディングリストに追加") + "\n" +
                    tr("V  元記事を開く") + "\n" +
                    tr("Esc  戻る")
            ) },
            confirmButton = { TextButton(onClick = { showShortcutHelp = false }) { Text(tr("閉じる")) } },
        )
    }
    if (showReadingSettings) {
        ModalBottomSheet(onDismissRequest = { showReadingSettings = false }) {
            ReadingSettingsSheet(player)
        }
    }
}

@Composable
private fun ReadingSettingsPanel(
    player: ReadingPlayerController,
    onShowReadingList: () -> Unit,
    onShowSettings: () -> Unit,
) {
    Surface(tonalElevation = 3.dp) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onShowReadingList, enabled = !player.isTemporary) {
                FiloIcon(FiloIconName.List, size = 16.dp)
                Text(tr("リスト"))
            }
            TextButton(
                onClick = player::addCurrentPageToReadingList,
                enabled = !player.isAddingToReadingList,
            ) {
                FiloIcon(FiloIconName.QueueAdd, size = 16.dp)
                Text(tr("追加"))
            }
            androidx.compose.foundation.layout.Spacer(modifier = Modifier.weight(1f))
            IconButton(onClick = onShowSettings) {
                FiloIcon(FiloIconName.Gear, contentDescription = tr("読み上げ設定"))
            }
        }
    }
}

@Composable
private fun ReadingSettingsSheet(player: ReadingPlayerController) {
    var voiceOpen by remember { mutableStateOf(false) }
    var languageOpen by remember { mutableStateOf(false) }
    var rateOpen by remember { mutableStateOf(false) }

    Column(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(tr("読み上げ設定"), style = MaterialTheme.typography.titleMedium)
        Box(Modifier.fillMaxWidth()) {
            ReadingSettingRow(tr("声"), player.voiceName ?: tr("自動"), onClick = { voiceOpen = true })
            DropdownMenu(expanded = voiceOpen, onDismissRequest = { voiceOpen = false }) {
                DropdownMenuItem(text = { Text(tr("自動")) }, onClick = { player.setVoice(null); voiceOpen = false })
                player.voices.forEach { voice ->
                    DropdownMenuItem(text = { Text(voice) }, onClick = { player.setVoice(voice); voiceOpen = false })
                }
            }
        }
        Box(Modifier.fillMaxWidth()) {
            ReadingSettingRow(
                tr("言語"),
                AppStrings.languageName(player.targetLanguage),
                onClick = { languageOpen = true },
            )
            DropdownMenu(expanded = languageOpen, onDismissRequest = { languageOpen = false }) {
                listOf("ja", "en", "zh", "ko", "es").forEach { language ->
                    DropdownMenuItem(
                        text = { Text(AppStrings.languageName(language)) },
                        onClick = { player.setLanguage(language); languageOpen = false },
                    )
                }
            }
        }
        Box(Modifier.fillMaxWidth()) {
            ReadingSettingRow(tr("速度"), "${player.rate}x", onClick = { rateOpen = true })
            DropdownMenu(expanded = rateOpen, onDismissRequest = { rateOpen = false }) {
                listOf(0.75f, 1f, 1.25f, 1.5f, 2f, 3f).forEach { rate ->
                    DropdownMenuItem(text = { Text("${rate}x") }, onClick = { player.updateRate(rate); rateOpen = false })
                }
            }
        }
    }
}

@Composable
private fun ReadingSettingRow(label: String, value: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, color = MaterialTheme.colorScheme.primary)
        FiloIcon(FiloIconName.ChevronRight, size = 16.dp, tint = MaterialTheme.colorScheme.primary)
    }
}

@Composable
private fun ReadingSourceSheet(
    hasSelection: Boolean,
    onSelect: (ReadingSource) -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(tr("内容"), style = MaterialTheme.typography.titleMedium)
        ReadingSourceOption(ReadingSource.Article, tr("本文を抽出"), enabled = true, onSelect = onSelect)
        ReadingSourceOption(ReadingSource.Display, tr("表示中の文章"), enabled = true, onSelect = onSelect)
        ReadingSourceOption(
            source = ReadingSource.Selection,
            label = tr("選択範囲を読み上げ"),
            enabled = hasSelection,
            onSelect = onSelect,
        )
    }
}

@Composable
private fun ReadingSourceOption(
    source: ReadingSource,
    label: String,
    enabled: Boolean,
    onSelect: (ReadingSource) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled) { onSelect(source) }
            .padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FiloIcon(
            FiloIconName.Play,
            size = 18.dp,
            tint = if (enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            label,
            modifier = Modifier.padding(start = 12.dp),
            color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
fun ReadingMiniPlayer(player: ReadingPlayerController) {
    Surface(tonalElevation = 3.dp) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = player.currentPlaybackTitle ?: player.currentItem?.article?.title ?: tr("読み上げ中"),
                maxLines = 1,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = player::pause) {
                FiloIcon(FiloIconName.Close, size = 16.dp)
                Text(tr("停止"))
            }
        }
    }
}

@Composable
private fun ReadingListSheet(
    player: ReadingPlayerController,
    onSelect: (Int) -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Text(tr("リーディングリスト"), style = androidx.compose.material3.MaterialTheme.typography.titleMedium)
        if (player.visibleReadingListItems.isEmpty()) {
            Text(
                tr("リーディングリストに記事がありません。"),
                color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = 24.dp),
            )
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
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Row(
                        Modifier
                            .weight(1f)
                            .clickable(enabled = item.article.canonicalUrl != null) { onSelect(item.articleId) }
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        FiloIcon(
                            FiloIconName.CheckCircle,
                            size = 14.dp,
                            tint = if (item.articleId == player.currentItem?.articleId) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                            filled = item.articleId == player.currentItem?.articleId,
                        )
                        Text(
                            text = item.article.title,
                            style = androidx.compose.material3.MaterialTheme.typography.bodyMedium,
                            maxLines = 2,
                            modifier = Modifier.padding(start = 8.dp),
                        )
                    }
                    TextButton(
                        onClick = { player.removeFromReadingList(item.articleId) },
                        enabled = item.articleId !in player.removingReadingListArticleIds,
                    ) {
                        FiloIcon(FiloIconName.Trash, size = 16.dp)
                        Text(tr("削除"))
                    }
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
    onExtracted: (String, String?) -> Unit,
    onFailure: () -> Unit,
    readRequest: ReadingSourceRequest?,
    pageReady: Boolean,
    onSourceCaptured: (ReadingSourceRequest, String, String?) -> Unit,
    onSelectionChanged: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    key(articleId, url) {
        val webView = androidx.compose.runtime.remember {
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                isVerticalScrollBarEnabled = true
                overScrollMode = WebView.OVER_SCROLL_IF_CONTENT_SCROLLS
                addJavascriptInterface(
                    ReaderBridge(onExtracted, onFailure, onSourceCaptured, onSelectionChanged),
                    "FiloReader",
                )
                webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView, loadedUrl: String) {
                        val readability = context.assets.open("Readability.js").bufferedReader().use { it.readText() }
                        view.evaluateJavascript(
                            "(() => { const report=()=>FiloReader.selectionChanged((window.getSelection()||{}).toString());" +
                                "document.addEventListener('selectionchange', report); report(); })();" +
                            "$readability;(() => { const n=v=>String(v||'').replace(/\\s+/g,' ').trim();" +
                                "const extract=()=>{ try { const a=new Readability(document.cloneNode(true), {charThreshold:100}).parse();" +
                                "const root=document.implementation.createHTMLDocument('').body; if(a) root.innerHTML=a.content||'';" +
                                "const tags=new Set(['H1','H2','H3','H4','H5','H6','P','LI','BLOCKQUOTE','PRE','FIGCAPTION','DT','DD']), lines=[];" +
                                "const visit=x=>Array.from(x.children).forEach(c=>tags.has(c.tagName)?(n(c.textContent)&&lines.push(n(c.textContent))):visit(c));" +
                                "if(a) visit(root); if(a&&!lines.length) lines.push(...n(a.textContent).split(/\\n+/).filter(Boolean));" +
                                "const title=n(a&&a.title)||n(document.title), text=a?[title,...(lines[0]===title?lines.slice(1):lines)].filter(Boolean).join('\\n\\n'):'';" +
                                "return a&&text.length>=100?{text:text,lang:a.lang||document.documentElement.lang||null}:{error:true};" +
                                "} catch (_) { return {error:true}; } };" +
                                "const send=result=>FiloReader.postMessage(JSON.stringify(result));" +
                                "setTimeout(() => { const first=extract(); if(first.text) send(first); else setTimeout(() => send(extract()), 800); }, 500); })();",
                                null,
                        )
                    }

                    override fun onReceivedError(
                        view: WebView,
                        request: WebResourceRequest,
                        error: WebResourceError,
                    ) {
                        if (request.isForMainFrame) onFailure()
                    }
                }
                loadUrl(url)
            }
        }
        LaunchedEffect(webView, readRequest?.id, pageReady) {
            val request = readRequest ?: return@LaunchedEffect
            if (!pageReady) return@LaunchedEffect
            val source = request.source.name
            val textExpression = when (request.source) {
                ReadingSource.Selection -> "(window.getSelection()||{}).toString()"
                ReadingSource.Display -> "((document.querySelector('article,main')||document.body||{}).innerText||'')"
                ReadingSource.Article -> "''"
            }
            webView.evaluateJavascript(
                "(() => { const text=$textExpression; FiloReader.postSource(JSON.stringify(" +
                    "{requestId:${request.id},source:${JSONObject.quote(source)},text:text," +
                    "lang:document.documentElement.lang||null})); })();",
                null,
            )
        }
        DisposableEffect(webView) { onDispose { webView.destroy() } }
        AndroidView(
            factory = { webView },
            update = { view -> view.isVerticalScrollBarEnabled = true },
            modifier = modifier,
        )
    }
}

private class ReaderBridge(
    private val onExtracted: (String, String?) -> Unit,
    private val onFailure: () -> Unit,
    private val onSourceCaptured: (ReadingSourceRequest, String, String?) -> Unit,
    private val onSelectionChanged: (Boolean) -> Unit,
) {
    @JavascriptInterface
    fun postMessage(value: String) {
        Handler(Looper.getMainLooper()).post {
            runCatching {
                val json = JSONObject(value)
                val text = json.optString("text", "")
                val language = json.optString("lang").takeIf { it.isNotBlank() }
                if (text.isBlank()) onFailure() else onExtracted(text, language)
            }.onFailure { onFailure() }
        }
    }

    @JavascriptInterface
    fun postSource(value: String) {
        Handler(Looper.getMainLooper()).post {
            runCatching {
                val json = JSONObject(value)
                val requestId = json.optLong("requestId", -1L)
                val source = ReadingSource.valueOf(json.optString("source"))
                val text = json.optString("text", "")
                val language = json.optString("lang").takeIf { it.isNotBlank() }
                if (requestId >= 0) {
                    onSourceCaptured(ReadingSourceRequest(requestId, source), text, language)
                }
            }
        }
    }

    @JavascriptInterface
    fun selectionChanged(value: String) {
        Handler(Looper.getMainLooper()).post { onSelectionChanged(value.isNotBlank()) }
    }
}
