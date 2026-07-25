package com.filo.app.ui

import com.filo.app.api.ApiClient
import java.time.Instant
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay

private const val REFRESH_POLL_MS = 2_500L
private const val REFRESH_TIMEOUT_MS = 45_000L

fun parseInstant(iso: String?): Instant? {
    if (iso.isNullOrBlank()) return null
    return runCatching { Instant.from(DateTimeFormatter.ISO_DATE_TIME.parse(iso)) }.getOrNull()
}

// Polls /status until the requested fetch jobs have settled — for a single
// feed when [feedId] is given, otherwise for the whole refresh run. The server
// records a pending fetch job per feed before responding, so completion is
// "no fetch job is pending or running anymore". Returns false on timeout.
suspend fun awaitRefreshCompletion(queuedAtIso: String?, feedId: Int? = null): Boolean {
    if (queuedAtIso.isNullOrBlank()) return false
    val deadline = System.currentTimeMillis() + REFRESH_TIMEOUT_MS
    while (System.currentTimeMillis() < deadline) {
        delay(REFRESH_POLL_MS)
        val status = runCatching { ApiClient.getStatus() }.getOrNull() ?: continue
        if (feedId != null) {
            val sub = status.subscriptionStatuses.firstOrNull { it.feedId == feedId } ?: return false
            if (sub.fetchJob?.isActive != true) return true
        } else if (status.subscriptionStatuses.none { it.fetchJob?.isActive == true }) {
            return true
        }
    }
    return false
}
