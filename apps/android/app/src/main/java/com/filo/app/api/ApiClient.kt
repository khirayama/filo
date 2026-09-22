package com.filo.app.api

import com.filo.app.BuildConfig
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

class ApiException(val status: Int, val code: String) : Exception(code) {
    companion object {
        val NETWORK = { ApiException(0, "network_error") }
    }
}

object ApiClient {
    private val baseUrl = BuildConfig.API_BASE_URL.trimEnd('/')
    private const val SHELL_CACHE_MS = 30_000L
    private const val ARTICLE_CACHE_MS = 5_000L
    private const val UNREAD_CACHE_MS = 10_000L

    private data class CacheEntry<T>(val value: T, val expiresAt: Long)
    private var cacheTokenMarker: String? = null
    private var cacheGeneration = 0
    private var bootstrapCache: CacheEntry<BootstrapData>? = null
    private var unreadCountsCache: CacheEntry<UnreadCounts>? = null
    private var statusCache: CacheEntry<StatusOverview>? = null
    private val articleCache = mutableMapOf<String, CacheEntry<ArticlePage>>()
    private val inFlight = mutableMapOf<String, Deferred<Any>>()
    private val cacheScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private suspend fun token(): String? {
        return com.filo.app.SecureTokenStore.get()
    }

    private suspend fun prepareCache() {
        val marker = token()?.let { "${it.length}:${it.take(16)}" }
        synchronized(this) {
            if (cacheTokenMarker != marker) {
                cacheTokenMarker = marker
                cacheGeneration += 1
                bootstrapCache = null
                unreadCountsCache = null
                statusCache = null
                articleCache.clear()
                inFlight.clear()
            }
        }
    }

    private fun invalidateCache() {
        synchronized(this) {
            cacheGeneration += 1
            bootstrapCache = null
            unreadCountsCache = null
            statusCache = null
            articleCache.clear()
            inFlight.clear()
        }
    }

    private suspend fun <T> cached(
        key: String,
        ttlMs: Long,
        read: () -> CacheEntry<T>?,
        write: (CacheEntry<T>) -> Unit,
        loader: suspend () -> T,
    ): T {
        prepareCache()
        val now = System.currentTimeMillis()
        synchronized(this) {
            read()?.takeIf { it.expiresAt > now }?.let { return it.value }
        }
        val generation: Int
        val pending: Deferred<Any>
        var owner = false
        synchronized(this) {
            generation = cacheGeneration
            pending = inFlight[key] ?: cacheScope.async(start = CoroutineStart.LAZY) {
                loader() as Any
            }.also {
                inFlight[key] = it
                owner = true
            }
        }
        return try {
            @Suppress("UNCHECKED_CAST")
            val value = pending.await() as T
            synchronized(this) {
                if (owner && inFlight[key] === pending) {
                    inFlight.remove(key)
                    if (cacheGeneration == generation) {
                        write(CacheEntry(value, System.currentTimeMillis() + ttlMs))
                    }
                }
            }
            value
        } catch (error: Throwable) {
            synchronized(this) {
                if (owner && inFlight[key] === pending) inFlight.remove(key)
            }
            throw error
        }
    }

    private suspend fun request(
        method: String,
        path: String,
        body: ByteArray? = null,
        contentType: String = "application/json",
        authorized: Boolean = true,
    ): String = withContext(Dispatchers.IO) {
        val jwt = if (authorized) token() else null
        val connection = (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 30_000
            useCaches = false
            if (jwt != null) setRequestProperty("Authorization", "Bearer $jwt")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", contentType)
            }
        }
        try {
            if (body != null) {
                connection.outputStream.use { it.write(body) }
            }
            val status = connection.responseCode
            val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: ""
            if (status !in 200..299) {
                val code = runCatching {
                    JSONObject(text).getJSONObject("error").getString("code")
                }.getOrDefault("internal_error")
                throw ApiException(status, code)
            }
            text
        } catch (e: ApiException) {
            throw e
        } catch (e: Exception) {
            throw ApiException(0, "network_error")
        } finally {
            connection.disconnect()
        }
    }

    private suspend fun getData(path: String): JSONObject = JSONObject(request("GET", path)).getJSONObject("data")

    private suspend fun getList(path: String): Pair<JSONArray, String?> {
        val json = JSONObject(request("GET", path))
        val meta = json.optJSONObject("meta")
        return json.getJSONArray("data") to meta?.optStringOrNull("nextCursor")
    }

    private suspend fun sendJson(method: String, path: String, body: JSONObject? = null): String =
        request(method, path, body?.toString()?.toByteArray(Charsets.UTF_8))

    // Status

    suspend fun getStatus(): StatusOverview = cached("status", 3_000L, { statusCache }, { statusCache = it }) {
        parseStatusOverview(getData("/api/v1/status"))
    }

    suspend fun refreshFeeds(force: Boolean = false): RefreshResult {
        val body = JSONObject().put("force", force)
        return parseRefreshResult(JSONObject(sendJson("POST", "/api/v1/status/refresh", body)).getJSONObject("data"))
            .also { invalidateCache() }
    }

    suspend fun refreshFeed(feedId: Int): RefreshResult =
        parseRefreshResult(JSONObject(sendJson("POST", "/api/v1/status/refresh/$feedId", JSONObject())).getJSONObject("data"))
            .also { invalidateCache() }


    // Settings

    suspend fun getBootstrap(): BootstrapData = cached(
        "bootstrap",
        SHELL_CACHE_MS,
        { bootstrapCache },
        { bootstrapCache = it },
    ) { parseBootstrap(getData("/api/v1/bootstrap")) }

    suspend fun getSettings(): UserSettings = getBootstrap().settings

    suspend fun updateSettings(
        theme: String? = null,
        language: String? = null,
        readableLanguages: List<String>? = null,
        articleSortOrder: String? = null,
        openInBrowserByDefault: Boolean? = null,
    ): UserSettings {
        val body = JSONObject()
        theme?.let { body.put("theme", it) }
        language?.let { body.put("language", it) }
        readableLanguages?.let { body.put("readableLanguages", JSONArray(it)) }
        articleSortOrder?.let { body.put("articleSortOrder", it) }
        openInBrowserByDefault?.let { body.put("openInBrowserByDefault", it) }
        return parseSettings(JSONObject(sendJson("PATCH", "/api/v1/settings", body)).getJSONObject("data"))
            .also { invalidateCache() }
    }

    // Subscriptions

    suspend fun listSubscriptions(): List<Subscription> = getBootstrap().subscriptions

    suspend fun getSubscription(id: Int): Subscription = parseSubscription(getData("/api/v1/subscriptions/$id"))

    suspend fun createSubscription(feedUrl: String, tagIds: List<Int>, tagNames: List<String>): Subscription {
        val body = JSONObject()
            .put("feedUrl", feedUrl)
            .put("tagIds", JSONArray(tagIds))
            .put("tagNames", JSONArray(tagNames))
        return parseSubscription(JSONObject(sendJson("POST", "/api/v1/subscriptions", body)).getJSONObject("data"))
            .also { invalidateCache() }
    }

    suspend fun updateSubscription(id: Int, customTitle: String?): Subscription {
        val body = JSONObject().put("customTitle", customTitle ?: JSONObject.NULL)
        return parseSubscription(JSONObject(sendJson("PATCH", "/api/v1/subscriptions/$id", body)).getJSONObject("data"))
            .also { invalidateCache() }
    }


    suspend fun deleteSubscription(id: Int) {
        sendJson("DELETE", "/api/v1/subscriptions/$id")
        invalidateCache()
    }

    suspend fun markAllRead(id: Int): MarkAllReadResult =
        parseMarkAllReadResult(JSONObject(sendJson("POST", "/api/v1/subscriptions/$id/mark-all-read", JSONObject())).getJSONObject("data"))
            .also { invalidateCache() }

    suspend fun retryInitialFetch(id: Int): Subscription =
        parseSubscription(JSONObject(sendJson("POST", "/api/v1/subscriptions/$id/retry-initial-fetch")).getJSONObject("data"))
            .also { invalidateCache() }

    suspend fun setSubscriptionTags(id: Int, tagIds: List<Int>): Subscription {
        val body = JSONObject().put("tagIds", JSONArray(tagIds))
        return parseSubscription(JSONObject(sendJson("PUT", "/api/v1/subscriptions/$id/tags", body)).getJSONObject("data"))
            .also { invalidateCache() }
    }

    suspend fun reorderSubscriptions(ids: List<Int>) {
        sendJson("PUT", "/api/v1/subscriptions/order", JSONObject().put("subscriptionIds", JSONArray(ids)))
        invalidateCache()
    }

    // Tags

    suspend fun listTags(): List<Tag> = getBootstrap().tags

    suspend fun createTag(name: String): Tag =
        parseTag(JSONObject(sendJson("POST", "/api/v1/tags", JSONObject().put("name", name))).getJSONObject("data"))
            .also { invalidateCache() }

    suspend fun updateTag(id: Int, name: String, color: String? = null, clearColor: Boolean = false): Tag {
        val body = JSONObject().put("name", name)
        if (clearColor) body.put("color", JSONObject.NULL) else color?.let { body.put("color", it) }
        return parseTag(JSONObject(sendJson("PATCH", "/api/v1/tags/$id", body)).getJSONObject("data"))
            .also { invalidateCache() }
    }

    suspend fun deleteTag(id: Int) {
        sendJson("DELETE", "/api/v1/tags/$id")
        invalidateCache()
    }

    suspend fun reorderTags(ids: List<Int>) {
        sendJson("PUT", "/api/v1/tags/order", JSONObject().put("tagIds", JSONArray(ids)))
        invalidateCache()
    }

    // Articles

    suspend fun markAllArticlesRead(tagId: Int? = null) {
        val body = JSONObject()
        tagId?.let { body.put("tagId", it) }
        sendJson("POST", "/api/v1/articles/mark-all-read", body)
        invalidateCache()
    }

    suspend fun removeReadArticlesFromReadingList() {
        sendJson("DELETE", "/api/v1/articles/reading-list/read")
        invalidateCache()
    }

    suspend fun listArticles(filters: ArticleListFilters, cursor: String? = null, limit: Int = 20): ArticlePage {
        val cacheKey = "${filters}|${cursor ?: "first"}|$limit"
        return cached(
            "articles:$cacheKey",
            ARTICLE_CACHE_MS,
            { articleCache[cacheKey] },
            { articleCache[cacheKey] = it },
        ) {
            val params = mutableListOf("limit=$limit")
            filters.subscriptionId?.let { params.add("subscriptionId=$it") }
            filters.tagId?.let { params.add("tagId=$it") }
            filters.read?.let { params.add("read=$it") }
            if (filters.readingList == true) params.add("readingList=true")
            if (filters.bookmarked == true) params.add("bookmarked=true")
            filters.sort?.let { params.add("sort=$it") }
            filters.readOrder?.let { params.add("readOrder=$it") }
            cursor?.let { params.add("cursor=" + URLEncoder.encode(it, "UTF-8")) }
            val (data, next) = getList("/api/v1/articles?" + params.joinToString("&"))
            ArticlePage(
                articles = (0 until data.length()).map { parseArticleListItem(data.getJSONObject(it)) },
                nextCursor = next,
            )
        }
    }

    suspend fun getUnreadCounts(): UnreadCounts = cached(
        "unread-counts",
        UNREAD_CACHE_MS,
        { unreadCountsCache },
        { unreadCountsCache = it },
    ) { parseUnreadCounts(getData("/api/v1/articles/unread-counts")) }

    suspend fun importArticle(url: String, title: String? = null): SavedArticle {
        val body = JSONObject().put("url", url)
        title?.takeIf { it.isNotBlank() }?.let { body.put("title", it) }
        return parseSavedArticle(JSONObject(sendJson("POST", "/api/v1/articles/import", body)).getJSONObject("data"))
            .also { invalidateCache() }
    }

    suspend fun setArticleRead(id: Int, isRead: Boolean): ArticleUserState {
        val body = JSONObject().put("isRead", isRead)
        return parseUserState(JSONObject(sendJson("PATCH", "/api/v1/articles/$id/state", body)).getJSONObject("data"))
            .also { invalidateCache() }
    }

    suspend fun setReadingListMembership(id: Int, active: Boolean): ArticleUserState {
        val method = if (active) "PUT" else "DELETE"
        return parseUserState(JSONObject(sendJson(method, "/api/v1/articles/$id/reading-list")).getJSONObject("data"))
            .also { invalidateCache() }
    }

    suspend fun setBookmarkMembership(id: Int, active: Boolean): ArticleUserState {
        val method = if (active) "PUT" else "DELETE"
        return parseUserState(JSONObject(sendJson(method, "/api/v1/articles/$id/bookmark")).getJSONObject("data"))
            .also { invalidateCache() }
    }

    suspend fun requestArticleContent(id: Int, force: Boolean = false): ArticleContent =
        parseArticleContent(
            JSONObject(sendJson("POST", "/api/v1/articles/$id/content", JSONObject().put("force", force))).getJSONObject("data"),
        )

    suspend fun getArticleContent(id: Int): ArticleContent =
        parseArticleContent(getData("/api/v1/articles/$id/content"))

    // OPML

    suspend fun importOpml(fileBytes: ByteArray, fileName: String): OpmlImportJob {
        val boundary = "filo-${UUID.randomUUID()}"
        val output = ByteArrayOutputStream()
        output.write("--$boundary\r\n".toByteArray())
        output.write("Content-Disposition: form-data; name=\"file\"; filename=\"$fileName\"\r\n".toByteArray())
        output.write("Content-Type: text/xml\r\n\r\n".toByteArray())
        output.write(fileBytes)
        output.write("\r\n--$boundary--\r\n".toByteArray())
        val response = request(
            "POST",
            "/api/v1/opml/import",
            output.toByteArray(),
            contentType = "multipart/form-data; boundary=$boundary",
        )
        return parseOpmlJob(JSONObject(response).getJSONObject("data"))
    }

    suspend fun getOpmlImport(jobId: String): OpmlImportJob = parseOpmlJob(getData("/api/v1/opml/imports/$jobId"))

    suspend fun exportOpml(): ByteArray = request("GET", "/api/v1/opml/export").toByteArray(Charsets.UTF_8)

    // Account

    suspend fun deleteAccount(): DeletionAccepted {
        val data = JSONObject(sendJson("DELETE", "/api/v1/account")).getJSONObject("data")
        return DeletionAccepted(data.optString("status"), data.optString("deletionToken"))
    }

    suspend fun deletionStatus(deletionToken: String?): DeletionStatus {
        val path = if (deletionToken != null) {
            "/api/v1/account/deletion-status?deletionToken=" + URLEncoder.encode(deletionToken, "UTF-8")
        } else {
            "/api/v1/account/deletion-status"
        }
        val data = JSONObject(request("GET", path, authorized = deletionToken == null)).getJSONObject("data")
        return DeletionStatus(data.optString("status"), if (data.has("retryable")) data.optBoolean("retryable") else null)
    }
}
