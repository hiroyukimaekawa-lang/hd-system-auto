# HD AIアシスタント｜FS商談終了画面・商談メモ・AI解析 改修要件書

## 1. 目的

現在の「商談を終了する」画面にある「商談結果」プルダウンは、ヨミ管理と重複するため廃止する。  
代わりに、商材の複数選択、原文メモ、AI解析、商談後の追記・編集を中心に記録できるようにする。

対象:

```text
/Users/maekawahiroyuki/hd-system-auto
```

## 2. 削除する項目

終了モーダルの以下を削除する。

```text
商談結果
- 明細確認へ進む
- 明細を後日準備
- 共同経営者・家族へ確認
- 条件比較のみ実施
- 再商談
- 保留
- 見送り
- 失注
```

要件:

- 新規商談では商談結果を必須入力にしない
- 既存DBの過去データは削除しない
- 過去結果は必要に応じて「旧データ」として読み取り専用表示
- 既存案件を開いてもエラーにしない

## 3. 改修後の終了画面

表示順:

```text
1. 今回扱った商材
2. 次の行動
3. 商談メモ（原文）
4. AIによる整理結果
5. 担当者の振り返り
6. 引き継ぎFMT
7. 保存して終了
```

## 4. 商材チェックボックス

商談形式が「インタビュー形式」「通常商談」のどちらでも、以下を複数選択できるようにする。

```text
□ エネパル
□ AMEX
□ 三井住友ビジネスオーナーズ
□ アコム（ACマスターカード）
```

内部ID:

| 表示名 | ID |
|---|---|
| エネパル | `enepal` |
| AMEX | `amex` |
| 三井住友ビジネスオーナーズ | `smbc_business_owners` |
| アコム（ACマスターカード） | `acom_ac_mastercard` |

チェックの意味は「今回の商談で扱った、提案した、または今後回収対象となった商材」とする。

必要に応じて以下も追加する。

```text
□ 今回は商材提案なし
```

「商材提案なし」と他商材は同時選択不可。

## 5. 原文メモ

AI解析と混ぜず、必ず「原文メモ」として独立表示する。

含める情報:

- 商談中に右側メモへ入力した内容
- 入力日時
- 入力時のフェーズ
- 商談終了時の追記
- 商談終了後の追記
- 入力者・編集者
- 最終編集日時

表示例:

```text
12:04　フェーズ⑤
HP自体は作りたい。電気は奥様確認。

12:18　フェーズ⑩
明細は後日LINEで送る。AMEXは興味あり。

商談後追記　8/7 10:15
奥様確認済み。明細は本日夕方送付予定。
```

## 6. 商談後の追記・編集

「各種案件結果と振り返り」の案件詳細から、商談終了後も追記できるようにする。

操作:

```text
[メモを追記]
[編集]
[削除]
[編集履歴]
```

編集要件:

- 元内容を消さず、編集前後を履歴保存
- 編集者・編集日時を保存
- 空文字への更新は禁止
- 削除は物理削除ではなく論理削除
- 通常表示は最新内容
- 管理者または履歴画面から過去内容を確認可能

メモの `source`:

```text
during_meeting
closing_form
post_meeting
```

## 7. AI解析

### 解析対象

- 商談中の全原文メモ
- 商談終了時・終了後の追記
- IS備考
- 選択商材
- 次の行動
- 担当者の振り返り
- 商談フェーズ
- 既存の確認事項

### 表示項目

```text
商談要約
確認できた事実
相手の発言・言質
懸念・未確認事項
決裁者・確認者
商材別の状況
次に行うこと
不足している回収情報
相手の温度感
```

表示例:

```text
■商談要約
HP制作には前向き。電気切替は奥様確認と明細比較が必要。

■確認できた事実
・現在の電力会社は東北電力
・明細は後日LINEで送付予定
・AMEXに興味あり

■相手の発言・言質
・「HP自体は作りたい」
・「料金を確認して問題なければ進めたい」

■懸念・未確認事項
・奥様の同意
・電気明細未回収

■次に行うこと
8月7日夕方に明細送付を確認する
```

### 重要ルール

- AIは原文メモを書き換えない
- AI解析を商談結果・受注失注・ヨミとして保存しない
- 温度感は参考情報として表示
- AI内容を確定事実として扱わない
- 「AIによる整理結果」と明示する

## 8. AI解析の更新・編集

設置する操作:

```text
[AI解析を更新]
[解析結果を編集]
```

解析状態:

```text
未解析
解析中
最新
メモ更新後・要再解析
解析失敗
```

メモ、商材、次の行動が変更された場合、既存解析を `stale` にする。

表示:

```text
メモが更新されています。AI解析を更新してください。
```

解析結果の担当者編集:

- AI生成内容と担当者修正版を別保存
- 担当者修正版を正式表示
- 「担当者修正済み」と表示
- 再解析で担当者修正版を無断上書きしない
- 新しい解析バージョンとして保存するか、更新前に確認する

## 9. 案件詳細画面

終了後の案件詳細に以下を表示する。

```text
店舗・案件情報
選択商材
次の行動
原文メモ
AI解析結果
担当者の振り返り
引き継ぎFMT
編集履歴
```

可能な操作:

```text
[メモを追記]
[メモを編集]
[AI解析を更新]
[AI解析を編集]
[商材を変更]
[次の行動を編集]
[振り返りを編集]
[引き継ぎFMTを再生成]
```

時系列例:

```text
8/6 商談終了
8/7 明細回収
8/8 奥様確認
8/9 エネパル申込
```

## 10. データモデル

既存DBを削除せず、追加マイグレーションで対応する。

### meeting_products

```text
id
meeting_id
deal_id
product_code
selected
created_by
created_at
updated_at
```

### meeting_notes

```text
id
meeting_id
deal_id
phase_id nullable
source
content
author_id
is_deleted
created_at
updated_at
deleted_at nullable
deleted_by nullable
```

### meeting_note_revisions

```text
id
note_id
content_before
content_after
edited_by
edited_at
```

### meeting_ai_analyses

```text
id
meeting_id
deal_id
source_hash
model_name nullable
status
analysis_json
generated_text
edited_text nullable
generated_at
edited_by nullable
edited_at nullable
is_current
created_at
updated_at
```

`status`:

```text
pending
completed
failed
stale
```

原文・商材・次の行動を正規化したハッシュを `source_hash` とし、現在データと異なる場合は `stale` にする。

## 11. API

```http
GET    /api/fs/meetings/:meetingId/notes
POST   /api/fs/meetings/:meetingId/notes
PATCH  /api/fs/meetings/:meetingId/notes/:noteId
DELETE /api/fs/meetings/:meetingId/notes/:noteId
GET    /api/fs/meetings/:meetingId/notes/:noteId/revisions

PUT    /api/fs/meetings/:meetingId/products

POST   /api/fs/meetings/:meetingId/analysis
GET    /api/fs/meetings/:meetingId/analysis
PATCH  /api/fs/meetings/:meetingId/analysis/:analysisId
```

商談終了APIは既存を維持し、商談結果を必須から外す。

想定:

```json
{
  "products": ["enepal", "amex"],
  "nextAction": "明細回収と奥様確認",
  "closingMemo": "",
  "reflection": ""
}
```

## 12. AI障害時

AI解析が失敗しても以下を保存し、商談終了できること。

- 商材
- 次の行動
- 原文メモ
- 振り返り
- 商談終了状態

表示:

```text
AI解析を作成できませんでした。
商談記録は保存されています。
[再解析]
```

## 13. セキュリティ

- メモ・AI解析・店舗名を未加工の `innerHTML` に入れない
- 原則 `textContent` または安全なエスケープ
- meetingId、dealId、noteIdの関係を検証
- 他案件のメモを編集できないようにする
- AI送信内容をサーバーログへ全文出力しない
- 削除は論理削除
- 編集履歴を保持
- AI解析には注意文を表示

```text
AI解析は原文メモをもとにした補助情報です。
重要な判断は原文と実際の確認内容をもとに行ってください。
```

## 14. 既存機能

維持する:

- 商談中の右側メモ
- 商談中断・再開
- 取材用トーク10フェーズ
- 商談資料連動
- 進捗管理FMT
- Obsidian保存
- Googleカレンダー連携
- 過去の商談結果データ

## 15. テスト

- 商談結果プルダウンが表示されない
- 商談結果なしで終了できる
- 過去結果データが消えない
- 4商材を複数選択できる
- インタビュー・通常商談の両方で表示される
- 商談中メモが終了画面へ出る
- 終了後に追記・編集できる
- 編集履歴が残る
- 論理削除できる
- AI解析と原文が混在しない
- メモ更新後に `stale` になる
- 再解析できる
- AI解析を編集できる
- 担当者修正版を無断上書きしない
- AI失敗時も終了できる
- AI解析をヨミとして保存しない
- 既存の商談、FMT、Obsidian、カレンダー連携が壊れていない
- `npm test` と既存品質チェックが成功する

## 16. 完成条件

- 商談結果プルダウンが削除されている
- 4商材をチェックボックスで複数選択できる
- 原文メモとAI解析を同時確認できる
- 商談終了後にも追記・編集できる
- 編集履歴が残る
- メモ変更後にAI解析を更新できる
- AI解析も担当者が修正できる
- AI解析を商談結果・ヨミとして扱わない
- 過去データと既存機能を維持している

## 17. Claude Codeへの指示

```text
/Users/maekawahiroyuki/hd-system-auto を対象に、
docs/requirements/fs-sales/
FS_MEETING_CLOSE_NOTES_AI_ANALYSIS_REQUIREMENTS.md
を最初から最後まで読み、内容を実装してください。

最重要:
1. 「商談結果」プルダウンを削除する
2. 過去の商談結果データは削除しない
3. エネパル、AMEX、三井住友ビジネスオーナーズ、
   アコム（ACマスターカード）を複数選択チェックボックスにする
4. インタビュー形式・通常商談の両方で表示する
5. 原文メモとAI解析を分けて表示する
6. 商談終了後もメモを追記・編集できるようにする
7. 編集履歴と論理削除を実装する
8. メモ変更後にAI解析を再生成できるようにする
9. AI解析を商談結果・ヨミとして保存しない
10. AI障害時も商談終了を成功させる
11. 既存未コミット変更・既存データを保持する
12. DB変更は追加マイグレーションにする
13. 今回はcommit・pushしない

開始前と実装後にテストを行い、
変更ファイル、DB、API、UI、AI解析方式、
テスト結果、残課題を報告してください。
```
