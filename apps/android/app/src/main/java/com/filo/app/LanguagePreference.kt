package com.filo.app

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** Stores the app-selected language and exposes it as Compose state. */
object LanguagePreference {
    private const val PREFS = "filo_language"
    private const val KEY = "language"

    var value by mutableStateOf("ja")
        private set

    fun load(context: Context): String {
        value = supported(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY, "ja"))
        return value
    }

    fun set(context: Context, language: String) {
        value = supported(language)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, value).apply()
    }

    private fun supported(language: String?): String = when (language) {
        "en", "zh", "ko", "es" -> language
        else -> "ja"
    }
}
