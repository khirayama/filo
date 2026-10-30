package com.filo.app.ui

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Locale

private data class ArticleUrlKey(val host: String, val port: Int, val path: String, val query: List<Pair<String, String>>)

private fun articleUrlKey(value: String): ArticleUrlKey? = runCatching {
    val uri = URI(value)
    val scheme = uri.scheme?.lowercase(Locale.ROOT)
    if (scheme != "http" && scheme != "https") return null
    val host = uri.host?.lowercase(Locale.ROOT) ?: return null
    val port = if ((scheme == "http" && uri.port == 80) || uri.port == 443) -1 else uri.port
    val path = (uri.rawPath.takeUnless { it.isNullOrEmpty() } ?: "/").let { if (it.length > 1) it.trimEnd('/').ifEmpty { "/" } else it }
    val tracking = Regex("^(utm_|fbclid$|gclid$|yclid$|mc_cid$|mc_eid$)", RegexOption.IGNORE_CASE)
    val query = uri.rawQuery?.split('&')?.filter { it.isNotEmpty() }?.map { entry ->
        val parts = entry.split('=', limit = 2)
        URLDecoder.decode(parts[0], StandardCharsets.UTF_8.name()) to URLDecoder.decode(parts.getOrElse(1) { "" }, StandardCharsets.UTF_8.name())
    }?.filterNot { tracking.containsMatchIn(it.first) } ?: emptyList()
    ArticleUrlKey(host, port, path, query)
}.getOrNull()

internal fun sameArticleUrl(first: String?, second: String?): Boolean {
    if (first == null || second == null) return false
    val key = articleUrlKey(first) ?: return false
    return key == articleUrlKey(second)
}

// Keep the reading-list snapshot separate from the page currently in the WebView.
internal class ReadingPageTracker {
    var url: String? = null
        private set
    var sessionUrl: String? = null
        private set
    var version: Int = 0
        private set
    private val articles = mutableMapOf<String, Int>()

    private fun key(value: String) = value.substringBefore('#')
    val articleId: Int? get() = url?.let { articles[key(it)] }?.takeIf { it > 0 }
    val isSessionPage: Boolean get() = url?.let(::key) == sessionUrl && sessionUrl != null

    fun loading() { url = null; version += 1 }

    fun loaded(value: String?, initialArticleId: Int?) {
        url = value?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
        if (sessionUrl == null && url != null) {
            sessionUrl = key(url!!)
            initialArticleId?.takeIf { it > 0 }?.let { articles[sessionUrl!!] = it }
        }
    }

    fun saved(value: String, expectedVersion: Int, articleId: Int): Boolean {
        articles[key(value)] = articleId
        if (url != value || version != expectedVersion) return false
        return true
    }

    fun reset() { loading(); sessionUrl = null; articles.clear() }
}
