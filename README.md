# 陰スタグラム（KageSutagram）

技大祭期間限定の写真SNSです。詳細設計10章の手順1〜5を実装しています。日本語UI、スマートフォン向けの灰青色の画面です。設計書の複製は `docs/01-requirements.md`〜`03-detailed-design.md` にあります。

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

http://localhost:3300 で利用できます。公開閲覧・写真投稿にログインは不要です。運営は `/admin/login` の「開発ログイン」を使います。Slack OIDC は501を返すスタブです。

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

| 変数 | 用途 |
|---|---|
| `DEV_LOGIN` | 開発用ログインは `1`。さらに `APP_ENV=local` と `NODE_ENV=development` が必要 |
| `APP_ENV` | ローカルは `local`、Worker設定の既定値は `production` |
| `SESSION_SECRET` | 運営CookieのHMAC署名。32文字以上 |
| `DEVICE_ID_SECRET` | 端末IDから公開IDを作るHMAC鍵。32文字以上。運用途中の変更は公開IDの継続性に影響する |
| `GEMINI_API_KEY` | 未設定なら外部送信しないオフラインモード |
| `GEMINI_MODEL` | 判定モデル。既定値 `gemini-2.5-flash` |
| `STATUS_FRESH_MIN` | 状況を通常表示する分数。既定値30 |
| `STATUS_STALE_MIN` | 状況を地図から外す分数。既定値120 |

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

`pnpm test` はフィルターの数式、人気度、鮮度、タグ、本人へのハート数非表示（API含む）、通報閾値、トークン、JST期間・日次上限、Gemini JSON、Cronの削除順と失敗時の再試行を検証します。

開発サーバーを3300番で起動し、別ターミナルで以下を実行します。

```powershell
Set-Location 'C:\Users\kamij\Documents\NUT\NUTFES\nutmeg-hackathon-2026\kagesutagram'
node scripts/smoke.cjs
pnpm exec tsx scripts/verify-limits.ts
```

`smoke.cjs` はリポジトリ内のplaywright-coreとインストール済みChromeを使い、生成写真で判定→陰化→投稿、別端末のハート・返信、タグ・場所・ユーザー、通報によるheld、運営の復帰・マップ・場所・期間、本人削除まで確認します。390px幅の横はみ出しとブラウザ例外も確認します。検証画像は `.wrangler/verification/` に保存します。`KAGE_URL` と `CHROME_PATH` で接続先とChromeを変更できます。スモークで登録した架空の場所やマップ・返信・通報はローカルに残ります。

`verify-limits.ts` は実DB/APIで判定レート、期限・寸法・単回トークン、同時投稿時の上限、期間外403を確認します。検証用の投稿・トークン・使用記録は削除し、開催設定を元に戻します。

整形は `pnpm exec prettier --write src scripts tests`。D1のトリガーは `drizzle/0001_integrity.sql` にあり、ハート・返信・通報の件数、判定トークンの消費と日次加算を更新します。
