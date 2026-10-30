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

JavaScript/TypeScript アプリは Node.js 24 LTS / npm 11 を使用する。`nvm use` で
Node.js のメジャーバージョンを合わせ、`npm install --global npm@11.9.0` で npm を合わせる。

```bash
just install      # API / Web / Extension を lockfile どおりに npm ci
just check        # 型検査、Web の lint、API / Web のテスト
just audit        # 開発用を含む npm 依存関係の脆弱性検査
```

Web は `apps/web/.env.development.example`、拡張機能は
`apps/extension/.env.development.example` をそれぞれ同じディレクトリの
`.env.development.local` にコピーして起動する。本番ビルドは `.env.production.example`
を参考に設定する。API は `apps/api/README.md` を参照する。

GitHub Actions でも各アプリを `npm ci` から検証し、クライアントの開発・本番ビルドと
脆弱性検査を行う。週次でも実行し、Dependabot で npm / Gradle / Actions の更新を確認する。

Web の Transformers.js は Safari での翻訳互換性のため 3.8.1 を維持している。
その Node.js 用画像処理依存 `sharp` は、脆弱性を解消した 0.35.5 以降に限定して
override する。ブラウザ用ランタイムには含まれない。Transformers.js を更新するときは
Safari の翻訳動作とともに、この override が不要になったかを確認する。

各アプリのセットアップは `apps/*/README.md` を参照する。`justfile` から起動できる。

```bash
just api          # apps/api の dev server (http://localhost:8787)
just web          # apps/web の dev server (http://localhost:5173)
just ios          # iOS をビルドしてシミュレータで起動
just android      # Android をビルドしてエミュレータで起動
```

翻訳は端末内で行う（iOS: Translation framework、Android: ML Kit、Web: ブラウザ組み込みの Translator API を優先し、非対応ブラウザでは Transformers.js + ONNX Runtime Web の WASM フォールバック）。サーバーは翻訳を生成も保存しない。対象機能は、購読管理、RSS記事一覧、既読／ブックマーク、一覧タイトル翻訳です。
