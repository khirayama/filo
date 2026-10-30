package com.filo.app.ui

import com.filo.app.api.ArticleListItem
import com.filo.app.api.ArticleUserState
import org.junit.Assert.*
import org.junit.Test

class ArticleReadStateTest {
    private fun article(id: Int, read: Boolean = false, bookmark: Boolean = false) = ArticleListItem(
        id, "Article $id", null, null, null, null, "", "Feed", emptyList(),
        ArticleUserState(read, false, bookmark),
    )

    @Test fun restoresHiddenRowsInOrderWithoutAnotherRequest() {
        val previous = listOf(article(1), article(2), article(3))
        assertEquals(previous, restoringArticleReadStates(emptyList(), previous))
        assertEquals(previous, restoringArticleReadStates(listOf(article(2, true)), previous))
    }

    @Test fun preservesRowsRemovedByOtherOperations() {
        assertEquals(listOf(article(2)), restoringArticleReadStates(listOf(article(2, true)), listOf(article(1), article(2)), restoreHidden = false))
    }

    @Test fun preservesOtherEditsAndNewRows() {
        val previous = listOf(article(1), article(2, true))
        val current = listOf(article(1, true, true), article(2, true), article(3))
        assertEquals(listOf(article(1, false, true), article(2, true), article(3)), restoringArticleReadStates(current, previous))
        assertTrue(current[0].userState.isRead)
    }
}
