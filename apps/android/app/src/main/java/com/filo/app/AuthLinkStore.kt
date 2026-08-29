package com.filo.app

import android.net.Uri
import kotlinx.coroutines.flow.MutableSharedFlow

object AuthLinkStore {
    var resetToken: String? = null
    val resetEvents = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    fun accept(uri: Uri?) {
        if (uri == null || uri.scheme != "filo" || uri.host != "auth") return
        val isReset = uri.path?.contains("reset", ignoreCase = true) == true
        val token = uri.getQueryParameter("token") ?: uri.getQueryParameter("code")
        if (isReset) {
            resetToken = token
            resetEvents.tryEmit(Unit)
        }
    }
}
