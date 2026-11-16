# 陰スタグラム 詳細設計

基本設計の F-xx・S-xx をそのまま使う。「暫定」の値は設定値として実装する。

## 0. 技術スタック
良良タイムズ・隠酒と同じ：Next.js（App Router）+ TypeScript on Cloudflare Workers（@opennextjs/cloudflare）、D1 + Drizzle、R2（`IMAGES`）、Gemini（`GEMINI_MODEL`、画像理解）、Workers Cron Trigger、Tailwind、Framer Motion。画像の縮小・陰フィルター・顔のぼかしはブラウザ（canvas）。運営は Slack ログイン（用意できるまで開発用ユーザー切替）。スマホ優先（来場者が QR から開く）。

## 1. 命名
| 日本語 | 識別子 |
|---|---|
| 端末 | device |
| 合言葉 | device_secret（ブラウザに保存）/ device_id（DB、secret の SHA-256） |
| 公開用 ID | public_id（device_id から HMAC で作る 10 文字） |
| 投稿 / 返信 | post / reply |
| 場所 | place（kind: stall 模擬店 / event 企画 / area エリア / facility 設備） |
| 情報の種類 | topic: crowd 混雑・待ち時間 / status 売り切れ・状況 / recommend おすすめ・感想 / tip 穴場・豆知識 / daily ただの日常 |
| 状態 | judging / published / rejected / held 仮非公開 / hidden / deleted |
| 運営 | admin |

## 2. 端末と認証
- 初回アクセスでブラウザが 32 バイトの乱数を作り `localStorage` に `device_secret` として保存。API には `X-Device-Secret` ヘッダで送る。サーバーは SHA-256 をとって `device_id` として扱い、secret は保存しない
- 投稿・返信・ハート・通報・削除に device が必要。閲覧は不要
- 運営：Slack OIDC（スタブ）＋開発用ユーザー切替（`DEV_LOGIN=1`）、署名付き Cookie＋D1 セッション（良良タイムズと同じ方式）、`admins` テーブル

## 3. データ設計（D1）
**settings**：key, value（festival_start, festival_end 日付。post_deadline = end + 7日、purge_at = end + 30日 は計算で出す）

**devices**：device_id（PK）, public_id（一意）, last_nickname, created_at

**daily_usage**：device_id, date（JST）, post_count。(device_id, date) 一意。上限 10

**places**
| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | |
| name | TEXT | 例「機械系 焼きそば」 |
| kind | TEXT | stall / event / area / facility |
| x, y | REAL | マップ画像上の 0〜1 座標 |
| description | TEXT / null | |
| is_active | INTEGER | |

**map**：key='current', image_key（R2 `map/{uuid}.png`）, width, height

**judge_tokens**（判定と加工の紐付け）：token, device_id, width, height, image_hash（端末で計算した縮小画像の SHA-256）, kira_score, kira_reason, faces（JSON）, expires_at（10分）, used_at

**posts**
| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | 公開 URL は id をそのまま使う（UUID） |
| device_id | TEXT | |
| nickname | TEXT | 20字 |
| caption | TEXT | 40字 |
| place_id | TEXT / null | |
| topic | TEXT | crowd / status / recommend / tip / daily |
| image_key | TEXT | R2 `posts/{id}.jpg`（陰化・ぼかし済み） |
| width, height | INTEGER | |
| kira_score | INTEGER | 0〜100 |
| kira_reason | TEXT | 例「ピースが眩しすぎる」 |
| heart_count | INTEGER | |
| reply_count | INTEGER | |
| report_count | INTEGER | |
| status | TEXT | published / held / hidden / deleted（rejected は保存しない） |
| created_at | TEXT | |

**replies**：id, post_id, device_id, nickname, body（40字）, report_count, status, created_at

**hearts**：post_id, device_id, created_at。(post_id, device_id) 一意

**reports**：id, target_type（post / reply）, target_id, device_id, reason（inappropriate / face / spam / other）, created_at。(target, device) 一意

**hashtags**：tag（小文字・全角半角を正規化）, post_id / reply_id, created_at

**admins**：id, slack_user_id, display_name, is_active ／ **sessions**：id, admin_id, expires_at

## 4. 投稿の流れ
1. S-02 で写真を選ぶ → ブラウザで長辺 1600px に縮小・EXIF 削除 → SHA-256 を計算
2. `POST /api/judge`（multipart：縮小画像、caption、nickname）→ 1日の上限・期間を確認 → Gemini に1回送る
   - 出力（JSON）：`{ ok: bool, reject_reason?: "inappropriate"|"personal_info"|..., kira_score: 0-100, kira_reason: "20字以内・陰キャ目線のツッコミ", faces: [{x,y,w,h}] }`
   - 指示：「技大祭の SNS の投稿チェック。写真と一言が公序良俗に反する・個人情報（名札・連絡先）を含む・他人を攻撃する場合は ok=false。キラキラ度は、自撮り・ピース・加工感・スイーツ・夜景・集合写真の盛り上がりなど『映え』の度合いで採点。理由は短く、ちょっと皮肉っぽく、でも悪意なく。人の容姿について述べない。顔はすべて返す」
   - ok=false なら 422（大まかな理由だけ返す）。画像はどこにも保存しない
   - ok=true なら judge_tokens を作り、token・kira_score・kira_reason・faces を返す
3. ブラウザで陰フィルター（§5）と顔のぼかしをかけ、S-03 で陰化アニメーションを見せる
4. `POST /api/posts`（multipart：加工後の画像、token、place_id、topic）→ token の有効期限・未使用・寸法を確認 → R2 に保存 → posts 作成、hashtags 抽出、daily_usage +1
   - 加工前のハッシュは判定時に、加工後は寸法のみ照合（加工で内容が変わるため）。token は1回きり

## 5. 陰フィルター（ブラウザ）
- 強さ s = kira_score / 100（最低 0.15 はかける）
- 彩度：1 − 0.8s 倍／明るさ：1 − 0.35s 倍／コントラスト：1 − 0.2s／青緑寄りの色かぶりを 0.15s／粒子ノイズ 振幅 12s／周辺減光 強さ 0.6s
- 顔：faces の各枠を 1.2 倍に広げ、ガウスぼかし相当（縮小→拡大のモザイク＋ぼかし）
- 判定は顔が見つからなくても通す（見落とし時は通報で対応）

## 6. 並び順と状況
- 新しい順：created_at 降順
- 人気順：`heart_count / (経過時間[h] + 2)^1.5`（暫定）
- 陰度順：kira_score 降順（同点は新しい順）
- マップの状況：place ごとに topic が crowd / status の最新の公開投稿。30分以内は通常、2時間以内は薄く、それ以上は表示しない（`STATUS_FRESH_MIN=30`, `STATUS_STALE_MIN=120`）

## 7. API 一覧
| メソッド | パス | 用途 |
|---|---|---|
| GET | /api/posts?sort=new\|popular\|kage&topic=&tag=&place=&cursor= | タイムライン。本人の投稿には heart_count を返さない（null） |
| GET | /api/posts/{id} | 投稿の詳細と返信 |
| POST | /api/judge | 判定（§4-2） |
| POST | /api/posts | 投稿（§4-4） |
| DELETE | /api/posts/{id} | 本人の削除 |
| POST/DELETE | /api/posts/{id}/heart | ハートを付ける・外す（本人の投稿は 400） |
| POST | /api/posts/{id}/replies | 返信（AI チェック付き） |
| DELETE | /api/replies/{id} | 本人の削除 |
| POST | /api/reports | 通報（3件で held） |
| GET | /api/places, /api/places/{id} | 場所一覧（状況付き）、場所の詳細 |
| GET | /api/map | マップ画像の URL と寸法 |
| GET | /api/users/{public_id} | ニックネームごとの一覧 |
| GET | /api/me | 自分の public_id、今日の残り枚数、期間の状態 |
| GET/POST | /api/admin/reports, /api/admin/{posts\|replies}/{id}/hide\|restore | 運営 |
| GET/POST/PATCH | /api/admin/places, /api/admin/map | 場所・マップ |
| GET/PATCH | /api/admin/settings | 開催期間 |

- エラー形式は他の2つと同じ。期間外の投稿は 403（`out_of_period`）、上限超過は 429
- device ごとのレート制限：判定は 1分に3回（暫定）

## 8. 画面（スマホ優先）
- 下部ナビ：タイムライン／マップ／＋投稿／自分（S-08 の自分のページ）
- S-01：上部に並び替えタブ（新しい・人気・陰度）と種類のチップ。投稿カード＝陰化写真、ニックネーム、場所・種類のバッジ、一言（#タグはリンク）、キラキラ度メーターと理由、ハート（本人の投稿は「♡ 数は見えません」）、返信数
- S-02：写真（カメラ起動・選択）、ニックネーム（前回の値）、一言（40字カウンタ）、場所（マップから選ぶ／名前で検索／なし）、種類のチップ、注意書き「写真は判定と加工のため AI（Gemini）に送られます。顔はすべてぼかされます。元の写真は保存されません」、今日の残り n / 10
- S-03：「キラキラ度を測っています…」→ 点数のカウントアップ、理由、ビフォー（端末内だけ）からアフターへ色が抜けていくアニメーション、「投稿する」「やめる」
- S-04：写真、一言、場所リンク、種類、キラキラ度、ハート、返信一覧と入力、通報（理由選択）、本人なら削除
- S-05：マップ画像をピンチで拡大。ピン＝場所の種類のアイコン、状況の色（混雑＝赤、売り切れ＝灰、なし＝白）、薄さで鮮度。押すとシートで要約 → S-06
- S-06／S-07／S-08：S-01 と同じカードの一覧
- 期間前・締切後：投稿ボタンを無効にし案内。全削除後はトップに「今年の陰スタグラムは終了しました」

## 9. 定期処理（Cron、毎日 4:00 JST）
- purge_at を過ぎたら posts・replies・hearts・reports・hashtags・judge_tokens と R2 の画像を全削除
- 期限切れの judge_tokens、7日より古い daily_usage を削除

## 10. 開発の順番
1. 土台（スキーマ、端末の合言葉、運営の開発用ログイン、シード：架空の場所 12 件・マップ画像・投稿 20 件）
2. 投稿の流れ（S-02, S-03、判定 API。キーなしでは決定的なダミー判定）、陰フィルター
3. タイムライン・詳細・ハート・返信・通報・削除（S-01, S-04）
4. マップ・場所・タグ・ニックネーム（S-05〜S-08）
5. 運営画面・期間・Cron（S-10〜S-13）
