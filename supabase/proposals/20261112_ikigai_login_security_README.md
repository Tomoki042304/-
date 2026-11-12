# メール確認コードによるログインの有効化

対象: https://ikigai-shidoroku.pages.dev / Supabase 本番 ebozxwiuujrnvmxienat。
実装を公開しても、以下の設定が終わるまでメール方式へ切り替わりません。
本番のメール送信設定・秘密鍵をこの資料やチャットへ記載しないでください。

## 1. Supabase の認証設定（管理画面）

- Authentication → Sign In / Providers → Email: Email provider とメール確認を有効にする。新規登録を許可する。メール確認を省略する設定にはしない。
- Email OTP expiry: **600秒（10分）**、OTP length: **8桁**。
- Rate Limits: 同一宛先への再送間隔 **60秒以上**。メール送信・OTP・検証のIP単位の制限も有効にする。OTP関連は目安 **30回/時/IP以下**、検証も **30回/時/IP以下**。送信サービス全体の上限はSMTP契約に合わせる。正当な会員の同一回線利用にも影響するため必要に応じて調整する。
- 自動アカウント統合をアプリ側では行わない。GitHub既存会員には「以前の方法で登録済みの方」を案内し、元のアカウントでログインしてもらう。Supabaseが行う既存のメール照合は認証サービスの仕様による。メールを変えて別アカウントを作ると元データは引き継がれない。
- MFA: TOTP の登録と検証を有効にする。アプリから管理者に登録画面が表示される。
- CAPTCHA: Cloudflare Turnstile を作り、ホストを `ikigai-shidoroku.pages.dev` に限定。Supabase の Bot and Abuse Protection で CAPTCHA / Turnstile を有効にし **秘密鍵**を登録する。秘密鍵はSupabaseだけに保存する。
- SMTP: 独自の送信サービスを設定し、送信ドメインのSPF/DKIMを設定・確認。Supabase標準メールは送信先や送信数に制限があるため、本番の会員登録用にそのまま使わない。
- URL Configuration: Site URL を `https://ikigai-shidoroku.pages.dev`、GitHub既存会員用のリダイレクト先もこの本番URLのみに限定する。開発用URLは本番の許可リストに追加しない。

### メールテンプレート

Authentication → Email Templates の **Confirm signup** と **Magic Link** の両方を次の内容にする。
件名: `【IKIGAI】ログイン確認コード`

```html
<h2>IKIGAIアカデミーへようこそ。</h2>
<p>次の確認コードをIKIGAIの画面に入力してください。</p>
<p style="font-size:28px;letter-spacing:4px;font-weight:bold">{{ .Token }}</p>
<p>有効期限は10分です。一度使用したコードは再利用できません。</p>
<p>このコードを他の人に教えないでください。運営がコードを尋ねることはありません。</p>
<p>お心当たりのない場合は、このメールを破棄してください。</p>
```

外部ページに進む認証リンクではなく、`{{ .Token }}` を記載する。

## 2. データベース側の管理者保護

MFA対応版のアプリ公開後、Supabase SQL Editor で同じフォルダの
`20261112_ikigai_login_security.sql` を実行する。
既存の入会・投稿・プランデータは変更しない。メンバー削除と夜間メンテナンスの既存フックを保持する。
SQLは既存フックが想定と違う場合や二重実行の場合、変更せず止まる。エラーを無視して実行しない。

SQLを適用した時点から、管理者は追加認証必須となる。開いていたアプリは一度再読み込みする。
認証アプリでの初回登録と6桁のコード入力を完了するまで、管理者のデータベース/API/Storage/Realtimeへのアクセスを拒否する。
一般会員の既存RLS（閲覧範囲・更新権限）は維持する。

確認用SQL（trueになること）:

```sql
SELECT public.ikigai_login_security_ready_v1();
```

## 3. メール方式に切り替える最後の設定

Cloudflare Pages → **ikigai-shidoroku** → Settings → Variables and Secrets の本番環境に設定する。

- `IKIGAI_LOGIN_TURNSTILE_SITE_KEY` = 手順1で作ったTurnstileの **サイトキー（公開鍵）**
- `IKIGAI_EMAIL_LOGIN_READY` = `true`

Turnstile秘密鍵やSMTPパスワードをここへ入れない。設定保存後、本番を再デプロイする。
`IKIGAI_EMAIL_LOGIN_READY=true` は、SMTP・OTP期限・試行制限・CAPTCHAを上記のとおり設定済みであることを運営が確認した印。
サーバーはこの印、サイトキー、データベース保護のインストール状態をすべて確認してからメール方式を表示する。
これらが揃わない場合は既存のログインを維持する。

## 4. 本番での受け入れ確認

- 運営が所有する受信可能な新規メールで、コード受信→アプリで入力→登録5ステップ→通知許可→完了を確認。
- 間違ったコード・使用済みコード・期限切れコードでログインできないこと。
- 短時間の再送は制限され、CAPTCHAなしの直接OTP送信要求もSupabase側で拒否されること。
- GitHub既存会員は元のUID・プロフィール・投稿・プランが保持されること。
- 管理者のメール/GitHubログインで追加認証が出ること。認証前のJWTでREST/RPC・Realtime・Storageを利用できないこと。
- 管理者の追加認証成功後、承認・プラン変更・削除などが従来どおり実行できること。
- 一般会員が管理者専用データの取得や他人の更新をできないこと。
- iPhoneはホーム画面に追加したアプリから登録し、メールアプリから戻ってもコード入力できること。

本番の実メール配信や実iPhoneの確認は、ローカルの画面テストでは代用できない。
認証サービスのログにはメールアドレス/IP等の運用情報が記録される場合がある。アプリ独自の保管先には確認コードやTOTP設定キーを保存しない。
Supabase SDKの既存のセッション保存は継続し、端末内には認証セッションが保存される。共有端末ではログアウトする。

## 緊急時の戻し方

メール配信に不具合がある場合は Cloudflare の `IKIGAI_EMAIL_LOGIN_READY` を `false` にして再デプロイ。メール方式のみを停止し、既存のログインへ戻す。管理者MFAは維持する。

管理者が認証アプリを失った場合は、本人確認をしたうえでSupabase管理画面からその本人のMFAを解除し、再登録する。一般会員向け画面に解除機能は置かない。

データベース保護そのものに障害がある場合に限り、Supabase SQL Editor（信頼された運営操作）で次を実行できる。**全管理者のMFA保護を一時停止するため、復旧後は必ずtrueへ戻す。**

```sql
UPDATE public.ikigai_login_security_state_v1 SET enforced=false WHERE id;
```

このときメール方式のready判定もfalseになり、以前のログインへ戻る。
