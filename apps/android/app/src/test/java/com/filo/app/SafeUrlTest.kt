package com.filo.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SafeUrlTest {
    @Test
    fun allowsOnlyHttpAndHttps() {
        assertEquals("https://example.com/article", safeHttpUrl("https://example.com/article"))
        assertEquals("http://example.com/article", safeHttpUrl("http://example.com/article"))
        assertNull(safeHttpUrl("javascript:alert(1)"))
        assertNull(safeHttpUrl("data:text/html,hello"))
        assertNull(safeHttpUrl("file:///etc/passwd"))
        assertNull(safeHttpUrl("mailto:a@example.com"))
        assertNull(safeHttpUrl("/relative"))
        assertNull(safeHttpUrl("https://user:pass@example.com/"))
    }

    @Test
    fun acceptsLinksBrowsersAccept() {
        assertEquals("https://my_blog.example.com/post", safeHttpUrl("https://my_blog.example.com/post"))
        assertEquals("https://example.com/記事", safeHttpUrl("  https://example.com/記事 "))
    }

    @Test
    fun allowsOnlySafeWebViewNavigations() {
        assertEquals(true, isAllowedWebNavigation("https://example.com/article"))
        assertEquals(true, isAllowedWebNavigation("about:blank"))
        assertEquals(false, isAllowedWebNavigation("javascript:alert(1)"))
        assertEquals(false, isAllowedWebNavigation("file:///etc/passwd"))
        assertEquals(false, isAllowedWebNavigation("intent://scan/#Intent;scheme=zxing;end"))
    }
}
