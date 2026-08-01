package com.filo.app.ui

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.filo.app.TtsMediaService
import com.filo.app.api.ApiClient
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
    private var chunks = emptyList<String>()
    private var chunkIndex = 0
    private var continuousRead = false
    private var autoplayWhenReady = false

    val currentItem: ReadingSessionItem?
        get() = items.getOrNull(index)
    val canPrevious: Boolean get() = index > 0
    val canNext: Boolean get() = index >= 0 && index + 1 < items.size

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
        TtsMediaService.onNext = { next() }
        TtsMediaService.onPrev = { previous() }
        TtsMediaService.onDismiss = { pause() }
    }

    suspend fun start(autoplay: Boolean) {
        if (isLoading) return
        isLoading = true
        errorMessage = null
        continuousRead = autoplay
        autoplayWhenReady = autoplay
        runCatching {
            val session = ApiClient.startReadingSession()
            items = session.items
            index = session.playbackState?.currentArticleId?.let { id -> items.indexOfFirst { it.articleId == id } } ?: -1
            if (index < 0) errorMessage = "未読の記事がありません。"
            runCatching { ApiClient.getSettings() }.getOrNull()?.let { setLanguage(it.language) }
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
        continuousRead = true
        scope.launch {
            val translated = translateBestEffort(source, extractedLanguage ?: currentItem?.article?.sourceLanguage)
            chunks = split(translated.first)
            extractedLanguage = translated.second
            chunkIndex = 0
            isPlaying = true
            speakChunk()
        }
    }

    fun pause() {
        tts?.stop()
        isPlaying = false
        notifyMedia()
    }

    fun previous() { scope.launch { move(index - 1, true) } }
    fun next() { scope.launch { move(index + 1, true) } }

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

    fun shutdown() {
        pause()
        tts?.shutdown()
        tts = null
        TtsMediaService.onPlayPause = null
        TtsMediaService.onNext = null
        TtsMediaService.onPrev = null
        TtsMediaService.onDismiss = null
        context.stopService(Intent(context, TtsMediaService::class.java))
    }

    private suspend fun move(destination: Int, markCurrentRead: Boolean) {
        if (destination !in items.indices) {
            pause()
            syncProgress(1.0)
            return
        }
        if (markCurrentRead) currentItem?.let { runCatching { ApiClient.setArticleRead(it.articleId, true) } }
        tts?.stop()
        index = destination
        resetPage()
        syncProgress(0.0)
    }

    private fun resetPage() {
        extractedText = null
        extractedLanguage = null
        chunks = emptyList()
        chunkIndex = 0
        isPlaying = false
        autoplayWhenReady = continuousRead
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
        chunkIndex += 1
        if (chunkIndex < chunks.size) {
            syncProgress(chunkIndex.toDouble() / chunks.size)
            speakChunk()
            return
        }
        isPlaying = false
        currentItem?.let { runCatching { ApiClient.setArticleRead(it.articleId, true) } }
        syncProgress(1.0)
        move(index + 1, false)
    }

    private suspend fun syncProgress(position: Double) {
        currentItem?.let {
            runCatching { ApiClient.updatePlaybackState(it.articleId, extractedLanguage ?: it.article.sourceLanguage, position) }
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
            putExtra("title", item.article.title)
            putExtra("playState", if (isPlaying) "playing" else "paused")
            putExtra("chunk", chunkIndex)
            putExtra("total", chunks.size)
            putExtra("hasNext", canNext)
            putExtra("hasPrev", canPrevious)
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
fun ReadingSessionScreen(player: ReadingPlayerController, autoplay: Boolean, onBack: () -> Unit) {
    LaunchedEffect(autoplay) { player.start(autoplay) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(player.currentItem?.article?.title ?: "リーディングリスト", maxLines = 1) },
                navigationIcon = { TextButton(onClick = onBack) { Text("戻る") } },
            )
        },
        bottomBar = { if (player.currentItem != null) ReadingControls(player) },
    ) { padding ->
        when {
            player.isLoading -> Column(
                Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) { CircularProgressIndicator() }
            player.currentItem?.article?.canonicalUrl != null -> ReadingWebView(
                url = player.currentItem!!.article.canonicalUrl!!,
                articleId = player.currentItem!!.articleId,
                onExtracted = player::receiveExtracted,
                onFailure = player::extractionFailed,
                modifier = Modifier.fillMaxSize().padding(padding),
            )
            else -> Column(
                Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) { Text(player.errorMessage ?: "未読の記事がありません。") }
        }
    }
}

@Composable
private fun ReadingControls(player: ReadingPlayerController) {
    var voiceOpen by remember { mutableStateOf(false) }
    var languageOpen by remember { mutableStateOf(false) }
    var rateOpen by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = player::previous, enabled = player.canPrevious) { Text("前へ") }
            Button(onClick = { if (player.isPlaying) player.pause() else player.play() }) {
                Text(if (player.isPlaying) "一時停止" else "読み上げ")
            }
            Button(onClick = player::next, enabled = player.canNext) { Text("次へ") }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("${player.index + 1}/${player.items.size}")
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
    val webView = androidx.compose.runtime.remember(articleId) {
        WebView(context).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            addJavascriptInterface(ReaderBridge(onExtracted, onFailure), "FiloReader")
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, loadedUrl: String) {
                    val readability = context.assets.open("Readability.js").bufferedReader().use { it.readText() }
                    view.evaluateJavascript(
                        "$readability;(() => { const a = new Readability(document.cloneNode(true), {charThreshold:100}).parse();" +
                            "FiloReader.postMessage(JSON.stringify(a && a.textContent && a.textContent.trim().length >= 100" +
                            " ? {text:a.textContent.trim(),lang:a.lang||document.documentElement.lang||null}:{error:true})); })();",
                        null,
                    )
                }
            }
            loadUrl(url)
        }
    }
    DisposableEffect(webView) { onDispose { webView.destroy() } }
    AndroidView(factory = { webView }, modifier = modifier)
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
                if (text.isBlank()) onFailure() else onExtracted(text, json.optString("lang", null))
            }.onFailure { onFailure() }
        }
    }
}
