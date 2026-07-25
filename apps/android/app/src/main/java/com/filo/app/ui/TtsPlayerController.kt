package com.filo.app.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.filo.app.api.ApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

// Device-local TTS queue and playback state, shared across screens.
// Owned by AppNavigation via remember { } so the player survives navigation;
// mirrors iOS's TTSPlayerManager.
class TtsPlayerController(
    context: Context,
    private val scope: CoroutineScope,
) {
    private val prefs = context.getSharedPreferences("filo_tts", Context.MODE_PRIVATE)
    private val speechPlayer = SpeechPlayer(context)
    private var speechJob: Job? = null

    var queue by mutableStateOf<List<TtsQueueItem>>(emptyList())
        private set
    var currentIndex by mutableIntStateOf(-1)
        private set
    var playState by mutableStateOf("idle")
        private set
    var currentChunk by mutableIntStateOf(0)
        private set
    var totalChunks by mutableIntStateOf(0)
        private set
    var speechRate by mutableStateOf(prefs.getFloat("ttsRate", 1.5f))
        private set
    // 言語ごとの読み上げ音声設定 (例: {"ja" to voice name})。未設定なら自動。
    // web の PlayerContext (filo:ttsVoices) と同じ方針でローカル保存する
    var voicePrefs by mutableStateOf(loadVoicePrefs())
        private set

    val rateOptions = listOf(0.75f, 1.0f, 1.25f, 1.5f, 2.0f, 2.5f, 3.0f)

    private fun loadVoicePrefs(): Map<String, String> =
        prefs.all.entries.mapNotNull { (key, value) ->
            if (key.startsWith("ttsVoice_") && value is String) key.removePrefix("ttsVoice_") to value else null
        }.toMap()

    val hasArticle: Boolean get() = queue.isNotEmpty()
    val currentItem: TtsQueueItem? get() = queue.getOrNull(currentIndex)
    val extractionState: String get() = currentItem?.extractionState ?: "idle"
    val articleTitle: String get() = currentItem?.title ?: ""

    // 再生位置のサーバー保存はおよそ10秒間隔に間引く(SPEC/API.md playback-queue/state)
    private val positionSyncIntervalMs = 10_000L
    private var lastPositionSyncAt = 0L

    private fun normalizeUrl(url: String?): String? {
        if (url == null) return null
        return url.substringBefore('#')
    }

    // 読み上げ開始: 既読化 + 再生中記事・言語としてサーバーへ保存
    private fun notifyPlaybackStarted() {
        val item = currentItem ?: return
        val articleId = item.articleId ?: return
        val fraction = if (totalChunks > 0) currentChunk.toDouble() / totalChunks else 0.0
        lastPositionSyncAt = System.currentTimeMillis()
        scope.launch {
            runCatching { ApiClient.setArticleRead(articleId, true) }
            runCatching {
                ApiClient.updatePlaybackState(
                    currentArticleId = articleId,
                    contentLanguage = item.lang,
                    positionPercent = fraction,
                )
            }
        }
    }

    private fun syncPositionIfNeeded(force: Boolean = false) {
        val articleId = currentItem?.articleId ?: return
        if (totalChunks <= 0) return
        val now = System.currentTimeMillis()
        if (!force && now - lastPositionSyncAt < positionSyncIntervalMs) return
        lastPositionSyncAt = now
        val fraction = (currentChunk.toDouble() / totalChunks).coerceIn(0.0, 1.0)
        scope.launch {
            runCatching { ApiClient.updatePlaybackState(positionPercent = fraction) }
        }
    }

    // ローカル追加をサーバー playback-queue へ反映する(記事解決は URL lookup)
    private fun pushAddedItemToServer(url: String) {
        scope.launch {
            val lookup = runCatching { ApiClient.lookupArticle(url) }.getOrNull() ?: return@launch
            if (!lookup.inQueue) {
                runCatching { ApiClient.addPlaybackQueueItems(listOf(lookup.id)) }
                // 音読キュー追加時に必要な範囲で本文を取得・解決する(他端末の連続再生用)
                runCatching { ApiClient.requestArticleContent(lookup.id) }
            }
            val index = queue.indexOfFirst { it.url == url }
            if (index >= 0) {
                queue = queue.toMutableList().also { it[index] = it[index].copy(articleId = lookup.id) }
            }
        }
    }

    // サーバー共有キューの取り込み: 他端末(Web / iOS / Extension)で追加された記事を
    // ローカルキューへ反映し、サーバー側で消えた項目を取り除く。
    suspend fun syncWithServer() {
        val data = runCatching { ApiClient.getPlaybackQueue() }.getOrNull() ?: return

        // URL 一致でローカル項目に articleId を付与する
        val byUrl = data.items
            .mapNotNull { entry -> normalizeUrl(entry.canonicalUrl)?.let { it to entry.articleId } }
            .toMap()
        queue = queue.map { item ->
            if (item.articleId == null) {
                byUrl[normalizeUrl(item.url)]?.let { item.copy(articleId = it) } ?: item
            } else {
                item
            }
        }

        // 停止中のみ削除・並び替えを適用する(再生中はローカルを優先)
        val serverIds = data.items.map { it.articleId }.toSet()
        if (playState != "playing") {
            val currentId = currentItem?.id
            queue = queue.filter { it.articleId == null || serverIds.contains(it.articleId) }
            currentIndex = when {
                currentId != null -> queue.indexOfFirst { it.id == currentId }.takeIf { it >= 0 } ?: if (queue.isEmpty()) -1 else 0
                queue.isEmpty() -> -1
                else -> currentIndex.coerceIn(0, queue.size - 1)
            }
        }

        // サーバーにあってローカルにない記事は本文を取得して追加する
        for (entry in data.items) {
            if (queue.any { it.articleId == entry.articleId }) continue
            val speech = fetchSpeechText(entry.articleId) ?: continue
            queue = queue + TtsQueueItem(
                url = entry.canonicalUrl ?: "",
                title = entry.title,
                extractionState = "ready",
                chunks = splitIntoChunks(cleanTextForSpeech(speech.first)),
                lang = speech.second,
                articleId = entry.articleId,
            )
            if (currentIndex < 0) currentIndex = 0
        }

        if (playState != "playing") {
            // サーバーの並び順を優先し、サーバー未同期のローカル項目は末尾に置く
            val orderMap = data.items.withIndex().associate { it.value.articleId to it.index }
            val currentId = currentItem?.id
            queue = queue.withIndex()
                .sortedWith(compareBy({ it.value.articleId?.let { id -> orderMap[id] } ?: Int.MAX_VALUE }, { it.index }))
                .map { it.value }
            currentId?.let { id ->
                queue.indexOfFirst { it.id == id }.takeIf { it >= 0 }?.let { currentIndex = it }
            }

            // サーバー保存の再生位置から再開できるようにする
            val state = data.playbackState
            val currentArticleId = state?.currentArticleId
            if (currentArticleId != null) {
                val index = queue.indexOfFirst { it.articleId == currentArticleId }
                if (index >= 0) {
                    currentIndex = index
                    val item = queue[index]
                    if (item.extractionState == "ready" && item.chunks.isNotEmpty()) {
                        totalChunks = item.chunks.size
                        currentChunk = (state.positionPercent * item.chunks.size).toInt()
                            .coerceIn(0, item.chunks.size - 1)
                    }
                }
            }
        }
    }

    // 読み上げ対象本文の解決: 抽出本文 > RSS本文。本文翻訳は扱わない(プラットフォーム翻訳に委ねる)
    private suspend fun fetchSpeechText(articleId: Int): Pair<String, String?>? {
        val content = runCatching { ApiClient.getArticleContent(articleId) }.getOrNull()
        if (content != null && content.status == "ready") {
            val text = content.text ?: content.html
            if (text != null) return text to content.sourceLanguage
        }
        val detail = runCatching { ApiClient.getArticle(articleId) }.getOrNull() ?: return null
        val raw = detail.rssContentHtml ?: detail.rssSummary ?: return null
        return raw to detail.sourceLanguage
    }

    fun stop() {
        speechJob?.cancel()
        speechPlayer.stop()
        playState = "idle"
    }

    fun dismiss() {
        stop()
        queue = emptyList()
        currentIndex = -1
        currentChunk = 0
        totalChunks = 0
    }

    // 「すべて削除」: ローカルとサーバーの両方のキューを空にする
    fun clearAll() {
        dismiss()
        scope.launch { runCatching { ApiClient.clearPlaybackQueue() } }
    }

    fun pause() {
        speechJob?.cancel()
        speechPlayer.stop()
        playState = "paused"
        syncPositionIfNeeded(force = true)
    }

    private fun speakFrom(startIndex: Int, chunks: List<String>) {
        val lang = currentItem?.lang
        playState = "playing"
        speechJob = scope.launch {
            for (i in startIndex until chunks.size) {
                if (playState != "playing") break
                currentChunk = i
                syncPositionIfNeeded()
                speechPlayer.speak(chunks[i], lang, speechRate, voicePrefs[voiceLangKey(lang)])
            }
            if (playState == "playing") {
                // 読み上げ完了した記事はキュー(サーバー含む)から取り除き、次の記事へ進む
                val finished = currentItem
                if (finished != null) {
                    finished.articleId?.let { id ->
                        scope.launch { runCatching { ApiClient.removePlaybackQueueItem(id) } }
                    }
                    queue = queue.toMutableList().also { it.removeAt(currentIndex) }
                }
                if (currentIndex >= queue.size) {
                    playState = "idle"
                    currentChunk = 0
                    totalChunks = 0
                    currentIndex = if (queue.isEmpty()) -1 else queue.size - 1
                    scope.launch {
                        runCatching { ApiClient.updatePlaybackState(clearCurrentArticle = true, positionPercent = 0.0) }
                    }
                    return@launch
                }
                val nextItem = queue[currentIndex]
                if (nextItem.extractionState == "ready" && nextItem.chunks.isNotEmpty()) {
                    totalChunks = nextItem.chunks.size
                    currentChunk = 0
                    notifyPlaybackStarted()
                    speakFrom(0, nextItem.chunks)
                } else {
                    playState = "idle"
                }
            }
        }
    }

    fun playPause() {
        val item = currentItem ?: return
        if (item.extractionState != "ready" || item.chunks.isEmpty()) return
        when (playState) {
            "playing" -> pause()
            "paused" -> speakFrom(currentChunk, item.chunks)
            else -> {
                totalChunks = item.chunks.size
                // サーバー保存の再生位置(currentChunk)があれば続きから読む
                if (currentChunk >= item.chunks.size) currentChunk = 0
                val start = currentChunk
                speakFrom(start, item.chunks)
                notifyPlaybackStarted()
            }
        }
    }

    fun markArticleActive(url: String, title: String) {
        if (queue.any { it.url == url }) return
        queue = queue + TtsQueueItem(url = url, title = title)
        if (currentIndex < 0) currentIndex = 0
        pushAddedItemToServer(url)
    }

    fun isQueued(articleId: Int): Boolean = queue.any { it.articleId == articleId }

    // 記事一覧からの「音読キューへ追加」。サーバーへ追加してから本文を解決する。
    fun addToQueue(articleId: Int, title: String, url: String?) {
        if (isQueued(articleId)) return
        queue = queue + TtsQueueItem(url = url ?: "", title = title, articleId = articleId)
        if (currentIndex < 0) currentIndex = 0
        scope.launch {
            runCatching { ApiClient.addPlaybackQueueItems(listOf(articleId)) }
            // 音読キュー追加時に必要な範囲で本文を取得・解決する(CONCEPT.md 読み上げ方針)
            runCatching { ApiClient.requestArticleContent(articleId) }
            val speech = fetchSpeechText(articleId)
            val index = queue.indexOfFirst { it.articleId == articleId }
            if (index < 0) return@launch
            queue = queue.toMutableList().also {
                it[index] = if (speech != null) {
                    it[index].copy(
                        extractionState = "ready",
                        chunks = splitIntoChunks(cleanTextForSpeech(speech.first)),
                        lang = speech.second,
                    )
                } else {
                    it[index].copy(extractionState = "failed")
                }
            }
            if (index == currentIndex && playState == "idle") {
                totalChunks = queue[index].chunks.size
                currentChunk = 0
            }
        }
    }

    fun removeArticleFromQueue(articleId: Int) {
        val index = queue.indexOfFirst { it.articleId == articleId }
        if (index >= 0) removeFromQueue(index)
    }

    // キュー内の並び替え。全項目がサーバー同期済みのときだけ順序を送る(PUT order は全件一致が必要)。
    fun moveInQueue(index: Int, direction: Int) {
        val target = index + direction
        if (index < 0 || index >= queue.size || target < 0 || target >= queue.size) return
        val currentId = currentItem?.id
        queue = queue.toMutableList().also {
            val item = it.removeAt(index)
            it.add(target, item)
        }
        currentId?.let { id ->
            queue.indexOfFirst { it.id == id }.takeIf { it >= 0 }?.let { currentIndex = it }
        }
        val articleIds = queue.mapNotNull { it.articleId }
        if (articleIds.size == queue.size && articleIds.isNotEmpty()) {
            scope.launch { runCatching { ApiClient.reorderPlaybackQueue(articleIds) } }
        }
    }

    fun markExtractionFailed(url: String) {
        val index = queue.indexOfFirst { it.url == url }
        if (index < 0) return
        if (queue[index].extractionState != "loading") return
        queue = queue.toMutableList().also {
            it[index] = it[index].copy(extractionState = "failed")
        }
    }

    fun prepareArticle(url: String, text: String, lang: String?) {
        val index = queue.indexOfFirst { it.url == url }
        if (index < 0) return
        if (queue[index].chunks.isNotEmpty()) return
        val chunks = splitIntoChunks(cleanTextForSpeech(text))
        queue = queue.toMutableList().also {
            it[index] = it[index].copy(extractionState = "ready", chunks = chunks, lang = lang)
        }
        if (index == currentIndex) {
            totalChunks = chunks.size
            currentChunk = 0
        }
    }

    fun skipTo(index: Int) {
        if (index < 0 || index >= queue.size) return
        stop()
        currentIndex = index
        val item = queue[index]
        if (item.extractionState == "ready" && item.chunks.isNotEmpty()) {
            totalChunks = item.chunks.size
            currentChunk = 0
            speakFrom(0, item.chunks)
            notifyPlaybackStarted()
        } else {
            totalChunks = 0
            currentChunk = 0
        }
    }

    fun removeFromQueue(index: Int) {
        if (index < 0 || index >= queue.size) return
        queue[index].articleId?.let { id ->
            scope.launch { runCatching { ApiClient.removePlaybackQueueItem(id) } }
        }
        if (index == currentIndex) {
            stop()
            queue = queue.toMutableList().also { it.removeAt(index) }
            if (queue.isEmpty()) {
                currentIndex = -1
                currentChunk = 0
                totalChunks = 0
            } else {
                currentIndex = minOf(index, queue.size - 1)
                val item = currentItem
                if (item != null && item.extractionState == "ready") {
                    totalChunks = item.chunks.size
                    currentChunk = 0
                } else {
                    totalChunks = 0
                    currentChunk = 0
                }
            }
        } else {
            queue = queue.toMutableList().also { it.removeAt(index) }
            if (index < currentIndex) currentIndex -= 1
        }
    }

    fun cycleRate() {
        val idx = rateOptions.indexOf(speechRate).takeIf { it >= 0 } ?: 0
        val newRate = rateOptions[(idx + 1) % rateOptions.size]
        speechRate = newRate
        prefs.edit().putFloat("ttsRate", newRate).apply()
        if (playState == "playing") {
            val item = currentItem
            if (item != null && item.chunks.isNotEmpty()) {
                pause()
                speakFrom(currentChunk, item.chunks)
            }
        }
    }

    fun voiceLangKey(lang: String?): String = (lang ?: "ja").take(2).lowercase()

    fun voiceOptions(lang: String?) = speechPlayer.voiceOptions(lang)

    // voiceName が null なら「自動(デフォルト音声)」に戻す
    fun setVoice(lang: String?, voiceName: String?) {
        val key = voiceLangKey(lang)
        voicePrefs = if (voiceName != null) voicePrefs + (key to voiceName) else voicePrefs - key
        prefs.edit().apply {
            if (voiceName != null) putString("ttsVoice_$key", voiceName) else remove("ttsVoice_$key")
        }.apply()
        if (playState == "playing") {
            val item = currentItem
            if (item != null && item.chunks.isNotEmpty()) {
                pause()
                speakFrom(currentChunk, item.chunks)
            }
        }
    }

    fun shutdown() {
        speechJob?.cancel()
        speechPlayer.shutdown()
    }
}
