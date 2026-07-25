package com.filo.app

import android.app.Activity
import android.app.LocaleManager
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.os.LocaleList
import java.util.Locale

/** Applies the server-side app language to Android's resource locale. */
object LanguagePreference {
    private const val PREFS = "filo_language"
    private const val KEY = "language"

    fun load(context: Context): String = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(KEY, "ja") ?: "ja"

    fun set(context: Context, language: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, language).apply()
        apply(context, language)
    }

    fun apply(context: Context, language: String = load(context)) {
        val tag = when (language) {
            "zh" -> "zh-CN"
            "ko" -> "ko"
            "es" -> "es"
            "en" -> "en"
            else -> "ja"
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.getSystemService(LocaleManager::class.java)?.applicationLocales = LocaleList.forLanguageTags(tag)
        } else {
            val configuration = Configuration(context.resources.configuration)
            configuration.setLocale(Locale.forLanguageTag(tag))
            context.resources.updateConfiguration(configuration, context.resources.displayMetrics)
        }
    }

    fun recreateIfNeeded(context: Context, previous: String, next: String) {
        if (previous != next) (context as? Activity)?.recreate()
    }
}
