package com.filo.app.ui

import org.junit.Assert.*
import org.junit.Test

class ReadingPageTrackerTest {
    @Test fun savedPageMatchingIgnoresTrackingButKeepsMeaningfulParameters() {
        assertTrue(sameArticleUrl("http://EXAMPLE.com/story/?utm_source=x&view=full#top", "https://example.com/story?view=full"))
        assertTrue(sameArticleUrl("https://example.com/story?q=hello+world", "https://example.com/story?q=hello%20world"))
        assertFalse(sameArticleUrl("https://example.com/story?view=short", "https://example.com/story?view=full"))
        assertFalse(sameArticleUrl(null, null))
    }
    @Test fun linkedPageDoesNotInheritOriginalArticleAndBackRestoresIt() {
        val page = ReadingPageTracker()
        page.loading()
        page.loaded("https://example.com/redirected", 42)
        assertEquals(42, page.articleId)
        assertTrue(page.isSessionPage)
        page.loading()
        page.loaded("https://example.com/linked", 42)
        assertNull(page.articleId)
        assertFalse(page.isSessionPage)
        page.loading()
        page.loaded("https://example.com/redirected#section", 42)
        assertEquals(42, page.articleId)
        assertTrue(page.isSessionPage)
    }

    @Test fun saveIsBoundToThePageAndNavigationThatStartedIt() {
        val page = ReadingPageTracker()
        page.loading()
        page.loaded("https://example.com/original", 1)
        page.loading()
        page.loaded("https://example.com/linked", 1)
        val version = page.version
        assertTrue(page.saved("https://example.com/linked", version, 2))
        assertEquals(2, page.articleId)
        page.loading()
        page.loaded("https://example.com/original", 1)
        assertFalse(page.saved("https://example.com/linked", version, 3))
        assertEquals(1, page.articleId)
        page.loading()
        page.loaded("https://example.com/linked", 1)
        assertEquals(3, page.articleId)
    }
}
