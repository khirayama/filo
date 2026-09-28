# filo App Specification

本書は、翻訳付き RSS リーダーとリーディング機能のアプリ共通仕様を定義します。

## Documents

- [API.md](./API.md): HTTP API 契約
- [DATABASE.md](./DATABASE.md): Cloudflare D1 のスキーマと不変条件
- [SCREENS.md](./SCREENS.md): 画面とナビゲーション
- [SHORTCUTS.md](./SHORTCUTS.md): Web / Extension / iOS / Android の共通ショートカット
- [OPERATIONS.md](./OPERATIONS.md): 環境、デプロイ、ジョブ運用、障害対応

## Architecture Overview

- Auth は Better Auth（メールアドレス・パスワード）、メール配送は Resend、API は Cloudflare Workers、Database は Cloudflare D1 を利用する。
- Feed refresh はユーザーの明示操作で開始し、Queue の完了を status API で確認する。
- 翻訳はクライアント端末内で実行し、API は翻訳を生成・保存しない。
- iOS、Android、Web は購読管理と RSS 記事一覧を提供する。Web のリーディング機能は Browser Extension と連携する。

## Application Rules

- ユーザーが管理する対象は feed ではなく subscription とする。
- 記事一覧は既読状態、ブックマーク、購読、タグの文脈を表示する。
- 記事タップは元記事 URL を開く。
- タイトル翻訳は記事一覧の手動トグルでのみ起動する。
- 翻訳対象は表示中の記事に限り、表示言語の 1 言語へ翻訳する。
- 翻訳済みタイトルには原文へ戻す操作を用意する。
- 端末内翻訳を利用できない場合は翻訳トグルを表示しない。
- feed refresh、購読管理、タグ管理、OPML、アカウント削除は既存 API 契約に従う。
- リーディング開始時はリーディングリストを直接読み込み、最初の未読記事から開始する。再生キューと再生位置は端末間で共有しない。
- 前後移動時は移動元、読み上げ完了時は完了記事を既読にする。閲覧開始と一時停止だけでは既読にしない。
- 本文翻訳に失敗した場合は原文を読み上げ、セッションを止めない。
- 「このページを読み上げ」は現在ページの表示中の文章（`article` / `main` / `body` の表示テキスト）を優先して読み上げる。十分な長さ（100文字）が取れない場合は Readability の本文抽出、それも取れない場合はサーバーの保存済み本文抽出（リーディングリストの記事のみ）へフォールバックする。読み上げ時点のページから取得するため、ブラウザの組み込み翻訳後の表示を読み上げられる場合がある。
- ページ上で文章を選択している間だけ「選択範囲を読み上げ」を有効にする。Browser Extension は右クリックメニューからも開始できる。選択範囲の読み上げ完了では記事を既読にしない。
- 読み上げ文章の言語が読み上げ言語と異なる場合は端末内で翻訳して読み上げる。Browser Extension は言語を読み上げる文章から判定し（`chrome.i18n.detectLanguage`、判定できなければページの宣言言語）、翻訳はページ内の Translator API で行う。翻訳モデルが未準備の場合は原文を読み上げ、その旨を表示する。
- 読み上げ中に声・言語・速度を変えた場合は、新しい設定で読み上げ直す。
- Web の読み上げは Browser Extension が管理する。Extension の読み上げ用タブ（リーディングブラウザ）は iOS / Android のアプリ内ブラウザに相当し、リーディングリストを開始時点で固定して前後移動・リスト選択をそのタブ内で行う。読み上げ中のタブを閉じると読み上げを止める。
- iOS / Android の前後移動は、アプリ内ブラウザを維持したまま現在記事を切り替えるカルーセル相当の遷移とする。
- Web 本体で Browser Extension が検出できない場合、閲覧開始・読み上げ開始操作は表示するが無効にする。

## Release Gate

- Web build / lint / typecheck
- API typecheck / test
- Android compile
- iOS build
