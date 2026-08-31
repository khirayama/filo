package com.filo.app.ui

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.filo.app.api.ArticleListItem
import com.filo.app.api.Subscription
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.android.gms.tasks.Task
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

// 一覧タイトルの端末内翻訳 (SPEC/APP.md)
//
// ML Kit の Translation だけを使い、翻訳エンジンは自前で持たない。翻訳結果はサーバーへ
// 保存しない。手動トグルでのみ起動し、言語判定による自動翻訳は行わない。
//
// **原文言語の判定はサーバーが行う**(apps/api/src/lib/languageDetect.ts)。フィード全体を
// 連結した長文とフィード言語を事前確率にして決めており、端末側の短いタイトル 1 本より
// 材料が多い。判定器を端末ごとに持つと挙動が揃わないので、ここでは
// `article.sourceLanguage` をそのまま使う。
//
// iOS の TitleTranslation.swift と Web の titleTranslator.ts が同じ役割を担う。
// 片方だけ直すとプラットフォーム間で挙動がずれるので、必ず全部を更新する。

private const val PREFS_NAME = "filo.titleTranslation"
private const val ENABLED_KEY = "enabled"

// 言語ペアの準備状況。翻訳が動かないときに原因が見えるようにする
data class TitleTranslationLanguage(
    val code: String,
    val status: Status,
) {
    enum class Status { INSTALLED, DOWNLOADABLE, UNSUPPORTED }

    val displayName: String
        get() = java.util.Locale.forLanguageTag(code).getDisplayLanguage(java.util.Locale.getDefault())
            .ifBlank { code }
}

class TitleTranslationStore(private val context: Context, private val scope: CoroutineScope) {
    // 翻訳が届いた分から順に差し替わる。セッション内だけのキャッシュで、永続化しない。
    private val titles = mutableStateMapOf<Int, String>()
    var isEnabled by mutableStateOf(prefs().getBoolean(ENABLED_KEY, true))
        private set
    var isTranslating by mutableStateOf(false)
        private set

    // 同じ記事を二度投げないための記録
    private val requested = mutableSetOf<Int>()
    private var target = "ja"
    private var readableLanguages = listOf("ja")
    private var job: Job? = null

    // 準備画面（オンボーディング）の状態
    var isShowingSetup by mutableStateOf(false)
    var languages by mutableStateOf<List<TitleTranslationLanguage>>(emptyList())
        private set
    var hasCheckedLanguages by mutableStateOf(false)
        private set
    var preparing by mutableStateOf<String?>(null)
        private set

    // Web/iOS と同じく、端末で利用可能な翻訳候補がない場合は一覧の
    // 翻訳トグル自体を表示しない。初回確認前だけは、確認を開始できるよう表示する。
    val isSupported: Boolean
        get() = !hasCheckedLanguages && candidates.value.isNotEmpty() ||
            languages.any { it.status != TitleTranslationLanguage.Status.UNSUPPORTED }

    // 候補は「購読に実在する言語」。訳す必要がない言語は除く
    private val candidates = mutableStateOf<List<String>>(emptyList())

    fun titleFor(articleId: Int): String? = titles[articleId]

    // MARK: 準備（オンボーディング）

    fun setCandidates(subscriptions: List<Subscription>) {
        candidates.value = subscriptions
            .mapNotNull { it.feed.language }
            .distinct()
            .filter { code ->
                val base = code.substringBefore('-')
                base != target.substringBefore('-') && !readableLanguages.contains(base)
            }
            .sorted()
    }

    // 取得済みモデルを OS へ問い合わせる。ML Kit は言語ごとにモデルを持ち、
    // 英語を経由して翻訳するので、原文言語と表示言語の両方が要る。
    suspend fun refreshLanguages() {
        val downloaded = runCatching {
            RemoteModelManager.getInstance()
                .getDownloadedModels(TranslateRemoteModel::class.java)
                .await()
                ?.mapNotNull { it.language }
                ?: emptyList()
        }.getOrDefault(emptyList())

        val targetTag = TranslateLanguage.fromLanguageTag(target)
        val targetReady = targetTag != null && downloaded.contains(targetTag)

        languages = candidates.value.map { code ->
            val tag = TranslateLanguage.fromLanguageTag(code)
            val status = when {
                tag == null -> TitleTranslationLanguage.Status.UNSUPPORTED
                targetTag == null -> TitleTranslationLanguage.Status.UNSUPPORTED
                downloaded.contains(tag) && targetReady -> TitleTranslationLanguage.Status.INSTALLED
                else -> TitleTranslationLanguage.Status.DOWNLOADABLE
            }
            TitleTranslationLanguage(code, status)
        }
        hasCheckedLanguages = true
    }

    // 言語モデルを取得する。一覧のスクロール中ではなく準備画面の明示操作から呼ぶ
    fun prepare(code: String) {
        if (preparing != null) return
        val source = TranslateLanguage.fromLanguageTag(code) ?: return
        val targetLanguage = TranslateLanguage.fromLanguageTag(target) ?: return
        preparing = code
        scope.launch {
            val translator = Translation.getClient(
                TranslatorOptions.Builder()
                    .setSourceLanguage(source)
                    .setTargetLanguage(targetLanguage)
                    .build(),
            )
            try {
                translator.downloadModelIfNeeded(DownloadConditions.Builder().build()).await()
            } catch (_: Exception) {
                // 取得できなければ状態は変わらない。理由は準備画面の表示から分かる
            } finally {
                translator.close()
                refreshLanguages()
                preparing = null
            }
        }
    }

    fun toggle() {
        isEnabled = !isEnabled
        prefs().edit().putBoolean(ENABLED_KEY, isEnabled).apply()
        if (!isEnabled) {
            reset()
            return
        }
        // ON にした時点で準備状況を確かめ、1 つも使えないなら準備画面へ誘導する。
        // 一覧をスクロールしている最中にモデル取得が始まるのを避ける。
        scope.launch {
            refreshLanguages()
            if (languages.none { it.status == TitleTranslationLanguage.Status.INSTALLED }) {
                isShowingSetup = true
            }
        }
    }

    // 表示言語と「原文のまま読む言語」を反映する。表示言語が変われば翻訳結果は使えない。
    fun configure(language: String, readable: List<String>) {
        val readableChanged = readable != readableLanguages
        val languageChanged = language != target
        if (!readableChanged && !languageChanged) return
        readableLanguages = readable
        if (languageChanged) target = language
        reset()
    }

    // 表示中の記事を翻訳対象として登録する。トグル ON の間はスクロールで増えた分も翻訳する。
    fun register(articles: List<ArticleListItem>) {
        if (!isEnabled) return
        val fresh = articles.filter { requested.add(it.id) && it.title.isNotBlank() }
        if (fresh.isEmpty()) return
        // 翻訳は 1 本ずつ直列に流す。何度呼ばれても順番待ちになるだけ。
        val previous = job
        job = scope.launch {
            previous?.join()
            isTranslating = true
            try {
                translate(fresh)
            } finally {
                isTranslating = false
            }
        }
    }

    private suspend fun translate(articles: List<ArticleListItem>) {
        val targetLanguage = TranslateLanguage.fromLanguageTag(target) ?: return
        val downloaded = runCatching {
            RemoteModelManager.getInstance()
                .getDownloadedModels(TranslateRemoteModel::class.java)
                .await()
                ?.mapNotNull { it.language }
                ?.toSet()
                ?: emptySet()
        }.getOrDefault(emptySet())
        // ML Kit の translator は言語ペアごとなので、原文言語でまとめる
        val bySource = mutableMapOf<String, MutableList<ArticleListItem>>()
        for (article in articles) {
            // 原文言語はサーバーが決めている。不明な記事は原文のまま出す
            val source = article.sourceLanguage ?: continue
            // 読める言語の記事は原文のまま出す(SPEC/DATABASE.md の表示規則と同じ)
            val base = source.substringBefore('-')
            if (base == target.substringBefore('-') || readableLanguages.contains(base)) continue
            bySource.getOrPut(source) { mutableListOf() }.add(article)
        }

        for ((source, items) in bySource) {
            val sourceLanguage = TranslateLanguage.fromLanguageTag(source) ?: continue
            // モデル取得は設定の「翻訳の準備」だけで行う。一覧表示中は、準備できて
            // いない言語ペアを原文のまま残し、準備完了後に再登録できるようにする。
            if (!downloaded.contains(sourceLanguage) || !downloaded.contains(targetLanguage)) {
                requested.removeAll(items.map { it.id }.toSet())
                continue
            }
            val translator = Translation.getClient(
                TranslatorOptions.Builder()
                    .setSourceLanguage(sourceLanguage)
                    .setTargetLanguage(targetLanguage)
                    .build(),
            )
            try {
                for (article in items) {
                    // 翻訳できなかったタイトルは原文のまま残す
                    val translated = runCatching { translator.translate(article.title).await() }.getOrNull()
                    if (!translated.isNullOrBlank()) titles[article.id] = translated
                }
            } catch (_: Exception) {
                // この言語ペアは原文のまま残す
            } finally {
                translator.close()
            }
        }
    }

    private fun reset() {
        job?.cancel()
        job = null
        titles.clear()
        requested.clear()
        isTranslating = false
    }

    private fun prefs() = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}

private suspend fun <T> Task<T>.await(): T? = suspendCancellableCoroutine { cont ->
    addOnSuccessListener { cont.resume(it) }
    addOnFailureListener { cont.resumeWithException(it) }
}

// 一覧のツールバーに置く翻訳トグル
@Composable
fun TitleTranslationToggle(store: TitleTranslationStore) {
    if (!store.isSupported) return
    IconButton(onClick = { store.toggle() }) {
        FiloIcon(
            FiloIconName.Translate,
            contentDescription = tr(if (store.isEnabled) "原文タイトルに戻す" else "タイトルを翻訳"),
            tint = if (store.isEnabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
        )
    }
}

// 準備画面（オンボーディング）
//
// 端末内翻訳は言語モデルの取得が要る。取得を一覧のスクロール中に暗黙で走らせると、
// 通信が不意に始まるうえ、失敗しても理由が分からない。ここで言語ごとの状態を見せ、
// 明示的に取得させる。
//
// iOS の TitleTranslationSetupView / Web の TitleTranslationSetup と同じ役割。
// 片方だけ直すとプラットフォーム間で挙動がずれるので、必ず全部を更新する。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TitleTranslationSetupSheet(store: TitleTranslationStore, onDismiss: () -> Unit) {
    LaunchedEffect(Unit) { store.refreshLanguages() }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(tr("翻訳の準備"), style = MaterialTheme.typography.titleMedium)
            Text(
                tr("タイトルの翻訳はこの端末の中で行います。はじめに、翻訳したい言語をダウンロードしてください。ダウンロードは Wi-Fi 接続時をおすすめします。"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (!store.hasCheckedLanguages) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp))
                    Text(tr("確認しています…"), style = MaterialTheme.typography.bodySmall)
                }
            } else if (store.languages.isEmpty()) {
                Text(
                    tr("購読しているフィードに、翻訳が必要な言語はありません。"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                store.languages.forEach { language ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(AppStrings.languageName(language.code))
                        when (language.status) {
                            TitleTranslationLanguage.Status.INSTALLED ->
                                Text(
                                    tr("準備済み"),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            TitleTranslationLanguage.Status.DOWNLOADABLE ->
                                TextButton(
                                    enabled = store.preparing == null,
                                    onClick = { store.prepare(language.code) },
                                ) {
                                    Text(if (store.preparing == language.code) tr("ダウンロード中…") else tr("ダウンロード"))
                                }
                            TitleTranslationLanguage.Status.UNSUPPORTED ->
                                Text(
                                    tr("この端末では非対応"),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                        }
                    }
                    HorizontalDivider()
                }
            }

            Text(
                tr("ここに無い言語の記事は、翻訳せず原文のまま表示します。"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
