# Claude Code実装指示｜HD IS リスト生成 スクレイピング自動化 PoC

対象:
`/Users/maekawahiroyuki/hd-system-auto`

必ず最初に読む:
- `docs/requirements/is-list-generation/HD_IS_LIST_GENERATION_SCRAPING_POC_REQUIREMENTS.md`
- `config/is/list-generation/scraping-automation.local.example.json`

## 最重要

今回の機能はFSではありません。

必ず:

```text
HD AIアシスタント
└── IS
    └── リスト生成
        └── 自動取得
```

として実装してください。

UI、API、コード、保存先、設定名にFS名前空間を使わないでください。

## PoC

今回は1エリア×1ジャンルのみ。

```text
Drive市区町村
→ Google Maps
→ 食べログ
→ RAW/checkpoint
→ normalize
→ merge/dedupe
→ chain/対象外除外
→ 電話番号なしだけ補完
→ 既存Comdesk形式CSV
→ Drive保存
→ STOP
```

PoCではComdesk本番投入は絶対に実行しないでください。

## 既存コード再利用

最初に以下を調査:
- Google Maps取得
- 食べログ取得
- Playwright
- JSONL
- 重複排除
- チェーン除外
- 電話番号補完
- Google Drive
- Comdesk CSV
- Comdesk importer

新しい別システムをゼロから作らないでください。

## Drive

root folder:
`1EVUOKS-sIIWSy5J_WXEh2fAg6ip5rnsS`

ルート直下の市区町村フォルダをエリアマスターとして使ってください。
既存Driveファイル/フォルダを移動・改名・削除しないでください。

## 名前空間

可能な範囲で:

```text
src/is/list-generation/
config/is/list-generation/
data/is/list-generation/
```

API:

```text
/api/is/list-generation/*
```

を使用してください。

既存構成との整合を優先しつつ、FSと混同しないことが必須です。

## UI

IS > リスト生成 > 自動取得

最低限:
- エリア
- ジャンル
- Google Maps
- 食べログ
- テスト実行
- 取得件数
- 統合後件数
- 除外件数
- 電話補完件数
- 最終件数
- 現在stage
- 一時停止/再開/中止/ログ

## 外部サイト

CAPTCHAは突破せずneeds_human。
429はbackoff。
利用条件・アクセス制限に従ってください。

## 再開

JSONL/checkpointで途中再開可能にしてください。

## 処理順

電話番号補完は最後です。

```text
取得
→ 統合
→ 重複
→ チェーン/対象外
→ 電話番号なしだけ補完
```

## Git安全

開始前:

```bash
cd "/Users/maekawahiroyuki/hd-system-auto"
git status --short
git branch --show-current
git remote -v
npm test
```

禁止:
- git reset
- git restore
- git clean
- git stash
- 既存未追跡ファイル削除
- commit
- push

## FS回帰

今回の変更でFS機能を変更・破壊しないでください。

## 実装後

- npm test
- npm run check があれば実行
- dry-run
- 安全な1エリア×1ジャンルPoC
- Drive出力先確認
- Comdesk uploader未実行確認
- FS回帰確認

途中確認は不要です。

最後に以下を報告:

```markdown
# IS リスト生成スクレイピングPoC 実装結果

## 所属/名前空間
-

## 現行コード調査
### Google Maps
-
### 食べログ
-
### Drive
-
### Comdesk CSV
-

## PoCジョブ
-

## UI
-

## RAW/checkpoint
-

## 統合・重複排除
-

## チェーン/対象外除外
-

## 電話番号補完
-

## Drive出力
-

## PoC実行結果
- Area:
- Genre:
- Maps:
- Tabelog:
- Merged:
- Excluded:
- Phone enriched:
- Final:
- Drive:

## Comdesk
- 本番投入していない:

## FS回帰
-

## 変更ファイル
-

## テスト
-

## 残課題
-

## commit/push
- 実施していない
```
