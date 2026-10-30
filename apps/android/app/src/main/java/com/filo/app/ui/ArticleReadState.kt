package com.filo.app.ui

import com.filo.app.api.ArticleListItem

// Roll back only the failed bulk read change, preserving other row edits.
internal fun restoringArticleReadStates(current: List<ArticleListItem>, previous: List<ArticleListItem>, restoreHidden: Boolean = true): List<ArticleListItem> {
    val states = previous.associate { it.id to it.userState.isRead }
    val restored = current.map { article ->
        states[article.id]?.let { article.copy(userState = article.userState.copy(isRead = it)) } ?: article
    }.toMutableList()
    if (!restoreHidden) return restored
    val ids = restored.mapTo(mutableSetOf()) { it.id }
    previous.forEachIndexed { index, article ->
        if (ids.add(article.id)) restored.add(index.coerceAtMost(restored.size), article)
    }
    return restored
}
