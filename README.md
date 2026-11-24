# 陰スタグラム（KageSutagram）

技大祭期間限定の写真SNSです。詳細設計10章の手順1〜5を実装しています。日本語UI、スマートフォン向けの落ち着いたダーク配色と、同梱したBIZ UDPGothicを使用します。設計書の複製は `docs/01-requirements.md`〜`03-detailed-design.md` にあります。

## セットアップ

Node.js 22、pnpm 10.23 を使用します。兄弟アプリと同じ Next.js 16.4.6、React 19.3.1、OpenNext 1.20.17、Drizzle 0.44.7 をロックしています。

```powershell
Set-Location 'C:\Users\kamij\Documents\NUT\NUTFES\nutmeg-hackathon-2026\kagesutagram'
Copy-Item .dev.vars.example .dev.vars
pnpm install
pnpm db:migrate:local
pnpm db:seed
pnpm typecheck
pnpm test
pnpm build
pnpm dev --port 3300
```

http://localhost:3300 で利用できます。公開閲覧・写真投稿にログインは不要です。運営は `/admin/login` の「開発ログイン」を使います。Slack OIDC は `inshu/src` の検証済み実装を移植しています。

この環境で pnpm が PATH にない場合、`pnpm` を `& ../.tools/node_modules/.bin/pnpm.cmd` に置き換えます。OSのユーザー情報取得が失敗する制限付きWindows環境では、上のコマンドの前に以下を実行してください。ユーザーの設定ファイルは変更しません。

```powershell
Set-Location 'C:\Users\kamij\Documents\NUT\NUTFES\nutmeg-hackathon-2026\kagesutagram'
$env:NODE_OPTIONS='--require=C:\Users\kamij\Documents\NUT\NUTFES\nutmeg-hackathon-2026\kagesutagram\scripts\windows-userinfo.cjs'
$env:XDG_CONFIG_HOME='C:\Users\kamij\Documents\NUT\NUTFES\nutmeg-hackathon-2026\kagesutagram\.wrangler\config'
$env:WRANGLER_LOG_PATH='C:\Users\kamij\Documents\NUT\NUTFES\nutmeg-hackathon-2026\kagesutagram\.wrangler\logs'
$env:WRANGLER_SEND_METRICS='false'
```

D1 `DB` とR2 `IMAGES` のローカルデータは `.wrangler/state/v3/` に保存します。マイグレーションは `--local` 固定です。シードは架空の運営、開催期間（初回実行日を含む）、場所12件、生成マップ、陰化済みの生成写真20件、返信・ハート・通報を作ります。再実行で投稿や期間を重複登録せず、サンプル画像を再生成します。開催期間は `/admin/settings` から変更できます。

## 環境変数

| 変数                                      | 用途                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `DEV_LOGIN`                               | 開発用ログインは `1`。さらに `APP_ENV=local` と `NODE_ENV=development` が必要                                   |
| `APP_ENV`                                 | ローカルは `local`、Worker設定の既定値は `production`                                                           |
| `SESSION_SECRET`                          | 運営CookieのHMAC署名。32文字以上                                                                                |
| `DEVICE_ID_SECRET`                        | 端末IDから公開IDを作るHMAC鍵。32文字以上。運用途中の変更は公開IDの継続性に影響する                              |
| `GEMINI_API_KEY`                          | 未設定なら外部送信しないオフラインモード                                                                        |
| `GEMINI_MODEL`                            | 判定モデル。既定値 `gemini-2.5-flash`                                                                           |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | SlackアプリのOIDCクライアント情報                                                                               |
| `SLACK_TEAM_ID`                           | 許可するSlackワークスペースのチームID                                                                           |
| `APP_BASE_URL`                            | サイトの公開オリジン。例 `https://kage.example.com`。OIDCコールバックと印刷用QRに使用。パス・末尾スラッシュなし |
| `STATUS_FRESH_MIN`                        | 状況を通常表示する分数。既定値30                                                                                |
| `STATUS_STALE_MIN`                        | 状況を地図から外す分数。既定値120                                                                               |

`.dev.vars.example` の鍵はローカル用の例です。実運用では別の秘密を設定します。リモートCloudflare・Slack・GitHub・実Geminiとの疎通やデプロイは今回行っていません。

## 操作とオフラインモード

- 写真はブラウザで長辺1600pxへ縮小し、JPEGに再エンコードしてEXIFを除去します。縮小後の画像とSHA-256を判定APIへ渡します。判定APIは元画像をR2に保存しません。
- キーなしでは画像の明るさ・彩度から決定的に点数を計算し、皮肉の理由とダミーの顔枠を返します。返信はブロックリストで確認します。これは実際の安全性や顔を認識するモードではなく、架空素材を使った開発用です。
- 判定後は設計の彩度・明るさ・コントラスト・青緑の色かぶり・粒子・周辺減光を適用し、顔枠を1.2倍に広げてモザイクとぼかしをかけます。点数のカウントアップと元写真から陰化写真へのアニメーションを表示し、確認後に加工画像だけを投稿します。
- 判定結果と画像はブラウザのメモリで画面遷移を引き継ぎます。結果画面の再読み込み・タブ終了では再判定が必要です。判定トークンは10分・1回限り。投稿APIは元画像ハッシュ、端末、実画像の寸法を確認します。設計どおり加工画像の内容自体の暗号学的な検証はしません。
- 初回に32バイトの合言葉を `localStorage.device_secret` に保存します。DBにはSHA-256だけを保存し、公開URLには別のHMAC公開IDを使います。端末データを消すと、過去の自分の投稿を削除できなくなります。
- 投稿はJSTで1日10枚、判定は端末ごとに1分3回です。開催開始から終了7日後まで投稿・返信できます。終了30日後は閲覧を終了します。
- 本人には一覧・詳細・場所・タグ・ユーザーページのAPIでもハート数を `null` で返します。運営の通報APIもハート数を返しません。別端末には数を表示します。
- 場所は検索・リスト・マップから選択できます。マップの状況は公開中の混雑・状況投稿だけを使い、古い状況を薄く表示します。通報は端末ごとに重複を防ぎ、3件で仮非公開。運営が非公開・公開復帰できます。
- JPEG/PNGに対応します。他の形式はブラウザでデコードできる場合にJPEGへ変換します。

## 自動削除とWorker

`worker.ts` はOpenNextのHTTPハンドラに `scheduled` を追加します。CronはUTC 19:00（JST翌朝4:00）です。終了30日後にR2全画像、投稿・返信・ハート・通報・タグ・判定・端末データを削除します。R2を先に削除し、失敗時はDBを残して再試行します。毎回、期限切れトークン、7日より古い使用記録、期限切れセッションも整理します。マップは削除対象、場所の定義・開催設定・運営登録は残ります。

```powershell
Set-Location 'C:\Users\kamij\Documents\NUT\NUTFES\nutmeg-hackathon-2026\kagesutagram'
pnpm cleanup:local
pnpm build:worker
```

`cleanup:local` は現在の開催設定に従ってローカルデータを削除します。`build` はNext.jsビルド、`build:worker` はWorkerのパッケージ生成用です。

この制限付きWindows環境では、Next.jsの `build` は成功しましたが、OpenNextの `build:worker --skipNextBuild` は設定ファイルを解決するesbuildで `Access is denied` となりました。Workerパッケージの生成・実Worker上のCron起動は未検証です。通常の権限を持つ対応環境（WSLなど）でのパッケージ生成確認が残ります。

## 検証

`pnpm test` はSlack OIDCのRSA署名・JWKS・claim・state/nonce・期限・チーム・未登録/無効な運営拒否・セッション発行、およびフィルターの数式、人気度、鮮度、タグ、本人へのハート数非表示（API含む）、通報閾値、トークン、JST期間・日次上限、Gemini JSON、Cronの削除順と失敗時の再試行を検証します。

開発サーバーを3300番で起動し、別ターミナルで以下を実行します。

```powershell
Set-Location 'C:\Users\kamij\Documents\NUT\NUTFES\nutmeg-hackathon-2026\kagesutagram'
node scripts/smoke.cjs
pnpm exec tsx scripts/verify-limits.ts
```

`smoke.cjs` はリポジトリ内のplaywright-coreとインストール済みChromeを使い、生成写真で判定→陰化→投稿、別端末のハート・返信、タグ・場所・ユーザー、通報によるheld、運営の復帰・マップ・場所・期間、本人削除まで確認します。375px幅の横はみ出しとブラウザ例外、初回トップアクセス時の端末生成、印刷用QR全件の独立デコーダー（jsQR）によるURL読み取り、期間前・受付終了・全削除後の表示（レスポンス差し替え）も確認します。検証画像は `.wrangler/verification/` に保存します。`KAGE_URL` と `CHROME_PATH` で接続先とChromeを変更できます。スモークで登録した架空の場所やマップ・返信・通報はローカルに残ります。

`verify-limits.ts` は実DB/APIで判定レート、期限・寸法・単回トークン、同時投稿時の上限、期間外403を確認します。検証用の投稿・トークン・使用記録は削除し、開催設定を元に戻します。

整形は `pnpm exec prettier --write src scripts tests`。D1のトリガーは `drizzle/0001_integrity.sql` にあり、ハート・返信・通報の件数、判定トークンの消費と日次加算を更新します。

## Slack運営ログイン

SlackアプリにはOIDCのリダイレクトURL `{APP_BASE_URL}/api/auth/slack/callback` を登録します。スコープは `openid profile email` です。上記4変数と32文字以上の `SESSION_SECRET` を設定してください。HTTPSが必須で、ローカル開発のlocalhost/127.0.0.1のみHTTPを許可します。

ログインは `/admin/login` → `/api/auth/slack/login` から開始します。10分の署名付きHttpOnly Cookieでstate/nonceを保持し、SlackのJWKSでIDトークンのRSA署名、issuer/audience、有効期限、チームを検証します。Cookieはコールバックで消費します。`admins.slack_user_id` に登録済みで `is_active=1` の運営だけがログインできます。シードのFAKE_ADMINは実Slackには使えません。運営登録は既存adminsテーブルを管理者が設定します。無効/未登録のアカウントは自動登録しません。認証後は既存セッションを破棄し、署名Cookie＋D1セッションを発行します。未設定・認証失敗・未登録は日本語の案内付きログイン画面へ戻ります。開発ログインの制約は従来どおりです。

テストは鍵をローカル生成してSlack応答をモックします。実Slack・実Gemini・リモートCloudflareには接続していません。

## QRの印刷とデザイン検証

運営ログイン後、`/admin/qr` でトップと公開中の全場所（`/places/{id}`）のQRを生成します。「印刷する」でA4・2列の切り取り枠付きレイアウトになります。QR生成はブラウザ内で完結し、外部QRサービスへURLを送りません。配布する前に `APP_BASE_URL` を公開URLへ設定してください。未設定時はアクセスしたサイトのオリジンを使用します。

配色はTask 08のトークンを使用し、16px余白、投稿カード、選択チップ、カメラロゴ、下部ナビ、地図の状況ピンとシートを適用しています。ピンの見た目は18px、操作領域は44pxです。古い状況は薄く表示し、おすすめ/穴場はmint、売り切れはsoldout、混雑はcrowdです。投稿画面では場所・情報の種類をチップで選べます。結果は加工前（端末内のみ）と加工後を並べ、約1.2秒で彩度と粒子が変化します。

スモークが `.wrangler/verification/S-01-timeline-375.png`、`S-02-post-375.png`、`S-03-result-375.png`、`S-05-map-375.png`、`S-06-place-375.png` と `admin-qr-print.png` を保存します。

## デモ環境のセットアップ

デモ専用の Cloudflare 環境に `SESSION_SECRET`（32文字以上）と `DEMO_PASSCODE`（16文字以上）を Worker のシークレットとして設定します。陰スタグラムには `DEVICE_ID_SECRET`（32文字以上）も必要です。デモ用ログインでは、シードで登録した架空アカウントを選べます。パスコードの入力を同じ IP から10分間に30回誤ると、最初の失敗から10分が経過するまでログインが制限されます。

以下のコマンドはアプリのディレクトリで実行します。`<db>` はデモ専用の本番 D1 データベース名に置き換えてください。SQL の生成はローカルで行われ、再適用しても既存のシード行は維持されます。

```sh
pnpm demo:seed-sql
pnpm exec wrangler d1 migrations apply <db> --remote
pnpm exec wrangler d1 execute <db> --remote --file demo/seed.sql
```


`demo/r2-manifest.txt` は、R2 のキー、ファイルパス、Content-Type をタブで区切った一覧です。各行の値を使い、マップと投稿画像を本番 R2 にアップロードします。

```sh
pnpm exec wrangler r2 object put <bucket>/<key> --file <file> --content-type <type> --remote
```

ローカル D1 で SQL を検証する場合は、次のコマンドを使います。

```sh
pnpm exec wrangler d1 migrations apply kagesutagram-local --local --persist-to .wrangler/demo-check
pnpm exec wrangler d1 execute kagesutagram-local --local --persist-to .wrangler/demo-check --file demo/seed.sql
```

## デモ用ログインの注意

- `DEMO_PASSCODE` は、本番とは別のデモ専用の Worker・D1 にだけ設定する。Slack ログインの設定（`SLACK_*`）がある環境には入れない（架空の責任者・編集部が、本物のユーザーに権限を付けられてしまうため）
- パスコードはランダムな文字列にする（例：`openssl rand -base64 24`）
- 本番に移るときは `DEMO_PASSCODE` を削除し、`FAKE_` で始まる架空データを D1 から消す
