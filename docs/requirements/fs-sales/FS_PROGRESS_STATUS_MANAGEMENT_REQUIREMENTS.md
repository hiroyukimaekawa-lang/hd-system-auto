# FS 2軸進捗ステータス管理 要件書

## 対象
`/Users/maekawahiroyuki/hd-system-auto`

## 目的
FS案件に2種類の進捗を持たせ、案件画面からいつでも変更可能にする。
同じA/Bコードが存在するため、必ず別フィールドとして保存・表示する。

## 軸1：申込・審査進捗
- AA：課金（上位店より承認）
- A：申し込み書⭕️＋審査通過⭕️
  - 基本次回アクションはヒアリングMTG調整
- B：申し込み書⭕️＋各商材お申し込み⭕️（審査待ち）
  - アクションは基本待ち
- C：申し込み書⭕️＋各種商材お申し込み❌
  - 基本ここでのアクションは日程調整だけ／時間切れで口頭YES
- D：HD申し込み書❌＋各種商材申し込み❌

## 軸2：案件進捗
- A：エントリー済み
- B：素材回収待ち
- C：申込書回収待ち
- D：商談済み回答待ち
- E：商談
- XA：プレゼン失注（決裁者）
- XB：プレゼン失注（非決裁者）

## UI
「各種案件用」「各種案件結果と振り返り」から両方変更できるようにする。

表示例:
```text
案件進捗
[D｜商談済み回答待ち ▼]

申込・審査進捗
[C｜申し込み書⭕️＋各種商材お申し込み❌ ▼]
```

単に `進捗:B` とだけ表示しない。
コード＋名称を必ず表示する。

## 商談終了画面
必須入力にはしない。
折りたたみ可能な「進捗」セクションとして変更可能にする。

## 変更履歴
すべての変更履歴を保存する。

保存項目:
- deal_id
- axis (`deal_stage` / `application_progress`)
- from_status
- to_status
- changed_by
- changed_at
- reason nullable
- source (`manual` / `meeting_close` / `system_suggestion` / `import`)

表示例:
```text
8/7 17:20 案件進捗 E → D
8/8 10:05 申込進捗 D → C
8/9 15:30 申込進捗 C → B
```

## DB
既存DBを削除せず追加マイグレーションで対応。

推奨:
### deal_progress
- deal_id
- deal_stage_code
- application_progress_code
- updated_by
- updated_at

### deal_progress_history
- id
- deal_id
- axis
- from_status
- to_status
- reason
- source
- changed_by
- changed_at

## 次回アクションヒント
configの `nextActionHint` を補助表示する。
自動で次回アクションを書き換えない。

## AI/自動判定
ルールやAIで「この進捗の可能性があります」と提案するのは可。
ユーザー確認なしで自動変更は禁止。

## 一覧フィルタ
案件進捗と申込・審査進捗の両方で絞り込み可能にする。
2軸フィルタは併用可能。

## XA/XB
- XA：プレゼン失注（決裁者）
- XB：プレゼン失注（非決裁者）

失注でも案件・商談メモ・Obsidian記録は削除しない。
任意で失注理由を入力できる。

## Obsidian
案件Markdownに最新進捗を追加。

```markdown
## 進捗
- 案件進捗：D｜商談済み回答待ち
- 申込・審査進捗：C｜申し込み書⭕️＋各種商材お申し込み❌
```

既存本文は消さない。

## Googleカレンダー
進捗変更だけで予定を自動作成・変更しない。
必要ならヒントから予定作成導線を表示するだけ。

## Validation
application_progress:
`AA A B C D`

deal_stage:
`A B C D E XA XB`

同じA/Bでもaxisが違えば別物。

## 既存データ
不明な過去案件を勝手に推定変換しない。
対応できない場合は未設定/null。

## テスト
- 2軸を別保存
- A/Bを混同しない
- AA/XA/XBを保存可能
- 不正code拒否
- 手動変更
- 変更履歴
- 再読み込み復元
- 一覧フィルタ
- nextActionHint
- 変更してもメモ消失なし
- Obsidianへ最新進捗
- XA/XBでも案件削除なし
- カレンダー自動変更なし
- 既存テスト成功
