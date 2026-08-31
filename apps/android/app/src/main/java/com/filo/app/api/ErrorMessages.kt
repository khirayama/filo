package com.filo.app.api

import com.filo.app.ui.AppStrings

object ErrorMessages {
    private val messages = mapOf(
        "network_error" to "ネットワークに接続できません。時間をおいて再試行してください。",
        "unauthorized" to "サインインが必要です。",
        "forbidden" to "この操作を行う権限がありません。",
        "validation_error" to "入力内容を確認してください。",
        "resource_not_found" to "対象が見つかりません。",
        "conflict" to "操作が競合しました。最新の状態を確認してください。",
        "internal_error" to "サーバーエラーが発生しました。時間をおいて再試行してください。",
        "rate_limited" to "操作が混み合っています。少し待ってから再試行してください。",
        "subscription_already_exists" to "このフィードはすでに購読しています。",
        "subscription_not_found" to "購読が見つかりません。",
        "tag_already_exists" to "同じ名前のタグがすでにあります。",
        "tag_not_found" to "タグが見つかりません。",
        "article_not_found" to "記事が見つかりません。",
        "invalid_cursor" to "ページ情報が無効です。再読み込みしてください。",
        "feed_discovery_failed" to "このURLからフィードを見つけられませんでした。",
        "feed_unreachable" to "URLに接続できませんでした。アドレスを確認してください。",
        "initial_fetch_retry_not_allowed" to "この購読は再試行できる状態ではありません。",
        "opml_import_not_found" to "インポートジョブが見つかりません。",
        "language_detection_failed" to "原文の言語を判定できませんでした。",
        "account_deletion_failed" to "アカウント削除処理に失敗しました。再試行してください。",
    )

    fun forError(error: Throwable): String =
        AppStrings.get(messages[(error as? ApiException)?.code] ?: messages.getValue("internal_error"))

    fun initialFetchMessage(code: String?): String = when (code) {
        "feed_unreachable" -> AppStrings.get("フィードに接続できませんでした。")
        "feed_discovery_failed" -> AppStrings.get("フィードを見つけられませんでした。")
        else -> AppStrings.get("初回の記事取得に失敗しました。")
    }
}
