package com.filo.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import java.net.URL

// java.net.URL accepts what browsers accept (non-ASCII paths, "_" in host
// names), unlike java.net.URI, so a shared link opens here as on iOS and Web.
fun safeHttpUrl(value: String?): String? {
    val trimmed = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val parsed = runCatching { URL(trimmed) }.getOrNull() ?: return null
    val scheme = parsed.protocol.lowercase()
    if (scheme != "http" && scheme != "https") return null
    if (parsed.host.isNullOrBlank() || parsed.userInfo != null) return null
    return parsed.toExternalForm()
}

fun safeHttpUri(value: String?): Uri? = safeHttpUrl(value)?.let(Uri::parse)

fun isAllowedWebNavigation(value: String?): Boolean {
    val trimmed = value?.trim()?.takeIf { it.isNotEmpty() } ?: return false
    if (trimmed.equals("about:blank", ignoreCase = true) || trimmed.equals("about:srcdoc", ignoreCase = true)) {
        return true
    }
    return safeHttpUrl(trimmed) != null
}

fun openExternalUrl(context: Context, value: String?): Boolean {
    val uri = safeHttpUri(value) ?: return false
    val intent = Intent(Intent.ACTION_VIEW, uri)
    if (context !is Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return runCatching {
        context.startActivity(intent)
        true
    }.getOrDefault(false)
}
