# Filo

RSS で記事を見つけ、一覧タイトルを端末内で翻訳して読む RSS リーダー。

プロダクト方針は [CONCEPT.md](./CONCEPT.md) を正とする。

## Layout

| パス | 内容 |
| --- | --- |
| `apps/api` | Cloudflare Workers + D1 + Queues + Durable Objects の API |
| `apps/web` | React + Vite の Web クライアント |
| `apps/extension` | Browser Extension（Webのリーディングリスト閲覧・読み上げ） |
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
- [docs/rss-pipeline.html](./docs/rss-pipeline.html) — フィード取得パイプラインの図解

推奨参照順は `CONCEPT.md -> SPEC/APP.md -> API.md / DATABASE.md / SCREENS.md -> OPERATIONS.md`。

## Run

各アプリのセットアップは `apps/*/README.md` を参照する。`justfile` から起動できる。

```bash
just api          # apps/api の dev server (http://localhost:8787)
just web          # apps/web の dev server (http://localhost:5173)
just ios          # iOS をビルドしてシミュレータで起動
just android      # Android をビルドしてエミュレータで起動
```

翻訳は端末内で行う（iOS: Translation framework、Android: ML Kit、Web: ブラウザ組み込みの Translator API を優先し、非対応ブラウザでは Transformers.js + ONNX Runtime Web の WASM フォールバック）。サーバーは翻訳を生成も保存しない。対象機能は、購読管理、RSS記事一覧、既読／ブックマーク、一覧タイトル翻訳です。
