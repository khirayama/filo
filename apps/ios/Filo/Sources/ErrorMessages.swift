import Foundation

enum ErrorMessages {
    private static let messages: [String: String] = [
        "network_error": "ネットワークに接続できません。時間をおいて再試行してください。",
        "unauthorized": "サインインが必要です。",
        "forbidden": "この操作を行う権限がありません。",
        "validation_error": "入力内容を確認してください。",
        "resource_not_found": "対象が見つかりません。",
        "conflict": "操作が競合しました。最新の状態を確認してください。",
        "internal_error": "サーバーエラーが発生しました。時間をおいて再試行してください。",
        "rate_limited": "操作が混み合っています。少し待ってから再試行してください。",
        "subscription_already_exists": "このフィードはすでに購読しています。",
        "subscription_not_found": "購読が見つかりません。",
        "tag_already_exists": "同じ名前のタグがすでにあります。",
        "tag_not_found": "タグが見つかりません。",
        "article_not_found": "記事が見つかりません。",
        "invalid_cursor": "ページ情報が無効です。再読み込みしてください。",
        "feed_discovery_failed": "このURLからフィードを見つけられませんでした。",
        "feed_unreachable": "URLに接続できませんでした。アドレスを確認してください。",
        "initial_fetch_retry_not_allowed": "この購読は再試行できる状態ではありません。",
        "opml_import_not_found": "インポートジョブが見つかりません。",
        "language_detection_failed": "原文の言語を判定できませんでした。",
        "account_deletion_failed": "アカウント削除処理に失敗しました。再試行してください。",
    ]

    static func message(for code: String) -> String {
        L10n.string(messages[code] ?? messages["internal_error"]!)
    }

    static func message(for error: Error) -> String {
        if let apiError = error as? APIError {
            return message(for: apiError.code)
        }
        return L10n.string(messages["internal_error"]!)
    }

    static func initialFetchMessage(for code: String?) -> String {
        switch code {
        case "feed_unreachable": return L10n.string("フィードに接続できませんでした。")
        case "feed_discovery_failed": return L10n.string("フィードを見つけられませんでした。")
        default: return L10n.string("初回の記事取得に失敗しました。")
        }
    }
}
