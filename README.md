# 志動録（SHIDOROKU）

「志を言葉にし、行動で証明する」

会員制Webアプリの新規開発用リポジトリです。準備中画面、メールアドレス・パスワードによるログイン／専用会員資格の確認、本人の表示名の登録・編集を実装しています。志言の登録・編集もローカル実装済みで、専用SQLの適用成功報告を受領し、実API・RLS試験46項目も成功しています。志言の新画面の公開と実サービスへの画面保存試験はまだです。機能ごとの公開・検証状況は `docs/` を参照してください。

## 開発環境

- Node.js 24（`.node-version`）/ npm
- React / TypeScript / Vite
- Supabase：公開画面からのAuth設定取得、合成ユーザーでのRLS試験と実ログイン・会員ホーム・ログアウト試験に成功。試験用ユーザーは削除済み
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

`build` はTypeScriptの型チェックと本番ビルドを実行し、`dist/` に出力します。`test` は接続設定・会員資格判定・プロフィールの入力と保存処理を検証します。実サービスを使うテストではありません。

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

通常のトップ画面ではログインや会員情報取得を行いません。ログイン画面では下記の認証処理を使用します。セッション保存・自動更新・URL内認証トークンの処理は引き続き無効です。

### 会員ログイン（実装・公開の状態は開発記録を参照）

- `#/login`：メールアドレス＋パスワードによるログイン。一般向けの新規登録・招待・パスワード再設定はまだ提供しません。
- `#/member`：未ログインならログイン画面を表示。Authサーバーで本人を検証後、本人の `shidoroku_memberships` が `active` であることを確認して会員ホームを表示します。
- 会員行なし、停止中、不正な会員情報、通信失敗では会員ホームを表示しません。ユーザーのmetadataによる権限判定は行いません。
- フォーカス復帰・ページの再表示・60秒間隔で会員資格を再確認します。DBの操作可否はRLSが判定します。画面上の再確認に即時性の保証はありません。
- セッションはメモリ内だけで保持し、再読み込みで再ログインが必要です。ログアウトは `scope: local` を使用し、他のAuthセッションの一括ログアウトを避けます。通信失敗時も再読み込みしてブラウザ内のメモリを破棄します。サーバー発行済みJWTが即時失効する保証はありません。
- 管理者ロールでも初期画面は一般会員と同じです。本人の表示名の登録・編集のみ提供し、会員管理画面はまだ提供しません。

共有Auth、パスワード変更の影響、実装状況は `docs/login-implementation.md` と `docs/membership-design.md` を確認してください。フロントエンドの画面制御だけでAPIを保護するものではありません。
公開画面から実APIを使ったログイン試験の詳細・通信経路・未確認範囲は `docs/live-login-test-results.md` を参照してください。

### プロフィール

会員ホームで本人の `shidoroku_profiles` を読み、表示名を80文字以内で登録・変更します。初回はINSERT、更新時は表示名だけのUPDATEを使用します。更新は最後に読み込んだ `updated_at` と照合し、別の画面での新しい変更を確認なしで上書きしません。
保存の失敗・タイムアウト・更新0件では成功表示を出さず、入力を保持します。「最新情報を確認」で保存済みの状態を読み直してから再保存します。会員資格の再確認でも入力を保持し、会員資格を確認できない間は表示・保存操作を受け付けません。
ローカル実装・試験と公開状態は `docs/profile-implementation.md` を参照してください。
公開先から実Supabaseへの登録・更新・再ログイン後の保持は、合成ユーザーによる17項目の試験で確認済みです。詳細と制約は `docs/live-profile-test-results.md` を参照してください。試験ユーザーと専用データは削除済みです。

### 志言（実API試験済み・画面未公開）

本人だけが閲覧できる大切な言葉を、500文字以内・改行可能で1件登録・編集します。独立した専用テーブル `shidoroku_mottos` を使い、旧アプリの `documents` は使用しません。
専用SQLの適用成功とメタデータ検証の報告を受領し、実API試験46項目が成功しています。ユーザー承認を経てからpush・公開します。仕様・権限・検証範囲は `docs/motto-implementation.md`、実API試験は `docs/motto-rls-test-results.md` を参照してください。

### 読み取り専用の接続確認

URLに `?check=connection` を付けると専用の確認画面を開けます。通常の準備中画面は変わりません。
「接続を確認」を押したときだけ、テスト環境の `/auth/v1/settings` にPublishable key付きのGETを1回送ります。Cookieやログインセッションは送らず、リダイレクトも追従しません。10秒で中断します。
応答の設定内容・キー・エラー本文は表示せず、結果だけを表示します。成功しても、ログイン・DB権限・RLS・保存機能の動作を保証するものではありません。
自動テストは模擬応答を使います。実環境の通信成功は、公開後にこの確認画面で別途確認する必要があります。

Git連携による自動デプロイを有効にすると、対象ブランチへのpushで公開が更新されます。プレビュー公開も含め、公開範囲とブランチ設定を確認してから有効にしてください。

## 秘密情報の管理

実際の環境変数は `.env` / `.env.local` などに保存し、Gitに追加しないでください。
秘密鍵、アクセストークン、Supabaseのsecret / service_roleキー、個人情報、DBバックアップをコミットしないでください。
環境変数の説明を追加する場合は、値のない `.env.example` を使用してください。

DB変更、GitHubへのpush、デプロイは、それぞれ内容を確認し、承認を得て実行します。
