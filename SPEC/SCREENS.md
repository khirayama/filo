# filo Screens

## Table of Contents

- [Screen List](#screen-list)
- [Navigation Rules](#navigation-rules)

## Screen List

- サインアップ・サインイン画面

- 購読一覧画面
  - 情報設計上のルート画面として扱う
  - route は `/subscriptions` とする
  - 全記事一覧への導線を持つ
  - タグごとの開閉リスト表示に対応する
  - タグ名押下でタグ絞り込み済み記事一覧へ遷移できる
  - タグのリネーム、並び替えに対応する
  - 購読の並び替え、タグ付けに対応する
  - 設定画面、タグ管理画面への導線を持つ
  - 購読がない場合はフィード追加画面への導線を優先表示する
  - `feedHealthStatus=paused` の購読は更新異常を識別できる表示を行う
  - `feedHealthStatus=stale` の購読は「しばらく更新なし」と分かる控えめな表示を行う
  - `feed_fetch_states` 未作成または `lastSuccessFetchedAt=null` の新規購読は、`initialFetchStatus=fetching` の間 `feedHealthStatus=healthy` として扱い、更新異常表示を出さない
  - 読み込み中は loading 状態、取得失敗時は再試行導線を表示する
  - tablet 以上では記事一覧と結合し、左サイドバーとして表示してよい

- 購読記事一覧画面
  - 起動時のスタートアップ画面として扱う
  - route は `/articles` とする
  - 購読中 feed に含まれる記事を一覧表示する
  - 記事一覧にはブックマーク、feed名、タイトル、本文プレビュー、時刻を表示する
  - タグ、`read`、ブックマークで絞り込みできる。リーディングリストは独立画面への導線として扱う
  - 全既読ボタンを提供し、`POST /articles/mark-all-read` で全購読（タグ絞り込み中はそのタグ配下）の既読カーソルを前進させて一覧と未読数を更新する
  - 複合絞り込みは API 契約どおり strict AND で適用する
  - ブックマーク絞り込みでは retained article を含めてよい
  - 通常一覧および `read=false` 絞り込みには retained article を含めない
  - 更新ボタン（pull-to-refresh 含む）は購読 feed の取得ジョブを enqueue し、`GET /status` のポーリングで完了を待ってから一覧を再読込する
  - 更新対象がクールダウン中で 0 件の場合、その旨を控えめに表示する
  - タイトルはサーバー保存の `translatedTitle` があれば翻訳を表示し、「原文/翻訳」トグルで切り替えられる
  - 記事一覧の主操作は `開く` `音読キューへ追加` `リーディングリスト／ブックマーク` に絞る
  - 読み上げキューはサーバーで管理し、iOS / Android / Web + Extension 間で共有する
  - 読み上げキューへの記事追加、削除、並び替えに対応する
  - 再生中の記事、言語、再生位置を保存し、端末切替時に再開できる
  - Web では記事タップの主導線を実際の元記事ページを開くこと、または Extension に引き継ぐこととする
  - iOS / Android では記事タップで記事リーディング画面へ遷移する
  - フィード追加画面への導線を持つ
  - 記事がない場合は空状態を表示し、購読がない場合はフィード追加導線を優先する
  - 読み込み中は loading 状態、取得失敗時は再試行導線を表示する
  - 記事0件かつ `initialFetchStatus=fetching` の購読が存在する場合は空状態ではなく取得中表示を優先する
  - 記事0件でも `initialFetchStatus=ready` の購読のみであれば、正常な空状態として扱う
  - 初期並び順は server が適用した current user の `articleSortOrder` に従う
  - tablet 以上では 2 カラムレイアウトとし、購読一覧を左側に統合してよい

- フィード追加画面
  - RSS/Atom URL またはサイト URL を受け付ける
  - 既存タグ選択と新規タグ名追加に対応する
  - discovery 中は二重送信を防止する
  - 既存 feed に `lastSuccessFetchedAt` がある、または article が存在する場合は、作成成功直後に `initialFetchStatus=ready` として通常完了表示にしてよい
  - 作成成功直後に `initialFetchStatus=fetching` の場合は、追加は完了しており記事取得中であることを明示する
  - `initialFetchStatus=failed` の場合は、購読は作成済みだが初回取得に失敗したこと、`initialFetchErrorCode` に応じた文言、および再試行導線を表示する
  - `feedHealthStatus` より `initialFetchStatus=failed` の表示を優先する
  - 初回取得 retry は failed subscription に対してのみ表示する
  - 初回取得 retry は `paused` feed 上でも許可される user recovery として扱い、admin 操作を前提にしない
  - 失敗時は API error code を画面文言へ変換して表示する

- リーディングリスト画面
  - 記事フィルタではなく、保存した記事を読む・聴くための独立画面として扱う
  - Web の route は `/reading-list` とする
  - iOS / Android は独立したナビゲーション先として提供する
  - `readingList=true` で取得した記事を一覧表示し、元記事を開く、リーディングリスト解除、ブックマーク、音読キュー追加・再生を提供する
  - リーディングリストという状態を、全記事・未読・既読・タグ・ブックマークなどのフィルタ表現や複合フィルタのタイトルに含めない
  - リーディングリストから解除した記事は画面から直ちに除外する

- タグ管理画面
  - タグ一覧を表示する
  - タグの編集に対応する
  - タグがない場合は空状態を表示する

- 購読詳細・記事一覧画面
  - 対象 subscription 配下の記事一覧を表示する
  - 更新ボタン（pull-to-refresh 含む）は対象 feed 単体の取得ジョブを enqueue し、完了を待って一覧を再読込する
  - 全既読ボタンを提供し、`POST /subscriptions/{id}/mark-all-read` でフィード単位の既読カーソルを前進させて一覧と未読数を更新する
  - 並び順、`read` / ブックマークの絞り込みを適用できる。リーディングリストは独立画面で扱う
  - ブックマーク絞り込みでも retained article は表示せず、対象 subscription 配下の記事だけを扱う
  - 対象 subscription が削除済みまたは不可視の場合は一覧へ戻る導線を表示する

- 記事リーディング画面（iOS / Android のみ）
  - Web には対応する記事詳細 route を持たない
  - iOS / Android ではネイティブ画面として提供する
  - 目的は記事を読むこと、元記事を開くこと、音読すること、キューへ追加することに絞る
  - 実際の Web ページを開いた状態で読む体験を前提とし、publisher への送客を損なわない
  - タイトルは `translatedTitle` があれば翻訳を表示し、原文タイトルへのトグルを持つ
  - feed 情報、公開日時、author など必要最小限の記事情報を表示してよい
  - RSS 本文、抽出本文、翻訳本文を切り替える画面にはしない
  - 既読、リーディングリスト、ブックマークを明示操作できる
  - 元記事を開ける
  - 音読開始と音読キュー追加を提供する
  - ブラウザや OS の翻訳機能で表示内容が変化している場合、その表示後コンテンツを音読対象に含めてよい
  - retained article では feed 情報は表示してよいが、subscription 依存 UI は表示しない
  - retained article でも userState 操作は許可する

- 処理ステータス画面
  - 基本操作はフィード取得とタイトル翻訳の2つとし、それぞれ全体実施（「すべて取得」「すべて翻訳」）と購読行ごとの個別実施（「取得」「翻訳」）を提供する。強制取得・強制翻訳などその他の操作は持たない（「すべて取得」は `force=true` で全 active feed を対象にする）
  - 全体のヘルスバナーやジョブ集計は表示しない。状態は購読行ごとのバッジとエラー表示のみで伝える
  - 購読行ごとに取得・翻訳それぞれのジョブ状態（待ち・実行中・失敗・中断）とエラー内容を表示する。ジョブが無い・完了済みの行はバッジを出さない
  - 購読行ごとに翻訳カバレッジ（`translation`）を「済 ready/needed・失敗 N・未処理 N・対象外 N記事(タイトルが空)」の形で表示する。全記事で翻訳できているか、できていないなら理由（失敗／未処理／翻訳対象外）が一目で分かるようにし、状況を不透明にしない
  - 待ちの内訳は `queued`（順番待ち）と `processing`（モデル応答待ち）を区別して表示してよい
  - 失敗・中断したジョブは行ごとの「取得」「翻訳」で再実行する（一括再開操作は持たない）。中断（stalled）状態は行の操作を無効化しない
  - ポーリングの一時的な失敗はエラー表示せず直前の表示内容を維持する（表示できる内容が無い場合のみエラーを出す）
  - 本文翻訳の操作は持たない（本文翻訳はアプリでは提供しない）
  - 本文抽出はリーディングパート用の on-demand 処理とし、RSS リーダー管理UIからは直接操作しない
  - iOS / Android / Web + Extension で同一の操作セットを提供する（隠し操作・修飾キー依存の操作は持たない）

- 設定画面
  - 言語
  - 原文のまま読む言語（サポート言語 `ja | en | zh | ko | es` から複数選択。原文言語が選択言語に含まれる記事は翻訳せず原文タイトルを優先表示する）
  - テーマ
  - ブラウザ設定
  - 並び順
  - OPMLインポート・エクスポート
  - OPMLインポートは非同期 job とし、進捗・完了結果を確認できる
  - ログアウト
  - アカウント削除
  - アカウント削除は受付後に専用の削除進行表示へ遷移させる
  - 削除進行表示は `DELETE /api/v1/account` の response に含まれる `deletionToken` を保持し、`GET /api/v1/account/deletion-status` を参照して `pending` `running` `failed` `completed` を表示する
  - 削除失敗時は再試行または問い合わせ導線を表示する
  - Clerk deletion 成功後に cleanup が継続していても、`deletionToken` による進行表示は継続でき、再ログインで復活しないことを案内してよい
  - 既読履歴の扱いに関する説明を表示してよい

## Navigation Rules

- ルート画面とスタートアップ画面は異なる
- startup は購読記事一覧、management root は購読一覧とする
- startup route は `/articles`、management root route は `/subscriptions` とする
- リーディングリスト route は `/reading-list` とし、記事一覧のフィルタ状態とは独立させる
- Web は記事詳細画面を持たず、記事一覧や retained article 一覧から実際の元記事ページを開く、または Extension に引き継ぐ
- iOS / Android はリーディングリスト画面、購読詳細、購読記事一覧画面のブックマーク絞り込みのいずれからでも記事リーディング画面へ遷移できる
- 記事リーディング画面を開いただけでは既読化しない
- 未読は実効既読（`article_read_states` row、無ければフィード単位の既読カーソル）が `true` でない記事として扱う
- 購読一覧・サイドバーには購読ごとの `unreadCount` を表示してよい
- 読み上げ開始時にクライアントは `PATCH /articles/{id}/state` を呼び既読化する
- 既読解除はユーザーの明示操作で行う
- 閲覧履歴は既読記事一覧で代替し、独立した履歴画面は持たない
- タグ順・購読順は端末をまたいで維持される
- unsubscribe後もリーディングリスト／ブックマーク membership がある記事は、対応する一覧から遷移できる
- API error response の `code` はそのまま表示せず、クライアント側で画面文言に変換する
- `rate_limited`、network error、server error は再試行可能な一時エラーとして扱い、重複送信を避ける
