package com.filo.app.ui

import java.time.Instant
import java.time.format.DateTimeFormatter

fun parseInstant(iso: String?): Instant? {
    if (iso.isNullOrBlank()) return null
    return runCatching { Instant.from(DateTimeFormatter.ISO_DATE_TIME.parse(iso)) }.getOrNull()
}
