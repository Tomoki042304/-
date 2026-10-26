# 志動録（SHIDOROKU）

「志を言葉にし、行動で証明する」

会員制Webアプリの新規開発用リポジトリです。現在は準備中の画面のみで、ログイン・データ保存などの機能は未実装です。

## 開発環境

- Node.js 24（`.node-version`）/ npm
- React / TypeScript / Vite
- Supabase：クライアント初期化の準備済み。実接続・認証・データ保存は未検証
- Cloudflare Pages：準備中画面を公開済み（https://shidoroku-dev.pages.dev）

## 起動と検証

リポジトリのルート（クラウド環境では `/workspace/-`）で実行します。

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

クラウド環境では、npmコマンドに `--cache /workspace/.npm-cache` を指定するか、`npm_config_cache=/workspace/.npm-cache` を設定してください。

```sh
npm run lint
npm test
npm run build
npm run preview -- --host 127.0.0.1
```

`build` はTypeScriptの型チェックと本番ビルドを実行し、`dist/` に出力します。`test` は接続設定の検証と、クライアント初期化時に通信しないことを確認します。実サービスを使うテストではありません。

## Cloudflare Pages

- プロジェクト名：`shidoroku-dev`
- Production branch：`main`
- Framework preset：`None`
- Build command：`npm run build`
- Build output directory：`dist`
- Root directory：リポジトリルート
- Node.js：`24.19.0`（`.node-version`）

Supabase接続の準備には、ビルド時に次の環境変数を指定します。CloudflareではProductionに登録し、プレビュー環境には必要性と公開範囲を確認してから登録します。

- `VITE_SUPABASE_URL`：`https://imgearpizizqkutzrpuz.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY`：同じテストプロジェクトの `sb_publishable_` キー

ローカルでは `.env.example` を `.env.local` にコピーし、Publishable keyを設定します。実際のキーをGitに保存しないでください。`VITE_` の値はブラウザへ配布されるため、secret / service_roleキーは絶対に指定しないでください。設定変更後は開発サーバーの再起動、公開先では再ビルドが必要です。

接続先は上記テストプロジェクトだけを受け付け、本番候補や別URL、秘密キー形式は拒否します。設定が未登録・不正ならクライアントは `null` になり、準備中画面は表示され続けます。設定状態は内部の `supabaseConfiguration.status` で判定しますが、「configured」は通信成功を意味しません。

現在はクライアント初期化のみで、ログイン、データ取得、自動通信は行いません。セッション保存・自動更新・URL内認証トークンの処理も無効です。Authは既存アプリと共有されるため、ログイン実装前に専用の利用資格・権限設計とセッション設定を検討してください。

Git連携による自動デプロイを有効にすると、対象ブランチへのpushで公開が更新されます。プレビュー公開も含め、公開範囲とブランチ設定を確認してから有効にしてください。

## 秘密情報の管理

実際の環境変数は `.env` / `.env.local` などに保存し、Gitに追加しないでください。
秘密鍵、アクセストークン、Supabaseのsecret / service_roleキー、個人情報、DBバックアップをコミットしないでください。
環境変数の説明を追加する場合は、値のない `.env.example` を使用してください。

DB変更、GitHubへのpush、デプロイは、それぞれ内容を確認し、承認を得て実行します。
