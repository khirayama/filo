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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
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
    var errorMessage by mutableStateOf<String?>(null)
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
                            feedTitle = "共有ページ",
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
                if (index < 0) errorMessage = "未読の記事がありません。"
            }
            resetPage()
        }.onFailure { errorMessage = "リーディングリストを開始できませんでした。" }
        isLoading = false
    }

    fun receiveExtracted(text: String, language: String?) {
        extractedText = clean(text)
        extractedLanguage = language ?: currentItem?.article?.sourceLanguage
        if (autoplayWhenReady) {
            autoplayWhenReady = false
            play()
        }
    }

    fun extractionFailed() {
        if (temporary) {
            errorMessage = "本文を抽出できませんでした。"
            return
        }
        val id = currentItem?.articleId ?: return
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
            errorMessage = "本文を抽出できませんでした。"
        }
    }

    fun play() {
        val source = extractedText
        if (source.isNullOrBlank()) {
            extractionFailed()
            return
        }
        playbackArticleId = currentItem?.articleId
        playbackArticleTitle = currentItem?.article?.title
        playbackTemporary = temporary
        val generation = ++playbackGeneration
        scope.launch {
            val translated = translateBestEffort(source, extractedLanguage ?: currentItem?.article?.sourceLanguage)
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
        tts?.stop()
        isPlaying = false
        notifyMedia()
    }

    fun select(articleId: Int) {
        val nextIndex = items.indexOfFirst { it.articleId == articleId }
        if (nextIndex >= 0) {
            if (nextIndex == index) return
            pause()
            index = nextIndex
            resetPage()
            return
        }
        val listIndex = readingListItems.indexOfFirst { it.articleId == articleId }
        if (listIndex < 0) return
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
                .onFailure { errorMessage = "リーディングリストに追加できませんでした。" }
            isAddingToReadingList = false
        }
    }

    fun removeFromReadingList(articleId: Int) {
        if (articleId <= 0 || removingReadingListArticleIds.contains(articleId)) return
        removingReadingListArticleIds += articleId
        scope.launch {
            runCatching { ApiClient.setReadingListMembership(articleId, false) }
                .onSuccess { removedReadingListArticleIds += articleId }
                .onFailure { errorMessage = "リーディングリストから削除できませんでした。" }
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
            playbackArticleId?.let { runCatching { ApiClient.setArticleRead(it, true) } }
        }
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
    var showShortcutHelp by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }
    LaunchedEffect(autoplay, temporaryUrl, directArticle) { player.start(autoplay, temporaryUrl, directArticle) }
    Scaffold(
        modifier = Modifier
            .focusRequester(focusRequester)
            .focusable()
            .onPreviewKeyEvent { event ->
            if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
            val hasModifier = event.isCtrlPressed || event.isAltPressed || event.isMetaPressed
            if (event.isShiftPressed && event.key == Key.Slash && !hasModifier) {
                showShortcutHelp = true
                true
            } else if (hasModifier) {
                false
            } else {
                when {
                    event.key == Key.Spacebar -> {
                        if (player.isPlaying) player.pause() else player.play()
                        true
                    }
                    event.key == Key.J || event.key == Key.DirectionDown -> {
                        player.currentItem?.let { current ->
                            val index = player.items.indexOfFirst { it.articleId == current.articleId }
                            player.items.getOrNull(index + 1)?.let { player.select(it.articleId) }
                        }
                        true
                    }
                    event.key == Key.K || event.key == Key.DirectionUp -> {
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
                title = { Text(player.currentItem?.article?.title ?: "リーディングリスト", maxLines = 1) },
                navigationIcon = { TextButton(onClick = onBack) { Text("戻る") } },
            )
        },
        bottomBar = { ReadingSettingsPanel(player) { showReadingList = true } },
    ) { padding ->
        when {
            player.isLoading -> Column(
                Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) { CircularProgressIndicator() }
            player.currentItem?.article?.canonicalUrl != null -> Column(
                Modifier.fillMaxSize().padding(padding),
            ) {
                ReadingWebView(
                    url = player.currentItem!!.article.canonicalUrl!!,
                    articleId = player.currentItem!!.articleId,
                    onExtracted = player::receiveExtracted,
                    onFailure = player::extractionFailed,
                    modifier = Modifier.fillMaxWidth().weight(1f),
                )
            }
            else -> Column(
                Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) { Text(player.errorMessage ?: "未読の記事がありません。") }
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
            title = { Text("ショートカット") },
            text = { Text("J / ↓  次の記事\nK / ↑  前の記事\nSpace  読み上げ開始／停止\nS  リーディングリストに追加\nV  元記事を開く\nEsc  戻る") },
            confirmButton = { TextButton(onClick = { showShortcutHelp = false }) { Text("閉じる") } },
        )
    }
}

@Composable
private fun ReadingSettingsPanel(
    player: ReadingPlayerController,
    onShowReadingList: () -> Unit,
) {
    var voiceOpen by remember { mutableStateOf(false) }
    var languageOpen by remember { mutableStateOf(false) }
    var rateOpen by remember { mutableStateOf(false) }
    Surface(tonalElevation = 3.dp) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Button(
            onClick = if (player.isPlaying) player::pause else player::play,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (player.isPlaying) "停止" else "このページを読み上げ") }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = onShowReadingList,
                    enabled = !player.isTemporary,
                    modifier = Modifier.weight(1f),
                ) { Text("リスト") }
                OutlinedButton(
                    onClick = player::addCurrentPageToReadingList,
                    enabled = !player.isAddingToReadingList,
                    modifier = Modifier.weight(1f),
                ) { Text("リストに追加") }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { voiceOpen = true }) { Text(player.voiceName ?: "声: 自動") }
            DropdownMenu(expanded = voiceOpen, onDismissRequest = { voiceOpen = false }) {
                DropdownMenuItem(text = { Text("自動") }, onClick = { player.setVoice(null); voiceOpen = false })
                player.voices.forEach { voice -> DropdownMenuItem(text = { Text(voice) }, onClick = { player.setVoice(voice); voiceOpen = false }) }
            }
            TextButton(onClick = { languageOpen = true }) { Text("言語: ${player.targetLanguage}") }
            DropdownMenu(expanded = languageOpen, onDismissRequest = { languageOpen = false }) {
                listOf("ja", "en", "zh", "ko", "es").forEach { language ->
                    DropdownMenuItem(text = { Text(language) }, onClick = { player.setLanguage(language); languageOpen = false })
                }
            }
            TextButton(onClick = { rateOpen = true }) { Text("${player.rate}x") }
            DropdownMenu(expanded = rateOpen, onDismissRequest = { rateOpen = false }) {
                listOf(0.75f, 1f, 1.25f, 1.5f, 2f, 3f).forEach { rate ->
                    DropdownMenuItem(text = { Text("${rate}x") }, onClick = { player.updateRate(rate); rateOpen = false })
                }
            }
            }
        }
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
                text = player.currentPlaybackTitle ?: player.currentItem?.article?.title ?: "読み上げ中",
                maxLines = 1,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = player::pause) { Text("停止") }
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
        Text("リーディングリスト", style = androidx.compose.material3.MaterialTheme.typography.titleMedium)
        if (player.visibleReadingListItems.isEmpty()) {
            Text(
                "リーディングリストに記事がありません。",
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
                        Text(
                            text = if (item.articleId == player.currentItem?.articleId) "●" else "○",
                            style = androidx.compose.material3.MaterialTheme.typography.bodyMedium,
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
                    ) { Text("削除") }
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
                addJavascriptInterface(ReaderBridge(onExtracted, onFailure), "FiloReader")
                webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView, loadedUrl: String) {
                        val readability = context.assets.open("Readability.js").bufferedReader().use { it.readText() }
                        view.evaluateJavascript(
                            "$readability;(() => { const a = new Readability(document.cloneNode(true), {charThreshold:100}).parse();" +
                                "const n=v=>String(v||'').replace(/\\s+/g,' ').trim();" +
                                "const root=document.implementation.createHTMLDocument('').body; if(a) root.innerHTML=a.content||'';" +
                                "const tags=new Set(['H1','H2','H3','H4','H5','H6','P','LI','BLOCKQUOTE','PRE','FIGCAPTION','DT','DD']), lines=[];" +
                                "const visit=x=>Array.from(x.children).forEach(c=>tags.has(c.tagName)?(n(c.textContent)&&lines.push(n(c.textContent))):visit(c));" +
                                "if(a) visit(root); if(a&&!lines.length) lines.push(...n(a.textContent).split(/\\n+/).filter(Boolean));" +
                                "const title=n(a&&a.title)||n(document.title), text=a?[title,...(lines[0]===title?lines.slice(1):lines)].filter(Boolean).join('\\n\\n'):'';" +
                                "FiloReader.postMessage(JSON.stringify(text.length>=100?{text:text,lang:a.lang||document.documentElement.lang||null}:{error:true})); })();",
                            null,
                        )
                    }
                }
                loadUrl(url)
            }
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
}
