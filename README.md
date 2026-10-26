# 志動録（SHIDOROKU）

「志を言葉にし、行動で証明する」

会員制Webアプリの新規開発用リポジトリです。現在は準備中の画面のみで、ログイン・データ保存などの機能は未実装です。

## 開発環境

- Node.js 24（`.node-version`）/ npm
- React / TypeScript / Vite
- Supabase：認証・データ保存に使用予定（接続未設定）
- Cloudflare Pages：ホスティングに使用予定（公開未設定）

## 起動と検証

リポジトリのルート（クラウド環境では `/workspace/-`）で実行します。

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

クラウド環境では、npmコマンドに `--cache /workspace/.npm-cache` を指定するか、`npm_config_cache=/workspace/.npm-cache` を設定してください。

```sh
npm run lint
npm run build
npm run preview -- --host 127.0.0.1
```

`build` はTypeScriptの型チェックと本番ビルドを実行し、`dist/` に出力します。自動テストはまだ用意していません。

## Cloudflare Pages（未公開）

- プロジェクト名：`shidoroku-dev`（予定）
- Production branch：`main`
- Framework preset：`None`
- Build command：`npm run build`
- Build output directory：`dist`
- Root directory：リポジトリルート
- Node.js：`24.19.0`（`.node-version`）

Supabaseの接続情報や環境変数は、この段階では不要です。
Git連携による自動デプロイを有効にすると、対象ブランチへのpushで公開が更新されます。プレビュー公開も含め、公開範囲とブランチ設定を確認してから有効にしてください。

## 秘密情報の管理

実際の環境変数は `.env` / `.env.local` などに保存し、Gitに追加しないでください。
秘密鍵、アクセストークン、Supabaseのsecret / service_roleキー、個人情報、DBバックアップをコミットしないでください。
環境変数の説明を追加する場合は、値のない `.env.example` を使用してください。

DB変更、GitHubへのpush、デプロイは、それぞれ内容を確認し、承認を得て実行します。
