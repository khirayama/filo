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
- 本文抽出は Readability を使い、短い抽出結果を除外する保守的な設定とする。記事の取りこぼしを避けるため、ノイズが多少残ることは許容する。
- Web の読み上げは Browser Extension が現在ページを管理する。
- Browser Extension は読み上げ対象として、Readability で抽出した本文（デフォルト）と、現在ページの表示テキストを選択できる。
- 表示テキストの読み上げはページの `article` / `main` / `body` の表示中テキストを取得し、Filo側の本文翻訳を重ねずに読み上げる。ブラウザの組み込み翻訳後の表示を利用できる場合があるが、ページ実装やブラウザの状態に依存する。
- iOS / Android の前後移動は、アプリ内ブラウザを維持したまま現在記事を切り替えるカルーセル相当の遷移とする。
- Web 本体で Browser Extension が検出できない場合、閲覧開始・読み上げ開始操作は表示するが無効にする。

## Release Gate

- Web build / lint / typecheck
- API typecheck / test
- Android compile
- iOS build
