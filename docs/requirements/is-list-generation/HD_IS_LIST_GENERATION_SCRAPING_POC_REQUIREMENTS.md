# HD AIアシスタント｜IS リスト生成 スクレイピング自動化 PoC 要件書

## 1. 所属

今回の機能はFSではない。

```text
HD AIアシスタント
└── IS
    └── リスト生成
        └── 自動取得
```

として実装する。

FS商談支援、FS案件管理、FSトークスクリプトとは分離すること。

---

## 2. 目的

現在人間が行っているIS向け営業リスト生成作業を、
まず「1エリア × 1ジャンル」で自動化する。

```text
Google Driveの市区町村
↓
Google Maps取得
↓
食べログ取得
↓
RAW保存
↓
正規化
↓
2媒体統合
↓
重複排除
↓
チェーン・対象外除外
↓
電話番号なしだけ補完
↓
既存Comdesk形式CSV生成
↓
対象市区町村のDriveへ保存
↓
STOP
```

PoCではComdesk本番投入はしない。

---

## 3. 対象リポジトリ

```text
/Users/maekawahiroyuki/hd-system-auto
```

既存コードを最優先で再利用する。

対象:
- Google Maps取得
- 食べログ取得
- Playwright
- JSONL保存
- 重複排除
- チェーン除外
- 対象外除外
- SerpAPI等の電話番号補完
- Google Drive保存
- Comdesk CSV生成
- Comdesk importer

別システムをゼロから作らない。

---

## 4. Google Drive

既存ルート:

```text
https://drive.google.com/drive/folders/1EVUOKS-sIIWSy5J_WXEh2fAg6ip5rnsS
```

folder id:

```text
1EVUOKS-sIIWSy5J_WXEh2fAg6ip5rnsS
```

ルート直下の市区町村フォルダをエリアマスターとして扱う。

HD側で市区町村マスタを二重管理しない。

確認済み例:

```text
伊豆市/
├── 静岡県伊豆市
├── CSV投入フォルダ/
├── 処理済みフォルダ/
└── 完成版CSVエクスポート/
```

既存Driveファイル・フォルダを移動、改名、削除しない。

---

## 5. IS UI構成

HD AIアシスタントのIS配下に以下を設ける。

```text
IS
├── リスト生成
│   ├── 自動取得
│   ├── 実行中ジョブ
│   ├── 完了リスト
│   └── 除外ルール
├── Comdesk
├── 架電
├── 前確
├── アポ管理
└── KPI
```

今回PoCで最低限実装するのは:

```text
IS > リスト生成 > 自動取得
```

画面例:

```text
リスト自動取得

対象エリア
[ 伊東市 ▼ ]

ジャンル
[ 居酒屋 ▼ ]

取得媒体
☑ Google Maps
☑ 食べログ

処理
☑ 重複排除
☑ チェーン除外
☑ 対象外除外
☑ 電話番号補完
☑ Comdesk CSV生成

[ テスト実行 ]
```

実行中:

```text
伊東市 / 居酒屋

Google Maps   143件
食べログ       82件
統合後         171件
重複除外       -29件
チェーン除外   -11件
対象外          -8件
電話補完       12件
最終           123件

現在: 電話番号補完中
```

操作:
- 一時停止
- 再開
- 中止
- ログ確認

---

## 6. コード名前空間

FS配下へ置かない。

新規コードは既存構成に合わせつつ、
以下の名前空間を優先する。

```text
src/is/list-generation/
config/is/list-generation/
data/is/list-generation/
```

既存構成上、完全一致が不自然なら、
責務がISと分かる命名にする。

例:

```text
is-list-generation-service.js
is-scraping-jobs.js
is-list-generation-routes.js
```

---

## 7. API名前空間

新規APIはFS配下へ作らない。

推奨:

```text
GET  /api/is/list-generation/areas
GET  /api/is/list-generation/jobs
POST /api/is/list-generation/jobs
GET  /api/is/list-generation/jobs/:jobId
POST /api/is/list-generation/jobs/:jobId/pause
POST /api/is/list-generation/jobs/:jobId/resume
POST /api/is/list-generation/jobs/:jobId/cancel
```

PoCではComdesk本番投入APIを呼ばない。

---

## 8. PoC実行単位

最低限:

```text
areaFolderId
areaName
prefectureName
genre
sources
```

初回候補:

```text
静岡県
伊東市
居酒屋
Google Maps
食べログ
```

ただし既存Driveデータを上書きしない安全な条件で実施する。

---

## 9. Google Maps取得

既存Playwright処理を調査・再利用する。

例:

```text
静岡県 伊東市 居酒屋
```

最低限:
- store_name
- address
- phone
- category
- website
- maps_url
- 取得可能な安定ID
- fetched_at

無限スクロールは禁止。

停止条件:
- 結果末尾
- 同一結果連続
- 最大件数
- 最大スクロール
- 最大実行時間

---

## 10. 食べログ取得

既存処理で地域・ジャンル検索結果を巡回する。

最低限:
- store_name
- address
- phone
- genre
- tabelog_url
- fetched_at

既存で営業時間等を取得できるなら保持。

---

## 11. サイト制限対応

CAPTCHAを突破しない。

```text
CAPTCHA
→ needs_human

429
→ backoff

parser変更
→ parser_error

通常エラー
→ limited retry
```

---

## 12. RAW保存 / 再開

推奨:

```text
data/is/list-generation/jobs/<jobId>/
├── maps.raw.jsonl
├── tabelog.raw.jsonl
├── normalized.jsonl
├── merged.jsonl
├── rejected.jsonl
└── checkpoint.json
```

Macスリープ、Node停止、ブラウザクラッシュ、ネット切断後も、
可能な限り途中再開する。

---

## 13. 正規化・統合

単純concat禁止。

表示用原文を保持しつつ比較用正規化を作る。

同一店舗判定優先:
1. 電話番号完全一致
2. 住所強一致 + 店名類似
3. 店名強一致 + 住所類似
4. 要確認

既存confidence logicがあれば再利用。

---

## 14. 除外順

必ず以下。

```text
Maps + Tabelog
↓
normalize
↓
merge/dedupe
↓
チェーン除外
↓
対象外除外
↓
電話番号補完
↓
CSV
↓
Drive
```

電話番号補完を除外前に大量実行しない。

---

## 15. 電話番号補完

Mapsまたは食べログでphone取得済みなら外部補完しない。

```text
phoneあり
→ 補完なし

phoneなし
→ 既存SerpAPI等で補完
```

低信頼度は自動採用しない。

---

## 16. Comdesk CSV

PoCではComdesk本番アップロードしない。

既存Comdesk importer/exporterから、
現在使用中のCSV schema、encoding、命名規則を調査して再利用。

確認済み命名例:

```text
コムデスク_リアルアフィリエイト_静岡県伊豆市_居酒屋_20260807.csv
```

新しいCSV schemaを勝手に作らない。

---

## 17. Drive保存

対象市区町村の既存運用へ接続する。

最終的に:

```text
対象市区町村/
└── 完成版CSVエクスポート/
```

へ到達させる。

同名ファイルを無条件上書きしない。

---

## 18. ジョブ状態

```text
queued
running
paused
completed
failed
needs_human
cancelled
```

stage:

```text
drive_scan
maps
tabelog
normalize
merge
exclude
phone_enrichment
csv_export
drive_upload
```

---

## 19. 設定

Git管理するのはexampleだけ。

```text
config/is/list-generation/scraping-automation.local.example.json
```

実際の秘密情報を含むlocalファイルは.gitignore。

PoCでは:

```json
{
  "drive": {
    "rootFolderId": "1EVUOKS-sIIWSy5J_WXEh2fAg6ip5rnsS"
  },
  "poc": {
    "autoUploadToComdesk": false,
    "sources": ["google_maps", "tabelog"]
  }
}
```

---

## 20. FSへの影響禁止

今回の変更で以下を壊さない。

- FS商談準備
- FSトークスクリプト
- FS商談画面
- FS商談メモ
- FS案件管理
- FS進捗
- FS Obsidian同期

ISのリスト生成として独立させる。

---

## 21. Obsidian

今回PoCでObsidian連携を追加する場合も、
FS配下ではなくIS側として扱う。

将来的な想定:

```text
HDシステム
└── IS
    └── list acquisition
```

ただしPoCの必須要件ではない。
既存Obsidian構造を勝手に移動しない。

---

## 22. テスト

最低限:
- IS画面から実行できる
- FS画面へ機能が混入しない
- Driveから市区町村一覧取得
- 1エリア×1ジャンル
- Maps取得
- 食べログ取得
- JSONL/checkpoint
- 再開
- 統合
- 重複排除
- チェーン除外
- 対象外除外
- phoneありは補完しない
- phoneなしだけ補完
- 既存Comdesk schema CSV
- Drive保存
- 同名安全性
- Comdesk本番投入なし
- CAPTCHA停止
- 429 backoff
- 既存FSテスト成功
- npm test成功

---

## 23. PoC完成条件

```text
HD AIアシスタント
↓
IS
↓
リスト生成
↓
1エリア×1ジャンルをテスト実行
↓
Google Maps + 食べログ
↓
統合・除外・電話補完
↓
既存Comdesk形式CSV
↓
正しいDriveフォルダ
```

ここまでを人間が検索操作せず実行できる。

PoCではComdesk本番投入しない。

---

## 24. 次フェーズ

PoC成功後:

### Phase 2

```text
Drive未処理市区町村を自動検出
↓
全ジャンル順次実行
```

### Phase 3

```text
完成版CSV
↓
既存Comdesk自動投入
```

### Phase 4

```text
Comdesk残リスト数
↓
必要件数算出
↓
不足分をISリスト生成が自動補充
```
