# HD AIアシスタント｜FS スクリプト作成・アウト即時相談・準備UI v3 要件書

## 1. 目的

今回の改修では、FSを「固定トークを閲覧するだけの画面」から、現場メンバー自身がスクリプトを追加・改善しながら利用できる仕組みへ拡張する。

実現するもの:
1. 商談中、フェーズタイトル横へアウト内容を殴り書きすると返し候補がポップアップする
2. 商談準備画面をコンパクト化する
3. トークスクリプトテンプレ画面をコンパクト化する
4. 全FS利用者が新規スクリプトを登録できる
5. 長文のトーク原稿を貼るだけで、自動的にフェーズへ分解して下書きを生成する
6. 自動生成後は人がフェーズ名・順番・本文・分岐を微修正できる
7. 2026/08/06版「HDトークスクリプト（取材アポ版）」を最新正本として登録する
8. 旧2026/07/30取材用トークは破壊削除せずarchive化し、通常一覧から除外する
9. 同一script/versionを重複表示しない

## 2. 対象

`/Users/maekawahiroyuki/hd-system-auto`

既存の `CLAUDE_CODE_FS_UI_MASTER_20260807.md` のUI方針を維持する。

## 3. 商談画面：アウト即時相談

### 配置
フェーズタイトル横にコンパクトな入力欄を置く。

```text
⑦ 制作事例の紹介        [アウト内容を入力…        ] [相談]
制作事例を見せ、品質への率直な評価を得る
```

タイトルが長い場合は入力欄を次行へ自然に落としてよい。

### 入力
placeholder: `例：無料なのが怪しいと言われた`

- Enterで候補検索/生成
- IME変換中Enterでは実行しない
- 「相談」ボタンでも実行
- 空文字では実行しない
- 連打防止

### popup
最大3候補を表示。

```text
アウト：「無料なのが怪しい」

おすすめの返し
1. ...
2. ...
3. ...

[別候補] [閉じる]
```

候補クリック時:
- 全文表示
- スクリプト本文を自動書換えしない
- 採用候補をobjection logへ保存
- typed objection / phaseId / scriptId / selectedSuggestion / timestampを記録
- 既存Obsidian反応履歴があれば連携

### 候補生成優先順位
1. 既存の承認済みアウト返し集
2. rule/keyword matching
3. LLM providerが設定されている場合のみAI補完

候補badge:
`承認済み` / `自動候補` / `AI候補`

実LLM経由のものだけ `AI候補` と表記する。

API案:
`POST /api/fs/meetings/:meetingId/objection-suggestions`
`POST /api/fs/meetings/:meetingId/objection-events`

## 4. 商談準備UIをコンパクト化

現在の大きなheroを縮小する。

```text
商談準備                                 [各種案件へ]
案件情報と使用トークを確認して商談を開始します
────────────────────────────────────
[編集中：店舗名]  [新規作成へ戻す]
```

巨大な英語Eyebrowは不要。

### 使用トーク
現在の大きなフェーズカード一覧を常時表示しない。

```text
使用トーク
[ HDトークスクリプト（取材アポ版） 2026/08/06 ▼ ] [内容確認]
10フェーズ / HP無料制作 / 公開中

前提 → 会社紹介 → HP背景 → 信用 → 事例 → ヒアリング → 用途 → 条件 → 永年無料 → クレカ
```

phase previewは小さいchips/横スクロール。
詳細はmodal。

新規商談準備の既定スクリプトは2026/08/06版。
archiveは通常dropdownに表示しない。
必要なら「過去版も表示」で確認。

## 5. トークスクリプトテンプレ画面

巨大heroを縮小。

```text
トークスクリプト                       [+ 新規作成] [文章から自動作成]
[スクリプト] [商談資料]
```

「管理メニューを表示」は主導線から外す。

一覧は:
- スクリプト名
- version
- フェーズ数
- 対象商材
- 状態
- 内容を見る
- このトークで準備
- その他メニュー

同じ `scriptId + version` は1件だけ表示。
DB重複があってもUIで重複表示しない。

## 6. 誰でもスクリプト追加

「新規作成」「文章から自動作成」はFS全利用者に表示する。

現状認証がなければローカル利用者全員が利用可能。
将来は `script:create` をFS標準権限へ含める。

公開済みversionは直接破壊上書きしない。

```text
公開版
↓ 編集
新しいdraft version
↓ 人が確認
公開
```

過去商談は当時versionを参照し続ける。

## 7. 文章から自動作成

入力:

```text
新しいトークスクリプト
スクリプト名（任意）
version（任意）
対象商材（任意）

原稿を貼り付け
[大きなtextarea 420px以上]

[フロー化する]
```

抽出:
- タイトル
- version/date
- 参考URL
- 資料URL
- 大見出し
- サブ見出し
- フェーズ候補
- 読み上げ本文
- Yes/No分岐
- 想定アウト
- 運用メモ
- 注意書き
- クロージング
- 商材名

### parser
provider abstractionを作る。

```text
ScriptStructureParser
├── HeadingRuleParser
└── OptionalLLMParser
```

【見出し】が明確な原稿はLLMなしでもフロー化。
自由文ではLLM providerが設定済みの場合だけAI解析を利用。

LLM未設定でも2026/08/06 RAWは正常に解析できる。

### 原文保護
- 本文を勝手に言い換えない
- 誤字を勝手に修正しない
- 金額・固有名詞を勝手に変更しない
- AIは構造化のみ
- フェーズ名は人が編集可能

## 8. 解析後の人間修正

```text
10フェーズを作成しました

① 前提・今日の流れ・決裁者確認
[タイトル編集] [本文編集] [↑] [↓]

...

[フェーズ追加]
[保存（下書き）]
[公開]
```

必要機能:
- title編集
- 本文編集
- reorder
- phase追加/削除
- phase結合/分割
- Yes/No branch編集
- resource link編集
- preview

主フローは「自動生成→人が微修正」。

## 9. 2026/08/06最新版

同梱:
`config/fs-sales/import/HD_TALK_SCRIPT_INTERVIEW_20260806_RAW.md`

をsource of truthとしてpublished scriptを作る。

- scriptId: `hd-interview-appointment-20260806`
- name: `HDトークスクリプト（取材アポ版）`
- version: `2026/08/06`
- status: `published`
- defaultForPreparation: true

期待フェーズは同梱JSONを参考に10フェーズ前後。
本文はRAWを正とする。

## 10. 旧スクリプト

旧 `取材用トーク / 2026/07/30` は物理削除しない。

- status = archived
- is_default = false
- 通常一覧/準備dropdownから非表示
- 過去版表示では閲覧可能

`HP無料制作支援金トーク / 2026/07/25` は削除しない。

## 11. リンク抽出

2026/08/06原稿から最低限以下を抽出し既存資料ライブラリと重複させない。
- GrowthPath HP
- 実績一覧
- エネパル
- パルパワー料金表
- エネパル関東条件
- sankouin
- Art Crafter

URLを公開JSへ直書きせず既存material repository/config方式を使う。

## 12. DB/API

既存schemaを優先。
必要なら以下を追加:
- status: draft|published|archived
- source_type: manual|rule_import|ai_import
- source_text nullable
- created_by
- supersedes_script_id nullable
- content_hash

重複防止は `scriptId + version` またはcontent hash。

API案:
- POST `/api/fs/talk-scripts/parse`
- POST `/api/fs/talk-scripts`
- PATCH `/api/fs/talk-scripts/:id`
- POST `/api/fs/talk-scripts/:id/publish`
- POST `/api/fs/talk-scripts/:id/archive`
- GET `/api/fs/talk-scripts?includeArchived=false`

## 13. 安全性

- pasted raw text / script name / objectionはuser input
- 未加工innerHTML禁止
- URL protocol validation
- API keyをフロント/DB/Gitへ保存しない
- raw原稿をログへ全文出力しない
- prompt injection文字列はデータとして扱う

## 14. テスト

### アウト即時相談
- タイトル横にinput
- Enterでpopup
- IME中Enter誤実行なし
- approved候補優先
- 最大3候補
- 採用履歴保存
- fallback
- 横はみ出しなし

### スクリプト
- 全利用者に作成導線
- 長文paste
- 2026/08/06 RAW解析
- 10フェーズ前後
- raw本文非改変
- phase編集
- reorder
- draft保存
- publish
- 公開済み編集は新version
- duplicate非表示

### 最新版
- 2026/08/06 published/default
- 2026/07/30 archived
- 過去商談から07/30参照可能
- 07/25維持

### UI
- 商談準備hero小型化
- phase chips
- template hero小型化
- 1280x800 / 1440x900で崩れない

## 15. 完成条件

1. 商談中タイトル横へアウトを書ける
2. Enterで返し候補popup
3. 商談準備がコンパクト
4. script選択が簡単
5. 誰でも新規スクリプト作成
6. 長文貼り付け→自動フロー化
7. 人間が微修正
8. 2026/08/06が最新正本
9. 旧07/30はarchive
10. duplicateなし
11. 既存データ/Obsidian/商談機能が壊れていない
