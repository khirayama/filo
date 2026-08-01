# タイトル翻訳の端末内移行（設計）

一覧タイトルの翻訳を、サーバの LLM drain から**端末内翻訳**へ移す。ゼロベースで設計し、後方互換は考えない。全クライアントを同時に更新する。

この文書は決定の記録であり、仕様の正は `SPEC/` にある（合意後に畳み込み済み）。

## 1. なぜ変えるか

現行のタイトル翻訳は Cloudflare Worker から LM Studio（`google/gemma-4-12b-qat`）へ委譲する drain である。機能としては動くが、構造的な問題を三つ抱えている。

- **デプロイ済み Worker から翻訳サーバへ到達できない。** `SPEC/OPERATIONS.md` が「ローカル LM Studio のままリモート Worker を deploy しても翻訳だけが失敗する」と明記しているとおり、本番構成が成立していない
- **生成量が本質的に 5 倍過剰。** 記事 × 対応 5 言語を先行生成している。ユーザーが実際に読むのは表示言語 1 つだけである
- **取り巻きが重い。** drain / watchdog DO / 専用 queue / coverage 集計 / 3 クライアントの進捗 UI が、翻訳そのものより大きい

本文翻訳は既に端末内（iOS: Translation framework、Android: ML Kit、Web/Extension: ブラウザ翻訳）で動いている。タイトルだけがサーバに残っている状態を解消する。

## 2. 方針

**翻訳は端末内でのみ行う。** サーバは翻訳を生成も保存もしない。

```
端末内翻訳が使える  → 判定も翻訳も端末で行う
端末内翻訳が使えない → 翻訳トグルを出さない（原文のまま）
```

サーバ経路のフォールバックは**作らない**（2026-07-28 決定）。iOS は deploymentTarget を 18 に上げたので常に Translation framework が使え、Android は ML Kit が使える。残るのは Translator API を持たないブラウザ（Safari / Firefox）だけで、そこではトグル自体を出さない。

フォールバックが要ると分かった時点で、判定も翻訳もサーバに委ねる同期 endpoint を 1 本足す（§5）。プラットフォームごとに別経路を作らないことは維持する。

### D1. 翻訳先は表示言語 1 つだけ

記事 × 5 言語の先行生成を廃止する。翻訳するのは「今表示している記事」の「表示言語」のみ。

### D2. 起動は手動トグル

一覧上部の「翻訳」トグルで起動する。言語判定による自動翻訳は行わない（`SPEC/APP.md:37`、`SPEC/READING.md:142` の既存決定を維持する）。

この決定は端末内移行後も積極的な意味を持つ。Chrome の Translator API は初回のモデル取得に user gesture を要求するため、明示操作を起点にする設計とちょうど噛み合う。Apple / ML Kit の言語パック取得も同様に、ユーザーが翻訳を求めた瞬間が最も自然な取得タイミングになる。

トグル ON の間は、スクロールで新たに表示された記事も翻訳する。トグル状態は端末ローカルに永続する（サーバ設定にしない）。

> 補足: 端末内翻訳は十分に速いため「常に自動翻訳」も技術的には現実的になった。ただし今回の変更に混ぜない。見直すなら独立した判断として扱う。

### D3. 永続キャッシュを持たない

翻訳結果を端末に永続保存しない。セッション内のメモリキャッシュ（`articleId + 表示言語` → 訳文）のみ持つ。

端末内翻訳はモデル読み込み後 1 件あたりミリ秒〜数十ミリ秒で、キャッシュ整合を管理するコストの方が高い。

### D4. 訳文は環境によって異なる

Apple / ML Kit / Chrome / サーバ LLM は別のエンジンなので、同じ記事でも端末によって訳文が変わる。これは受け入れる。共有キャッシュを捨てる代償であり、タイトル 1 行という粒度なら実害は小さい。

## 3. 言語判定

**原文言語の判定はサーバーが fetch 時に一箇所で行う**（`apps/api/src/lib/languageDetect.ts`）。クライアントは `article.sourceLanguage` をそのまま使い、自前の判定を持たない。

当初はクライアントで判定していたが、3 つの異なる判定器（`NLLanguageRecognizer` / ML Kit / `LanguageDetector`）をそれぞれの確信度スケールで調整することになり、誤判定を 3 回続けて踏んだ。判定を 1 箇所へ寄せることで、実装もテストも 1 つになる。

### 判定精度は文字数でほぼ決まる（franc-min の実測）

| 材料 | 結果 |
| --- | --- |
| 17 字のタイトル | `nld`（オランダ語）に誤判定 |
| タイトル単独（33〜47 字） | 英語 10 件中 8 件正解 |
| タイトル＋説明文（141〜191 字） | 8 言語 8/8 正解 |
| フィード全体の連結（208 字〜） | 常に正解 |

2 位とのスコア差（margin）は確信度に使えない。英語 10 件連結でも 0.080 で、スペイン語 1 件の 0.259 より小さい。margin は言語同士の近さを表すだけなので、**長さだけを信号として使う**。

### 規則

1. **フィード言語**: 発行者の申告（`<language>` / `xml:lang`）が最優先。無ければ全 item のタイトル＋説明文を連結した長文から判定し、`feeds.language_source` に `declared | detected` を残す。304 が返って文書が手に入らないフィードは、保存済み記事から同じ方法で決める
2. **記事言語**: フィード言語を事前確率とし、明確に違うときだけ上書きする
   - 仮名・ハングルがあれば文字体系で確定（他言語で使わない文字なので 1 文字で足りる）
   - 文字体系がフィードと違うときだけ、タイトル＋説明文が 140 字以上あれば判定して上書き
   - 漢字だけの記事はフィード言語のまま（日本語にも漢字だけのタイトルがある）
   - どれでもなければ `NULL`。誤った原文言語から翻訳するより、翻訳しない方が害が小さい
3. **クライアント**: `sourceLanguage` が `readableLanguages` に含まれなければ翻訳する。それだけ

### ライブラリ

franc-min（127KB、ESM）。Workers に載る現実的な選択肢はこれだけだった（tinyld 12MB / eld 9MB / cld3-asm 6.6MB は不可）。franc は以前「短いタイトルで sco/nob に誤判定」して外したが、今回は長文に食わせ、CJK は文字体系で先に確定するので、失敗した条件を踏まない。

## 4. プラットフォーム別

| | エンジン | 使えない条件 | そのときの動作 |
| --- | --- | --- | --- |
| iOS | Apple Translation framework（`TranslationSession`） | 言語ペア未対応 | そのタイトルは原文のまま |
| Android | ML Kit Translation（既存依存） | Play Services 不在、モデル取得失敗 | そのタイトルは原文のまま |
| Web | `Translator` API（Chrome / Edge 138+） | Safari、Firefox、`availability()` が `unavailable` | トグルを出さない |
| Extension | 変更なし（本文はブラウザ翻訳のまま。キューのタイトルは原文） | — | — |

実装上の注意:

- **iOS**: `TranslationSession` は SwiftUI ビューに紐づく（`.translationTask`）。原文言語ごとにまとめて `translations(from:)` に渡す。バックグラウンドでの一括翻訳はできない。deploymentTarget は 18.0 に上げた（iOS 17 は切った）。実装で踏んだ落とし穴が 3 つある:
  - **`.translationTask` はアプリ全体で 1 箇所にだけ付ける**（`ContentView` の `NavigationStack`）。画面ごとに付けると、購読詳細を開いている間は一覧画面のものと同時に生き、同じバッチに 2 つのセッションが張られて互いを畳み合う
  - **同じ言語ペアを続けて流すときは `Configuration.invalidate()` が要る。** 値が等しいと `.translationTask` が再実行されず、2 回目以降のバッチが永久に走らない
  - **`prepareTranslation()` を先に await する。** 省くと初回のモデル取得がリクエストと同じ寿命に乗り、OS の確認シートが出た直後に畳まれる
- **iOS シミュレータでは端末内翻訳を検証できない。** シミュレータには `com.apple.Translate` が入っておらず、`LanguageAvailability` は全言語ペアに `.unsupported` を返す。iOS の翻訳確認は実機で行う
- **準備画面に並べる言語は `LanguageAvailability.supportedLanguages` から作る。** アプリの表示言語 5 つに絞ると、端末が訳せる言語（オランダ語など）を準備できない
- **言語判定の候補はダウンロード済み言語に絞る（`NLLanguageRecognizer.languageConstraints`）。** 絞らないと短い英語タイトルがオランダ語やトルコ語に化け、訳せるはずの記事が対象外になる
- **その候補には「訳さない言語」（表示言語と `readableLanguages`）も必ず入れる。** 入れないと日本語のタイトルが行き場を失って簡体中国語などに化け、原文のまま出すべき記事を誤った原文言語から翻訳してしまう（実測で 14/20 件が誤判定）
- **記事を登録する前に準備状況を確認する。** トグルは端末に永続するので、2 回目以降の起動では「ON の状態で始まる」。起動時に確認を挟まないと判定候補が空のまま走り、何も訳されない
- **判定とスキップ規則は `TitleTranslationRules` に切り出してテストする（`just test`）。** 翻訳そのものはシミュレータで動かないが、判定は本物が動く。実際に出たバグはすべてこの層だったので、ここが回帰テストの置き場になる
- **ML Kit for iOS への差し替えは不可。** SDK は活発にメンテされている（GoogleMLKit 9.0.0 / 2025-06）が、arm64-iphonesimulator のスライスを配っていない（本家 issue #810 は open のまま）。導入すると Apple Silicon ではアプリ全体を x86_64 + Rosetta でビルドすることになり、「シミュレータで検証したい」という目的自体が達成できない
- **模擬翻訳（DEBUG 限定のフェイク）は入れない。** 一度入れて配線バグ 2 件を捕まえたが、Translation framework 一本に戻した。シミュレータで確認できない範囲はテスト（`just test`）と実機で埋める
- **準備画面の候補は購読しているフィードの言語から作る。** 端末の対応言語一覧は Web の Translator API では取得できない（`availability()` は言語ペアを渡す形のみ）。`feeds.language` をサーバーが決めるようになったので、3 プラットフォームで同じ出所にできる
- **言語モデルの取得は準備画面（設定 →「翻訳の準備」）でのみ行う。** 一覧のスクロール中に取得を走らせると OS の確認ダイアログが不意に割り込むうえ、失敗しても理由が伝わらない。翻訳経路では `LanguageAvailability` が `.installed` でない言語ペアを素通しし、準備画面に状態（準備済み / 未ダウンロード / 非対応）と直近のエラーを出す
- **Android**: 既存の `ReaderPageController` と同じ `Translation.getClient()` / `downloadModelIfNeeded()` の形をそのまま使う。source 言語が必須なので、判定に失敗したタイトルは翻訳せず原文のまま残す
- **Web**: `Translator.availability({sourceLanguage, targetLanguage})` を確認してから `create()`。`unavailable` のペアは原文のまま残す
- **Transformers.js は採用しない。** 数百MB のモデル取得が必要で、その負担が最も重い環境（iOS Safari）にちょうど落ちる。同じボタンが Chrome では即時、Safari では数百MB + 数十秒になる非対称は許容しない

## 5. サーバ API

翻訳の API は**持たない**。以下は、将来フォールバックが必要になった場合の設計（現時点では未実装）。

```
POST /api/v1/title-translations
```

```jsonc
// request
{
  "language": "ja",              // 表示言語（ja/en/zh/ko/es）
  "articleIds": [101, 102, 103]  // 最大 20 件
}
```

```jsonc
// response 200
{
  "data": {
    "translations": [
      { "articleId": 101, "title": "翻訳済みタイトル", "sourceLanguage": "en" },
      { "articleId": 102, "title": null, "sourceLanguage": "ja" }  // 原文言語 = 表示言語なら null
    ]
  }
}
```

- **同期**。queue も job も持たない。1 リクエスト最大 20 件、超過は 400
- 既に保存済みの訳文はそのまま返し、不足分だけモデルへ送る
- モデル呼び出しが失敗したら 503。クライアントは再試行するか原文表示に戻る。サーバ側にリトライ台帳を持たない
- 結果は `article_title_translations` に共有保存する（ユーザー間で共有。同じフィードを購読する他ユーザーにも効く）
- モデルは**到達可能なホスト型**を既定にする（Workers AI もしくは Anthropic API）。LM Studio は開発時の任意設定として残す

実際に行った変更は削除だけである。

- `GET /articles` / `GET /articles/:id` / `GET /playback-queue` から `translatedTitle` と `titleTranslationPending` を削除した。一覧エンドポイントは翻訳を一切関知しない。`sourceLanguage` は読み上げ言語の選択に使うため残した
- `POST /status/translate`、`/status/translate/:feedId`、`/status/translate/discard`、`/status/translate/:feedId/discard` を削除した
- `GET /status` から `translator` と `translation` coverage を削除した

## 6. DB

migration `0002_ondevice_title_translation.sql`:

- `article_listing_translations` を `DROP TABLE` した。翻訳テーブルは持たない
- `feeds.language TEXT`（nullable）を追加した。RSS 宣言言語を fetch のたびに保存する
- `articles.source_language` は残し、書き手を翻訳 drain から feed fetch に差し替えた

翻訳の「作業台帳」という概念自体が消えたので、`status` / `attempt_count` / `processing_at` / `error_message` も無くなった。

## 7. 削除するもの

| 対象 | 規模 |
| --- | --- |
| `apps/api/src/lib/translate.ts` | 765 行 |
| `apps/api/src/jobs/translateDrain.ts` | 291 行 |
| `apps/api/src/jobs/translationWatchdog.ts` + `translationWatchdogPolicy.ts` | 84 行 |
| `apps/api/src/lib/translationCoverage.ts` | 114 行 |
| `apps/api/test/translate.test.ts` + `translationWatchdog.test.ts` | 952 行 |
| wrangler: `TRANSLATE_JOBS` queue（producer + consumer）、`TRANSLATION_WATCHDOG` DO binding、DO migration `v1` | — |
| `routes/status.ts` の translate 系 4 エンドポイントと coverage 集計 | 約 150 行 |
| Web `StatusPage.tsx` の `TranslationBadge` / `TranslationProgress` / translate 操作 | 約 120 行 |
| iOS `StatusScreen.swift` / Android `StatusScreen.kt` の翻訳進捗 UI | 各 100 行前後 |
| `TRANSLATION_MODEL` / `LM_STUDIO_*` の必須扱い | — |

新規に書いたもの:

| 対象 | 規模 |
| --- | --- |
| iOS `Sources/TitleTranslation.swift` | 190 行 |
| Android `ui/TitleTranslator.kt` | 169 行 |
| Web `lib/titleTranslator.ts` + `components/TitleTranslationContext.tsx` | 253 行 |
| `apps/api/migrations/0002_ondevice_title_translation.sql` | 11 行 |

サーバ側の新規コードは 0 行である。

## 8. 更新したドキュメント

- `SPEC/API.md` — 翻訳 drain の節と `/status/translate` 系を削除、`/status` の翻訳フィールドを削除
- `SPEC/DATABASE.md` — 「言語と翻訳」節を書き直し
- `SPEC/OPERATIONS.md` — 翻訳 drain の運用・障害対応・環境変数・queue / DO の記述を削除
- `SPEC/APP.md` / `SPEC/SCREENS.md` — 翻訳の起動方式と端末内翻訳の位置づけ、ステータス画面から翻訳操作を削除
- `CONCEPT.md` — 翻訳方針を「端末内のみ」に
- `docs/rss-pipeline.html` — 翻訳セクション（B）を削除し、端末内翻訳の説明に差し替え
- `README.md` / `justfile` / `apps/api/README.md` / `.dev.vars.example` — LM Studio 依存の記述と `just lm-studio` を削除

## 9. 決定と積み残し

2026-07-28 に決めたこと:

1. **iOS 17 は切る。** deploymentTarget を 18.0 に上げ、`ReaderTranslationAvailability` などの OS バージョン分岐を削除した
2. **サーバ経路は作らない。** 必要になった時点で §5 の endpoint を足す
3. **品質は落ちても許容する。** ML Kit の見出し翻訳が `gemma-4-12b-qat` より劣る可能性は受け入れる
4. **`readable_languages` の既定は `["ja"]` のまま**

積み残し:

- Safari / Firefox の Web ではタイトル翻訳が使えない。トグルを出さないので壊れては見えないが、機能としては欠けている
- Extension の音読キューはタイトルを原文のまま表示する（Web 本体のキューは一覧と同じ翻訳結果を使う）
- 実機での体感（初回の言語モデル取得にかかる時間、一覧スクロール中の追従）は未計測
