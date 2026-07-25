# filo API Design

Cloudflare Workers を利用する。タイトル翻訳には LM Studio の OpenAI 互換 API（既定 `http://localhost:1234/v1`、モデル `google/gemma-4-12b-qat`）を利用する。翻訳リクエストは reasoning を無効化し、画像入力と tools は送信しない。

Version: `v1`  
Base URL: `/api/v1`  
Auth: Clerk session required for all user endpoints. Admin endpoints require authenticated admin authorization in addition to Clerk auth.  
Content-Type: `application/json`

## Table of Contents

- [Common Rules](#common-rules)
- [Settings](#settings)
- [Subscriptions](#subscriptions)
- [Tags](#tags)
- [Articles](#articles)
- [Article Contents (リーディングパート内部用)](#article-contents-リーディングパート内部用)
- [Article User State](#article-user-state)
- [Playback Queue](#playback-queue)
- [OPML](#opml)
- [Account](#account)
- [Admin Feeds](#admin-feeds)
- [Error Codes](#error-codes)

## Common Rules

- API で返す `id` は当面 integer をそのまま利用する
- UI 上の主語は `subscription` としつつ、記事実体は `article` として返す
- 記事詳細系 API は current user が対象 article の `feed` に対する `subscription` を1件以上持つ場合、または retained article の場合に利用可能とする
- `PUT` は全置換、`PATCH` は部分更新として扱う
- client は `X-Request-Id` を任意で送信してよく、server は request ごとに `requestId` を確定し response header `X-Request-Id` で返す
- response header は `Cache-Control: no-store` を基本とする
- request body、query、path parameter は schema validation を行い、失敗時は `validation_error` を返す
- user endpoint は Clerk session 必須、admin endpoint は Clerk session と admin 判定を必須とする
- path id は current user の所有または参照権限を必ず検証する
- rate limit は IP、Clerk user、route を組み合わせて適用し、超過時は `rate_limited` を返す
- 非同期 job を投入する `POST` は重複送信に耐える冪等実装とする

### Default limits

- List API `limit`: default `20`, max `100`
- feed discovery redirect: max `5`
- feed discovery / feed fetch timeout: `10s`
- feed refresh interval: success `30m`, not_modified `120m`
- OPML import file size: max `5MB`
- OPML import outline count: max `2000`
- background job attempt max: `5`

### Success response

```json
{
  "data": {}
}
```

### List response

```json
{
  "data": [],
  "meta": {
    "nextCursor": null
  }
}
```

### Error response

```json
{
  "error": {
    "code": "resource_not_found",
    "message": "Resource not found"
  }
}
```

### HTTP status mapping

- `200`: successful read/update/delete or idempotent reuse
- `201`: newly created resource
- `202`: asynchronous job accepted
- `400`: validation or malformed request
- `401`: unauthenticated
- `403`: authenticated but not authorized for endpoint class or admin operation
- `404`: resource does not exist or is not visible to the current user
- `409`: duplicate or conflicting state
- `413`: request body or OPML file too large
- `429`: rate limit exceeded
- `500`: unexpected server error

### Cursor pagination

- List API は cursor-based pagination を利用する
- first request: `GET /api/v1/articles?limit=20`
- next page: `GET /api/v1/articles?limit=20&cursor=...`
- `limit` 未指定時は `20`、最大値は `100` とし、超過時は `validation_error` を返す
- `sort=published_at_desc` の cursor は `(publishedAt, id)` を基準にする
- `sort=fetched_at_desc` の cursor は `(fetchedAt, id)` を基準にする
- 同一 timestamp 内では `id DESC` を tie-breaker とする
- `publishedAt = null` は最も古い値として扱い、`published_at_desc` では non-null の後ろに並べる
- cursor は改ざん検知可能な opaque string として扱い、不正な場合は `invalid_cursor` を返す

### Timestamp format

- API ではすべて ISO 8601 UTC string を返す

### Boolean fields

- request / response では JSON boolean を利用する
- DB では integer flag で保存してよい

## Settings

### GET /api/v1/settings

Returns current user's settings.

```json
{
  "data": {
    "theme": "system",
    "language": "ja",
    "readableLanguages": ["ja"],
    "articleSortOrder": "published_at_desc",
    "openInBrowserByDefault": false,
    "createdAt": "2026-05-11T10:00:00Z",
    "updatedAt": "2026-05-11T10:00:00Z"
  }
}
```

### PATCH /api/v1/settings

```json
{
  "theme": "dark",
  "language": "en",
  "articleSortOrder": "fetched_at_desc",
  "openInBrowserByDefault": true
}
```

- `theme`: optional, `light | dark | system`
- `language`: optional, `ja | en | zh | ko | es`
- `readableLanguages`: optional, 表示言語としてサポートする `ja | en | zh | ko | es` の配列。ユーザーが原文のまま読みたい言語。原文言語がこの配列に含まれる記事は一覧とリーディング画面で原文タイトルを優先表示し、それ以外は `language` に対応する翻訳済みタイトルを優先表示してよい。`sourceLanguage` 自体は他の言語コードも返りうる
- `articleSortOrder`: optional, `published_at_desc | fetched_at_desc`
- `openInBrowserByDefault`: optional boolean

## Subscriptions

### GET /api/v1/subscriptions

- query: `tagId`, `cursor`, `limit`
- returns subscription summaries with feed metadata
- `unreadCount` は feed 配下の実効未読 article 数（`GET /articles` の `read=false` と同一条件）を返す

```json
{
  "data": [
    {
      "id": 14,
      "customTitle": "My Tech Sources",
      "unreadCount": 12,
      "sortOrder": 10,
      "initialFetchStatus": "ready",
      "initialFetchErrorCode": null,
      "feedHealthStatus": "healthy",
      "feed": {
        "id": 8,
        "title": "Example Tech Blog",
        "siteUrl": "https://example.com",
        "feedUrl": "https://example.com/feed.xml",
        "faviconUrl": "https://example.com/favicon.ico"
      },
      "tagIds": [3, 5],
      "createdAt": "2026-05-11T10:00:00Z",
      "updatedAt": "2026-05-11T10:00:00Z"
    }
  ],
  "meta": {
    "nextCursor": null
  }
}
```

### POST /api/v1/subscriptions

- request: `feedUrl`, `customTitle`, `tagIds`, `tagNames`
- `feedUrl` は RSS/Atom URL またはサイト URL を受け付ける
- サイト URL の場合は feed discovery を先に実行し、確定した feed URL を canonical lookup key とする
- successful response は subscription 作成完了のみを保証し、初回 article fetch 完了は保証しない
- 初回 article fetch は非同期 job で後続実行してよく、作成直後の一覧が空でも整合とみなす
- response には `initialFetchStatus` を含め、`fetching | ready | failed` を返す
- response には `initialFetchErrorCode` と導出値 `feedHealthStatus: healthy | stale | paused` を含めてよい
- 既存 feed があれば再利用し、既存 subscription があれば `subscription_already_exists` を返す
- `tagIds` は既存 tag を紐付け、`tagNames` は同一 user 内で normalized name により既存 tag を再利用し、なければ新規作成する
- `tagIds` と `tagNames` の重複指定は server 側で排除し、最終的な付与 tag 集合を subscription に反映する
- 候補が複数ある場合、MVP では最初の有効候補を採用し選択 UI は持たない
- canonicalization では HTTPS 優先、host lowercase、default port 除去、末尾 slash 正規化、`utm_*` `fbclid` `gclid` などの tracking query parameter 除去を行う
- timeout は `10s`、候補確定不能は `feed_discovery_failed`、到達不能は `feed_unreachable` を返す
- discovery / fetch は SSRF 対策として private IP、localhost、link-local、metadata endpoint を拒否する
- `initialFetchStatus` は subscription 単位の初回記事取得状態とする
- `initialFetchStatus` は「その subscription 作成時点で必要だった初回記事取得が、当該 subscription から見て完了したか」を表す表示状態とする
- 既存 feed の再利用時に、対象 feed で `lastSuccessFetchedAt` が存在する、または article が1件以上存在する場合は、作成直後に `initialFetchStatus=ready` を返してよい
- 上記条件を満たさない場合のみ、作成直後は `fetching` を返して初回 article fetch job を投入する
- discover 完了後に同期的に初回 fetch 失敗が確定した場合のみ、作成直後 response で `initialFetchStatus=failed` と `initialFetchErrorCode` を返してよい
- 初回記事取得 job が対象 feed の fetch と article upsert を正常完了した時点で、記事件数が `0` 件でも `initialFetchStatus=ready` とする
- `initialFetchStatus=failed` は、初回記事取得 job が attempt 上限に達した場合、または再試行しても回復不能な fetch/parser/discovery failure が確定した場合に限る
- 初回記事取得が一度 `ready` または `failed` に確定した後、定常 feed refresh の成否では `initialFetchStatus` を変更しない
- 同一 feed の初回 fetch 完了結果は、その feed を待機中の current user の subscription 群にまとめて反映してよい
- `feedHealthStatus` は `feeds.status` と `feed_fetch_states` から導出し、`paused` は feed 自動更新停止、`stale` は `lastSuccessFetchedAt` が `72h` を超えて古い active feed、`healthy` はそれ以外とする
- `feed_fetch_states` が未作成、または `lastSuccessFetchedAt` が `null` の間は `initialFetchStatus=fetching` なら `healthy` として扱い、異常表示はしない
- `initialFetchStatus=failed` の subscription では `feedHealthStatus` が `healthy` でも、client は初回取得失敗表示を優先する

### GET /api/v1/subscriptions/{subscriptionId}

Returns a single subscription owned by the current user.

- response は list summary と同じく `initialFetchStatus` `initialFetchErrorCode` `feedHealthStatus` を含む

### PATCH /api/v1/subscriptions/{subscriptionId}

- request: `customTitle`

### DELETE /api/v1/subscriptions/{subscriptionId}

- `article_read_states` と `article_user_collections` は削除しない
- unsubscribe 後も `inReadingList=true` または `isBookmarked=true` の記事は保持される
- 保持条件を満たさない記事は、以後そのユーザーから参照できない

### POST /api/v1/subscriptions/{subscriptionId}/mark-all-read

フィード単位の全既読。user × feed の既読カーソル（`feed_read_cursors`）を前進させる。

- request: `{ upToArticleId?: number }`（body は省略可）
- `upToArticleId` 省略時は対象 feed の最大 article id までを既読化する
- `upToArticleId` 指定時はその article id までを既読化する。client が表示済みの最新記事 id を渡すことで、表示後に取得された記事の誤既読化を避けられる
- `upToArticleId` が対象 feed の article でない場合は `validation_error`
- カーソルは前進のみとし、現在値より小さい値の要求は no-op（応答は現在のカーソルを返す）
- カーソル前進に加え、対象範囲内の既存 `article_read_states` の未読 row も既読化する
- 記事単位の既読・未読操作は従来どおり `PATCH /articles/{articleId}/state` で行い、カーソル既読の記事も未読へ戻せる
- 対象 feed に article が1件もなくカーソル未作成の場合は `lastReadArticleId: null` を返す

```json
{
  "data": {
    "lastReadArticleId": 5501,
    "unreadCount": 0,
    "updatedAt": "2026-07-09T12:00:00Z"
  }
}
```

### POST /api/v1/subscriptions/{subscriptionId}/retry-initial-fetch

- current user's failed subscription only
- `initialFetchStatus=failed` の subscription に対してのみ受け付ける
- `initialFetchStatus` を `fetching` に戻し、`initialFetchErrorCode` を clear して非同期 initial fetch job を再投入する
- 実際の再試行処理は feed 単位の fetch を再投入し、その feed を待機中の current user の failed subscription 群に結果を反映してよい
- 対象 feed が `paused` の場合でも、この endpoint による user 主導の one-shot recovery は受け付けてよい
- one-shot recovery が成功した場合は `feeds.status=active`、`consecutive_failures=0`、`nextFetchAfter=now+30m` に戻してよい
- one-shot recovery が失敗した場合は subscription を再度 `failed` に戻し、feed は `paused` のまま維持してよい
- `ready` または `fetching` の subscription に対する再試行は `initial_fetch_retry_not_allowed` を返す
- response は更新後の subscription summary を返す

### PUT /api/v1/subscriptions/{subscriptionId}/tags

- request: `tagIds`
- replaces all tags attached to the subscription

### PUT /api/v1/subscriptions/order

- request: `subscriptionIds`
- replaces the current user's full subscription order
- all ids must belong to the current user or return `validation_error`

## Tags

### GET /api/v1/tags

Returns tags owned by the current user.

```json
{
  "data": [
    {
      "id": 3,
      "name": "AI",
      "color": "#3B82F6",
      "sortOrder": 10,
      "subscriptionCount": 4,
      "createdAt": "2026-05-11T10:00:00Z",
      "updatedAt": "2026-05-11T10:00:00Z"
    }
  ]
}
```

### POST /api/v1/tags

- request: `name`, `color`
- duplicate normalized name returns `tag_already_exists`

### GET /api/v1/tags/{tagId}

Returns a single tag owned by the current user.

### PATCH /api/v1/tags/{tagId}

- request: `name`, `color`

### DELETE /api/v1/tags/{tagId}

Deletes a tag owned by the current user.

### PUT /api/v1/tags/order

- request: `tagIds`
- replaces the current user's full tag order
- all ids must belong to the current user or return `validation_error`

## Articles

### GET /api/v1/articles/lookup

- query: `url`（必須。記事の canonical URL と完全一致で照合する）
- 購読中 feed の記事のみ対象とする（retained article は対象外）
- 該当記事がない場合は `404 article_not_found`
- response `data`: `{ id, title, canonicalUrl, sourceLanguage, inQueue }`
- `inQueue` は current user の playback queue に含まれているかを表す
- 主に browser extension が現在ページを記事として解決するために使う

### GET /api/v1/articles

- filters: `subscriptionId`, `tagId`, `read`, `readingList`, `bookmarked`, `cursor`, `limit`, `sort`
- `sort`: `published_at_desc | fetched_at_desc`
- `sort` 未指定時は current user の `settings.articleSortOrder` を適用する
- `readingList`, `bookmarked` は `true` のみ受け付け、`article_user_collections` の対応 membership を持つ記事に限定する
- `read` は実効既読状態で評価する。`article_read_states` row があればその `is_read` を正とし、なければ `feed_read_cursors.last_read_article_id >= article.id` で既読とみなす
- `userState.isRead` も同じ実効既読状態を返す（カーソル既読の記事は row がなくても `true`）
- 複数 filter 指定時は strict AND で評価する
- `read=true` は実効既読の記事を返す
- `read=false` は実効未読の記事を返す
- default article list only includes articles from current subscriptions
- `subscriptionId` 指定時は対象 subscription 配下の記事だけを返し、retained article は含めない
- `read=false` filter does not include retained article
- `readingList=true` または `bookmarked=true` の場合は、`subscriptionId` 未指定の一覧で retained article を返してよい
- retained article は default list には含めず、リーディングリスト／ブックマーク一覧でのみ返してよい
- `readingList=true&bookmarked=true` は両方を満たす記事だけを返す
- `title` は常に原文タイトルを返す。翻訳表示が必要で `article_listing_translations` が ready の場合は `translatedTitle` に翻訳タイトルを返す。`sourceLanguage` は原文言語を返す
- `previewText` は `rss_summary` を優先し、無ければ sanitize 済み `rss_content_html` の text 化結果に fallback する
- retained article は `subscriptionContext` を持たないため、`readingList/bookmarked` と `tagId` を併用した場合は返さない
- retained article では `subscriptionContext.subscriptionIds` と `subscriptionContext.tagIds` は空配列を返す

```json
{
  "data": [
    {
      "id": 5501,
      "title": "Post title",
      "translatedTitle": "翻訳済みタイトル",
      "sourceLanguage": "en",
      "canonicalUrl": "https://example.com/posts/123",
      "rssSummary": "Short summary",
      "previewText": "Preview text from RSS summary or RSS content fallback",
      "publishedAt": "2026-05-10T22:00:00Z",
      "fetchedAt": "2026-05-11T11:00:00Z",
      "feed": {
        "id": 8,
        "title": "Example Tech Blog",
        "faviconUrl": "https://example.com/favicon.ico"
      },
      "subscriptionContext": {
        "subscriptionIds": [14],
        "tagIds": [3, 5]
      },
      "userState": {
        "isRead": true,
        "inReadingList": false,
        "isBookmarked": true
      }
    }
  ],
  "meta": {
    "nextCursor": null
  }
}
```

### POST /api/v1/articles/mark-all-read

購読フィード全体（またはタグ配下のフィード群）の一括全既読。対象となる各 feed の既読カーソル（`feed_read_cursors`）をその feed の最大 article id まで前進させる。

- request: `{ tagId?: number }`（body は省略可）
- `tagId` 省略時は current user の全購読 feed を対象とする
- `tagId` 指定時はその tag が付いた subscription の feed のみを対象とする
- `tagId` が current user から不可視の場合は `tag_not_found`
- feed ごとの挙動は `POST /subscriptions/{id}/mark-all-read`（`upToArticleId` 省略時）と同じ: カーソルは前進のみ、対象範囲内の既存 `article_read_states` の未読 row も既読化する
- article が1件もない feed はカーソルを作成しない

```json
{
  "data": {
    "updatedFeeds": 12
  }
}
```

### GET /api/v1/articles/{articleId}

- current user が購読しておらず、かつ retained article でもない場合は `article_not_found` を返す
- retained article では `subscriptionContext.subscriptionIds` と `subscriptionContext.tagIds` は空配列を返す
- read API は副作用を持たず、article 実体更新は feed refresh job でのみ行う
- この endpoint は主に iOS / Android の記事リーディング画面、および retained article の再参照に使う。Web 本体の詳細 route は前提にしない
- リーディング実装は実際の Web ページを開くことを前提にしてよく、publisher への送客を損なわない

```json
{
  "data": {
    "id": 5501,
    "title": "Post title",
    "originalTitle": "Post title",
    "translatedTitle": "翻訳済みタイトル",
    "sourceLanguage": "en",
    "canonicalUrl": "https://example.com/posts/123",
    "author": "Author name",
    "rssSummary": "Short summary",
    "rssContentHtml": "<p>...</p>",
    "publishedAt": "2026-05-10T22:00:00Z",
    "fetchedAt": "2026-05-11T11:00:00Z",
    "feed": {
      "id": 8,
      "title": "Example Tech Blog",
      "siteUrl": "https://example.com",
      "faviconUrl": "https://example.com/favicon.ico"
    },
    "subscriptionContext": {
      "subscriptionIds": [14],
      "tagIds": [3, 5]
    },
    "userState": {
      "isRead": true,
      "inReadingList": false,
      "isBookmarked": true
    }
  }
}
```

## Article Contents (リーディングパート内部用)

本文抽出はリーディングパート(音読キュー)のためだけに行う。RSSリーダーパートの一覧・詳細では本文を扱わず、本文翻訳のエンドポイントは持たない(本文翻訳は各プラットフォーム / ブラウザの翻訳機能に委ねる)。

### POST /api/v1/articles/{articleId}/content

- 本文抽出をリクエストする。音読キュー追加時にクライアントが必要な範囲で呼ぶ
- request: `{ force?: boolean }`。`force=true` は既存コンテンツを破棄して再抽出する
- 抽出済みなら `{ status: "ready" }`、抽出中または新規投入時は `{ status: "pending" }` (202) を返す

### GET /api/v1/articles/{articleId}/content

- 抽出済み本文を取得する。音読キューの連続再生時に読み上げテキストとして使う
- `status` は `not_requested | pending | ready | error` を返す。`not_requested` は content row 未作成の導出状態
- response (`ready` 時): `{ status, sourceLanguage, text, html }`

## Article User State

### PATCH /api/v1/articles/{articleId}/state

```json
{
  "isRead": true
}
```

- request は `isRead` のみ必須とする
- read row がなければ作成する
- read state changes の single source of truth とする
- mutation は server が受信した順序で適用し、offline retry / multi-device 競合時は last-write-wins とする
- この方針では、遅延した古い retry が新しい操作結果を上書きしうる。MVP では version token や client operation id による厳密な競合制御は導入しない
- client は mutation を即時送信し、失敗時は画面上の再操作で回復する。retry queue やオフライン mutation は持たない
- audio playback start should mark the article as read via this endpoint
- opening the reading screen alone does not change read state
- collection membership の canonical mutation は下記専用 endpoint を使う

### PUT /api/v1/articles/{articleId}/reading-list

記事をリーディングリストへ追加する。冪等で、既存 membership の追加日時は維持する。完全な Article User State を返す。

### DELETE /api/v1/articles/{articleId}/reading-list

記事をリーディングリストから削除する。アクセス可能な間の状態遷移は冪等。未購読記事の最後の membership を削除した場合、成功応答後は不可視になり、応答消失後の同一 retry は `article_not_found` になりうる。

### PUT /api/v1/articles/{articleId}/bookmark

記事をブックマークする。冪等で、完全な Article User State を返す。

### DELETE /api/v1/articles/{articleId}/bookmark

記事のブックマークを解除する。アクセス可能な間の状態遷移は冪等。未購読記事の最後の membership を削除した場合、成功応答後は不可視になり、応答消失後の同一 retry は `article_not_found` になりうる。

## Playback Queue

端末間で共有される読み上げキュー。iOS / Android / Web + Extension のいずれかで追加・再生した状態を他端末から参照・再開できる。

### GET /api/v1/playback-queue

Returns the current user's playback queue and playback state.

- キュー内の記事は `sort_order ASC, article_id ASC` で返す
- 記事メタデータ（タイトル、フィード情報）を含めて返すため、表示に追加 API 呼び出しは不要
- タイトルは `readableLanguages` 設定に基づき翻訳済みタイトルを優先する
- `playbackState` は未作成の場合 `null` を返す

```json
{
  "data": {
    "items": [
      {
        "articleId": 5501,
        "sortOrder": 0,
        "article": {
          "id": 5501,
          "title": "翻訳済みタイトル",
          "originalTitle": "Post title",
          "sourceLanguage": "en",
          "canonicalUrl": "https://example.com/posts/123",
          "publishedAt": "2026-05-10T22:00:00Z",
          "feed": {
            "id": 8,
            "title": "Example Tech Blog",
            "faviconUrl": "https://example.com/favicon.ico"
          }
        },
        "createdAt": "2026-06-18T10:00:00Z"
      }
    ],
    "playbackState": {
      "currentArticleId": 5501,
      "contentLanguage": "en",
      "positionPercent": 0.45,
      "updatedAt": "2026-06-18T10:05:00Z"
    }
  }
}
```

### POST /api/v1/playback-queue/items

- request: `articleIds` (array of article ids, max 100)
- 既存キューの末尾に追加する
- 既にキュー内にある記事は重複追加せず無視する
- response は更新後のキュー件数を返す

```json
{
  "articleIds": [5501, 5502]
}
```

### DELETE /api/v1/playback-queue/items/{articleId}

- キューから記事を削除する
- 対象記事が `playbackState.currentArticleId` と一致する場合は再生位置をリセットする
- キューに存在しない記事の削除は成功として扱う

### PUT /api/v1/playback-queue/order

- request: `articleIds` (array of all article ids in desired order)
- キュー全件の並び順を一括更新する
- 現在のキューに含まれる全 article id を過不足なく指定する必要がある

```json
{
  "articleIds": [5502, 5501]
}
```

### DELETE /api/v1/playback-queue

- キュー全件と再生状態を削除する

### PATCH /api/v1/playback-queue/state

- 再生位置の部分更新
- `currentArticleId`: optional, キュー内の記事 id または `null`（停止）
- `contentLanguage`: optional, 再生中のコンテンツ言語または `null`
- `positionPercent`: optional, `0.0` 〜 `1.0`
- 未指定フィールドは変更しない
- `currentArticleId` を指定する場合、対象記事がキューに含まれている必要がある
- client は再生位置が変わるたびに適度な頻度（例: 10秒間隔）でこの endpoint を呼び、端末切替時の再開に備える
- 実ページ側でブラウザや OS の翻訳機能が有効な場合、`contentLanguage` には読み上げ時点で実際に読んでいる表示言語を入れてよい

```json
{
  "currentArticleId": 5501,
  "contentLanguage": "en",
  "positionPercent": 0.45
}
```

## OPML

### POST /api/v1/opml/import

- accepts a single OPML file upload via `multipart/form-data`
- creates an asynchronous import job for the current user
- import worker が missing feeds / subscriptions を作成する
- import worker は既存 subscriptions を重複作成しない
- OPML folder / category information は user tags に変換する
- same normalized tag name は同じ tag に集約する
- invalid feed URLs は skip し、job result summary に記録する
- partial success を許容する
- file size は最大 `5MB`、outline 件数は最大 `2000`
- XML external entity は無効化し、XML depth と処理時間にも上限を設ける
- job 状態は `opml_import_jobs` に保存し、response / read API の `jobId` は `opml_{id}` 形式で返す
- response は `202 Accepted` とし、job metadata を返す

```json
{
  "data": {
    "jobId": "opml_42",
    "status": "pending",
    "queuedAt": "2026-05-11T12:00:00Z"
  }
}
```

### GET /api/v1/opml/imports/{jobId}

- returns current user's OPML import job status
- response includes `status: pending | running | completed | failed`
- completed response includes counts for `created` `skipped` `failed` and optional `failures[]`
- `failures[]` は `failure_summary_json` から返す要約であり、全失敗件数の完全列挙は必須としない

### GET /api/v1/opml/export

- returns current user's subscriptions as OPML
- exports feed title and feed URL
- subscription に `customTitle` がある場合はそれを outline title に優先して使う
- subscription tags は OPML category / folder metadata として出力する

## Account

### DELETE /api/v1/account

- deletes current user's Clerk account and user-owned data
- shared feed and article data are not deleted
- server は削除要求の開始時に tombstone と account deletion cleanup job を先に記録する
- server は削除受付時に、削除進行表示専用の短期 `deletionToken` を発行して response に含める
- tombstone は削除開始時点から通常サインイン時の upsert 抑止に利用する。ただし Clerk account deletion 成功までは最終的な削除完了状態として扱わない
- tombstone / cleanup job 記録成功後に Clerk account deletion を実行する
- Clerk account deletion 成功後に user-owned data を削除する
- 受付成功時の response は常に `202 Accepted` とし、以後の Clerk deletion / app data cleanup の成否は server-side deletion job に集約する
- Clerk account deletion または app data cleanup に失敗した場合は deletion job を `failed` とし、再試行可能な server-side failure として扱う
- app data cleanup が失敗した場合は同 job を再試行し、ユーザーは再ログインで復活しない
- cleanup job の status は `pending | running | completed | failed` とし、削除受付後の tombstone と active deletion job が再作成防止の source of truth となる
- deletion 受付済み `clerk_user_id` は tombstone または同等の server-side state として保持し、通常サインイン時の upsert で再生成しない
- response は `202 Accepted` を返し、client は削除受付画面へ遷移する
- Clerk deletion と app data cleanup が完了した時点で、client は強制 logout と削除完了画面遷移を行う

```json
{
  "data": {
    "status": "pending",
    "deletionToken": "del_opaque_token",
    "queuedAt": "2026-05-11T12:00:00Z"
  }
}
```

### GET /api/v1/account/deletion-status

- returns current deletion job status for the authenticated user or a caller presenting a valid `deletionToken`
- authenticated user は current user の active deletion job を参照し、Clerk deletion 後は `deletionToken` により同一 deletion job を追跡する
- response includes `status: none | pending | running | failed | completed`
- `failed` の場合は user-facing な `retryable` boolean と簡潔な `errorCode` を返してよい
- `completed` の場合は client が強制 logout と削除完了画面遷移を行う
- active deletion job が存在しない通常ユーザーは `status=none` を返す

## Status & Manual Operations

フィード取得とタイトル翻訳はユーザーの明示操作で開始する（自動 cron 巡回は行わない）。フィード取得は enqueue 前に `feed_jobs` へ `pending` 行を記録して即応答する。タイトル翻訳は job 行を持たず、`article_listing_translations` の `pending → ready | error` 状態遷移そのものを進捗として扱う。client は `GET /api/v1/status` をポーリングし、fetch は `fetchJob` の確定、翻訳は `translation.pending` が `0` になることで完了を検知する。

### GET /api/v1/status

- current user の購読ごとの状態を返す
- response `data`:
  - `feeds`: `{ total, active, paused, lastFetchedAt }`
  - `articles`: `{ total }`
  - `translator`: `{ pending }`。current user の購読全体で翻訳キューに残っている pair 数
  - `subscriptionStatuses[]`: `{ subscriptionId, feedId, feedTitle, feedStatus, feedLanguage, lastResult, lastError, lastFetchedAt, consecutiveFailures, translation, fetchJob }`
  - `fetchJob`: `{ status, requestedAt, startedAt, finishedAt, lastError, updatedAt, stalled } | null`。`stalled` は `pending/running` のまま `10m` 以上更新されていない中断ジョブ
- `translation`: `{ articles, untranslatable, needed, ready, failed, pending, missing, lastError }`。feed の翻訳カバレッジを保存済みデータから都度算出する。`untranslatable` は原文言語不明・タイトル空で翻訳対象にできない記事数、`needed` は翻訳対象記事ごとに `ja/en/zh/ko/es` のうち原文言語と異なる言語数を合算する（原文が対応言語なら4、その他の言語なら5）、`ready`/`failed`/`pending` は `article_listing_translations` の該当状態数、`missing = max(needed − ready − failed − pending, 0)` は未投入数、`lastError` は最新の `error` 行の理由。job の主張ではなく実データだけを根拠にするため、状況を常に正確に反映する
- 手動操作後の完了検知: fetch は `subscriptionStatuses[].fetchJob` が非アクティブになること、翻訳は `translation.pending = 0`（`stalled` なジョブはアクティブ扱いしない）

### POST /api/v1/status/refresh

- current user の購読 feed の fetch job を enqueue する（202）。対象 feed ごとに `feed_jobs (kind='fetch')` を `pending` にする
- request: `{ force?: boolean }`
- `force=false` の場合は `nextFetchAfter <= now` かつ `status = active` の feed のみを対象にする（記事一覧の pull-to-refresh 用）。処理ステータス画面の「すべて取得」は `force=true` で全 active feed を対象にする
- response: `{ accepted, enqueued, skipped, queuedAt }`。`skipped` はクールダウン中で対象外になった active feed 数
- refresh worker は `consecutive_failures` を更新し、`3` 回連続 `error` で `feeds.status=paused` に遷移させる
- `error` 時の `nextFetchAfter` backoff は `15m -> 60m -> 360m` とする
- `success` と `not_modified` は成功扱いとし、`consecutive_failures=0` に reset する
- `success` 時は `nextFetchAfter=now+30m`、`not_modified` 時は `nextFetchAfter=now+120m` とする（手動更新の連打防止クールダウンとして扱う）
- worker は処理開始時に `feed_jobs` を `running`、確定時に `completed | failed` にする。`success/not_modified` は `completed`、fetch error・feed 削除済み・paused skip は `failed` とする

### POST /api/v1/status/refresh/{feedId}

- 購読中 feed 単体の fetch job を enqueue する（202）。`feed_jobs (kind='fetch')` を `pending` にする

### POST /api/v1/status/translate / POST /api/v1/status/translate/{feedId}

- current user の未翻訳タイトルの翻訳を投入する（202）。set-based SQL で不足している `(article, language)` pair を `article_listing_translations` に `status='pending'` として一括 INSERT し、既存の `error` 行を `pending` に戻し（`attempt_count=0`）、グローバル翻訳 drain を1メッセージ蹴る
- request body は無し（既存翻訳の強制再生成は提供しない）
- response: `{ accepted, enqueued, queuedAt }`。`enqueued` は投入した pair 数。翻訳結果は `article_listing_translations` に共有保存され、一覧の `translatedTitle` に反映される
- 翻訳先サポート言語は `ja` / `en` / `zh` / `ko` / `es`。原文言語（`sourceLanguage`）はこれらに限定せず保存する。翻訳対象は feed の**全記事**（新しい順）× 対応5言語のうち原文言語と異なる言語。既に `ready` の pair は再翻訳しない
- listing 翻訳では source language の事前判定値をモデルへ渡さず、`id + title` からモデル自身にタイトルごとの source language を識別させる。複数言語のタイトルは `mixed`、判定不能は `und` とし、値は可能な限り ISO 639-1 へ正規化する。`mixed`/`und` は翻訳対象外ではなく、全ターゲット言語を生成する対象として扱う

#### 翻訳 drain（`translate_drain` job）

翻訳の実行は feed 単位の job ではなく、**グローバルに1本の drain** が担う。drain は専用 queue（`filo-translate`、`max_concurrency=1`）で直列化され、`pending` 行が唯一の作業台帳になる（メッセージの重複・喪失があっても drain 再投入だけで自己修復する）。

- drain は `pending` 行を新しい順に取得し、**feed 横断で**タイトルを最大 `4` 件まで1バッチに詰め、**1リクエストでそのバッチに pending な言語すべてを翻訳**する。LM Studio の OpenAI 互換 `chat/completions` エンドポイントへ送信する。ローカルモデルではデコードが律速でバッチを大きくしても1件あたりのコストは変わらないため、バッチは1リクエストの所要時間（=タイムアウトで失う量）を抑える側に倒す
- バッチは **2本まで並行**して投げる（`CONCURRENT_BATCHES`）。デコードは共有された重みに対するメモリ帯域律速なので、2並行で1件あたりの実測が約 10s → 7.9s になる。LM Studio 側も同じ並列数で起動する必要がある（`lms load --parallel 2`）。4並行は2並行より遅い
- リクエスト/レスポンスは **行フォーマット**: 入力は `Target languages: ja en ...` に続けて `id<TAB>タイトル` を1行ずつ。出力はタイトルごとに `#id<TAB>原文言語` ヘッダ行 + 対象言語ごとの `言語コード<TAB>訳文` 行。通常の単一言語タイトルでは原文言語の行を省略し、`mixed`/`und` では全ターゲット言語の行を出力する。通常の原文言語だけは呼び出し側が原文タイトルで補完するが、`mixed`/`und` は補完しない。突き合わせはヘッダの id で行い、未知の id のヘッダは直前のタイトルに巻き込まれないよう破棄する
- モデルは稀に原文をそのまま返す（echo）ため、出力を**表示可能性の検証**にかける。空出力、翻訳対象言語が必要なのに原文を完全に echo した結果、明らかに別言語の文章だけで構成された結果は `ready` にせず、修復後も表示不可なら `pending` / `error` とする。一方、文字種の混在、固有名詞・ブランド・URL・型番の残存、短いタイトル、言語ヒューリスティックが不確かな結果は警告扱いとし、非空かつ原文完全 echo でなければ `ready` にする。警告は翻訳失敗数や `error_message` には反映しない。`sourceLang` はモデルのレスポンスに含まれる自己申告値であり、入力として与えない。`mixed` / `und` の場合は全ターゲットの翻訳行を要求し、原文の自動復元は行わない
- 失敗した pair は `attempt_count` を増やして `pending` に留め、次のパスで別組成のバッチとして自然に再試行する。`3` 回で `error` に確定し理由を `error_message` へ保存する（バッチ分割リトライ機構は持たない）
- ペーシングは**既定で無効**。LM Studio はローカルサーバでプロバイダのクォータを持たないため、バッチ間の待ちはボトルネックである実機を遊ばせるだけになる。リモートや帯域制限のある OpenAI 互換サーバへ向ける場合のみ `TRANSLATION_TOKENS_PER_MINUTE` を設定すると、各リクエスト後に `usage.total_tokens / TRANSLATION_TOKENS_PER_MINUTE` 分の待ちが入る（`TRANSLATION_PACING_MS` は下限）
- `429` は worker 内で待たず即中断し、`Retry-After`（`30..300s` に clamp）の `delaySeconds` 付きで drain メッセージを再投入する
- 1回の drain は**時間予算（約60秒）**で打ち切り、`pending` が残っていれば drain を再投入する（進捗ゼロの場合は 60 秒の遅延付きで、リクエスト枠の浪費を避ける）
- 完了・失敗の表示はすべて `GET /api/v1/status` の `translation` カバレッジ（実データ集計）から導出する。翻訳の `feed_jobs` 行・continuation カウンタは存在しない
- 中断・失敗した pair の一括再開 API は持たない。翻訳操作を再実行すると `error` 行が `pending` に戻り再試行される

処理ステータス API は本文抽出の手動起点を持たない。本文抽出が必要な場合は `POST /api/v1/articles/{articleId}/content` を使う。

## Admin Feeds

### GET /api/v1/admin/feeds

- query: `status`, `result`, `cursor`, `limit`
- returns `consecutiveFailures`, `nextFetchAfter`, `lastResult`, `lastError`, `lastSuccessFetchedAt`

### GET /api/v1/admin/feeds/{feedId}

- includes `consecutiveFailures`, `nextFetchAfter`, `lastResult`, `lastError`, `lastSuccessFetchedAt`, `httpEtag`, `httpLastModified`

### PATCH /api/v1/admin/feeds/{feedId}

- request: `status`
- `status`: `active | paused`
- `paused -> active` に戻す場合は `consecutive_failures=0` とし、`next_fetch_after=now` に更新する
- `POST /api/v1/status/refresh` の `force=true` は `nextFetchAfter` を無視するが、`paused` feed は含めない
- `POST /api/v1/subscriptions/{subscriptionId}/retry-initial-fetch` による user 主導の one-shot recovery は admin refresh とは別経路で、failed subscription の自己救済に限って `paused` feed でも許可する

### GET /api/v1/admin/feeds/{feedId}/logs

Returns fetch logs for a feed.

## Error Codes

### Common

- `unauthorized`: Clerk session 不在または無効
- `forbidden`: 認証済みだが対象 resource または endpoint class に対する権限不足
- `validation_error`: body / query / path / file validation 失敗
- `resource_not_found`: 汎用 404。domain-specific code がない場合に利用
- `conflict`: 汎用 409。domain-specific code がない重複・競合に利用
- `internal_error`: 想定外の server error
- `rate_limited`: rate limit 超過

### Domain-specific

- `subscription_already_exists`: current user が同一 feed を既に購読済み
- `subscription_not_found`: current user から対象 subscription が不可視
- `tag_already_exists`: current user 内で normalized tag name が重複
- `tag_not_found`: current user から対象 tag が不可視
- `feed_not_found`: admin または内部用途で対象 feed が存在しない
- `article_not_found`: current user が対象 article を購読中でも retained でもない
- `invalid_cursor`: cursor が不正または改ざん検知された
- `admin_required`: admin endpoint に対する admin 権限不足
- `feed_refresh_failed`: feed refresh job の投入または処理に失敗
- `feed_discovery_failed`: feed discovery で有効候補を確定できない
- `feed_unreachable`: feed または site URL へ到達できない、または timeout
- `initial_fetch_retry_not_allowed`: 初回取得 retry 条件を満たしていない subscription へ再試行した
- `opml_import_not_found`: current user から対象 OPML import job が不可視
- `language_detection_failed`: 原文言語を判定できず、対象 content の生成を開始しなかった
- `account_deletion_failed`: Clerk deletion または app data cleanup が失敗し、削除 job が `failed` になった
- `playback_queue_item_not_in_queue`: `PATCH /playback-queue/state` で指定した `currentArticleId` がキューに含まれていない
