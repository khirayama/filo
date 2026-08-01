# filo App Specification

本書は、翻訳付き RSS リーダーとしてのアプリ共通仕様を定義します。リーディング画面、本文抽出、読み上げ、再生キューは現在の対象外です。

## Documents

- [API.md](./API.md): HTTP API 契約
- [DATABASE.md](./DATABASE.md): Cloudflare D1 のスキーマと不変条件
- [SCREENS.md](./SCREENS.md): 画面とナビゲーション
- [OPERATIONS.md](./OPERATIONS.md): 環境、デプロイ、ジョブ運用、障害対応

## Architecture Overview

- Auth は Clerk、API は Cloudflare Workers、Database は Cloudflare D1 を利用する。
- Feed refresh はユーザーの明示操作で開始し、Queue の完了を status API で確認する。
- 翻訳はクライアント端末内で実行し、API は翻訳を生成・保存しない。
- iOS、Android、Web は購読管理と RSS 記事一覧を提供する。Browser Extension は現在の主要機能に含めない。

## Application Rules

- ユーザーが管理する対象は feed ではなく subscription とする。
- 記事一覧は既読状態、ブックマーク、購読、タグの文脈を表示する。
- 記事タップは元記事 URL を開く。
- タイトル翻訳は記事一覧の手動トグルでのみ起動する。
- 翻訳対象は表示中の記事に限り、表示言語の 1 言語へ翻訳する。
- 翻訳済みタイトルには原文へ戻す操作を用意する。
- 端末内翻訳を利用できない場合は翻訳トグルを表示しない。
- feed refresh、購読管理、タグ管理、OPML、アカウント削除は既存 API 契約に従う。

## Release Gate

- Web build / lint / typecheck
- API typecheck / test
- Android compile
- iOS build
