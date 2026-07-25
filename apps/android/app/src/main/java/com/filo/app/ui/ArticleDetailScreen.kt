package com.filo.app.ui

import android.content.Intent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.filo.app.api.ApiClient
import com.filo.app.api.ApiException
import com.filo.app.api.ArticleDetail
import com.filo.app.api.ErrorMessages
import kotlinx.coroutines.launch

// 記事リーディング画面 (SPEC/SCREENS.md): 実際の Web ページを開いた状態で読む。
// 目的は読む・元記事を開く・音読・キュー追加に絞り、
// RSS 本文 / 抽出本文 / 翻訳本文を切り替える画面にはしない。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleReadingScreen(
    articleId: Int,
    onBack: () -> Unit,
    onArticleLoaded: (url: String?, title: String) -> Unit,
    onTextExtracted: (text: String, lang: String?) -> Unit,
    onExtractionFailed: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var article by remember { mutableStateOf<ArticleDetail?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var isGone by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var showOriginalTitle by remember { mutableStateOf(false) }

    suspend fun load() {
        isLoading = true
        errorMessage = null
        try {
            val loaded = ApiClient.getArticle(articleId)
            article = loaded
            onArticleLoaded(loaded.canonicalUrl, loaded.title)
        } catch (e: ApiException) {
            if (e.status == 404) isGone = true else errorMessage = ErrorMessages.forError(e)
        } catch (e: Exception) {
            errorMessage = ErrorMessages.forError(e)
        }
        isLoading = false
    }

    LaunchedEffect(articleId) { load() }

    fun patchState(isRead: Boolean? = null, inReadingList: Boolean? = null, isBookmarked: Boolean? = null) {
        val current = article ?: return
        scope.launch {
            try {
                val state = when {
                    isRead != null -> ApiClient.setArticleRead(current.id, isRead)
                    inReadingList != null -> ApiClient.setReadingListMembership(current.id, inReadingList)
                    isBookmarked != null -> ApiClient.setBookmarkMembership(current.id, isBookmarked)
                    else -> return@launch
                }
                article = current.copy(userState = state)
            } catch (e: Exception) {
                errorMessage = ErrorMessages.forError(e)
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "戻る")
                    }
                },
                actions = {
                    article?.let { a ->
                        IconButton(onClick = { patchState(isRead = !a.userState.isRead) }) {
                            Icon(
                                if (a.userState.isRead) Icons.Default.CheckCircle else Icons.Outlined.CheckCircle,
                                contentDescription = if (a.userState.isRead) "未読にする" else "既読にする",
                            )
                        }
                        IconButton(onClick = { patchState(inReadingList = !a.userState.inReadingList) }) {
                            Icon(
                                if (a.userState.inReadingList) Icons.Default.Bookmark else Icons.Default.BookmarkBorder,
                                contentDescription = if (a.userState.inReadingList) "リーディングリストから削除" else "リーディングリストに追加",
                            )
                        }
                        IconButton(onClick = { patchState(isBookmarked = !a.userState.isBookmarked) }) {
                            Icon(
                                if (a.userState.isBookmarked) Icons.Default.Star else Icons.Default.StarBorder,
                                contentDescription = if (a.userState.isBookmarked) "ブックマークを解除" else "ブックマーク",
                                tint = if (a.userState.isBookmarked) Color(0xFFE8A100) else MaterialTheme.colorScheme.onSurface,
                            )
                        }
                        if (a.canonicalUrl != null) {
                            IconButton(onClick = {
                                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, a.canonicalUrl.toUri())) }
                            }) {
                                Icon(Icons.Default.OpenInBrowser, contentDescription = "ブラウザで開く")
                            }
                        }
                    }
                },
            )
        },
    ) { innerPadding ->
        if (isGone) {
            Column(
                modifier = Modifier.fillMaxSize().padding(innerPadding).padding(40.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("この記事は削除されたか、表示できません。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = onBack) { Text("戻る") }
            }
            return@Scaffold
        }
        if (isLoading) {
            Column(
                modifier = Modifier.fillMaxSize().padding(innerPadding).padding(40.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) { CircularProgressIndicator() }
            return@Scaffold
        }
        val a = article ?: run {
            Column(modifier = Modifier.fillMaxSize().padding(innerPadding).padding(16.dp)) {
                errorMessage?.let { ErrorBanner(it) { scope.launch { load() } } }
            }
            return@Scaffold
        }

        val isTranslatedTitle = a.translatedTitle != null
        val displayTitle = if (showOriginalTitle || !isTranslatedTitle) a.title else a.translatedTitle!!

        Column(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    FaviconImage(url = a.feedFaviconUrl, siteUrl = a.feedSiteUrl)
                    Text(
                        a.feedTitle ?: "",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        relativeTime(a.publishedAt ?: a.fetchedAt),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    a.author?.let {
                        Text(
                            it,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        displayTitle,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (isTranslatedTitle) {
                        Surface(
                            onClick = { showOriginalTitle = !showOriginalTitle },
                            shape = MaterialTheme.shapes.extraSmall,
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)),
                            color = Color.Transparent,
                        ) {
                            Text(
                                if (showOriginalTitle) "翻訳" else "原文",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                            )
                        }
                    }
                }
                errorMessage?.let { ErrorBanner(it) { scope.launch { load() } } }
            }

            HorizontalDivider()

            if (a.canonicalUrl != null) {
                ReaderWebView(
                    url = a.canonicalUrl,
                    onTextExtracted = onTextExtracted,
                    onExtractionFailed = onExtractionFailed,
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                Column(
                    modifier = Modifier.fillMaxSize().padding(40.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("この記事には元記事の URL がありません。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
