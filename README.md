# Filo

RSS で記事を見つけ、読む・聴くことに集中する RSS リーダー。一覧タイトルの翻訳と、端末をまたいで共有される音読キューを備える。

プロダクト方針は [CONCEPT.md](./CONCEPT.md) を正とする。

## Layout

| パス | 内容 |
| --- | --- |
| `apps/api` | Cloudflare Workers + D1 + Queues + Durable Objects の API |
| `apps/web` | React + Vite の Web クライアント |
| `apps/extension` | Web を補完する Browser Extension（記事解決・読み上げ） |
| `apps/ios` | SwiftUI アプリ |
| `apps/android` | Jetpack Compose アプリ |

機能は `iOS` / `Android` / `Web + Extension` でそろえる。いずれかで未実装の機能は、その機能全体を未完了として扱う。

## Documents

- [CONCEPT.md](./CONCEPT.md) — プロダクト方針、主要機能、非目標
- [SPEC/APP.md](./SPEC/APP.md) — `SPEC` の入口。全体にまたがる共通仕様
- [SPEC/API.md](./SPEC/API.md) — HTTP API 契約
- [SPEC/DATABASE.md](./SPEC/DATABASE.md) — D1 の意図・不変条件（DDL の正は migration）
- [SPEC/SCREENS.md](./SPEC/SCREENS.md) — 画面とナビゲーション
- [SPEC/OPERATIONS.md](./SPEC/OPERATIONS.md) — 環境、デプロイ、ジョブ運用、障害対応
- [docs/rss-pipeline.html](./docs/rss-pipeline.html) — フィード取得と翻訳パイプラインの図解

推奨参照順は `CONCEPT.md -> SPEC/APP.md -> API.md / DATABASE.md / SCREENS.md -> OPERATIONS.md`。

## Run

各アプリのセットアップは `apps/*/README.md` を参照する。`justfile` から起動できる。

```bash
just api          # apps/api の dev server (http://localhost:8787)
just web          # apps/web の dev server (http://localhost:5173)
just ios          # iOS をビルドしてシミュレータで起動
just android      # Android をビルドしてエミュレータで起動
just lm-studio    # 翻訳用のローカル LM Studio を起動しモデルをロード
```

翻訳はローカルの LM Studio（OpenAI 互換 API）へ委譲する。未起動でも他の機能は動く。
