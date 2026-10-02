package com.filo.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TitleTranslatorTest {
    @Test
    fun wrapsInSourceLanguage() {
        val texts = titleAttempts("OpenAI ships", "en").map { it.text }
        assertEquals(listOf("OpenAI ships", "Headline: OpenAI ships", "\"OpenAI ships\""), texts)
        assertEquals(listOf("新製品", "見出し：新製品", "「新製品」"), titleAttempts("新製品", "ja").map { it.text })
    }

    @Test
    fun removesTranslatedHeadlinePrefix() {
        assertEquals("DoorDashはAIエージェントを発表", removeHeadlinePrefix("DoorDash launches", "見出し：DoorDashはAIエージェントを発表"))
        // 原文のコロンは残す
        assertEquals("삼성 리뷰 : 태블릿", removeHeadlinePrefix("Samsung review: tablet", "헤드 라인 : 삼성 리뷰 : 태블릿"))
        // 前置きが消えていたら、どこまでが前置きか分からない
        assertNull(removeHeadlinePrefix("Samsung review: tablet", "삼성 리뷰 : 태블릿"))
    }

    @Test
    fun removesTranslatedQuotes() {
        assertEquals("InstagramはAIを展開", removeQuotes("「InstagramはAIを展開」"))
        assertEquals("OpenaiのJevクローン", removeQuotes("\"OpenaiのJevクローン\""))
        assertNull(removeQuotes("引用符なし"))
    }

    @Test
    fun rejectsUnwrappedCopyOfOriginal() {
        val attempt = titleAttempts("Samsung Tab review", "en")[1]
        val unwrapped = attempt.unwrap("Titular: Samsung Tab Review")!!
        assertEquals(false, isUsableTranslation("Samsung Tab review", unwrapped, "es"))
    }
}
