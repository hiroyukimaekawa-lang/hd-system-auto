# Claude Code 統合実装指示
# HD AIアシスタント｜FS UI全面安定化 + 商談メモ統合 + スクリプト簡略化

## 0. 実装対象

```text
/Users/maekawahiroyuki/hd-system-auto
```

GitHub:

```text
https://github.com/hiroyukimaekawa-lang/hd-system-auto.git
```

今回、FS側のUI修正をまとめて一度に実装してください。

実装対象は以下です。

```text
1. FS UI全体の文字被り・レスポンシブ・CSS競合修正
2. トークスクリプトテンプレUIの安定化
3. 商談準備UIの安定化
4. 各種案件用UIの安定化
5. 各種案件結果と振り返りUIの安定化
6. 商談実行画面3列レイアウトの安定化
7. 商談画面右側の「商談メモ」統合
8. 商談画面中央のスクリプト表示簡略化
9. 商談終了モーダルの見切れ・文字被り修正
```

---

# 1. 必ず読む3つの詳細要件

以下をすべて最初から最後まで読んでください。

```text
docs/implementation-prompts/CLAUDE_CODE_FS_UI_STABILIZATION.md
docs/implementation-prompts/CLAUDE_CODE_FS_MEETING_MEMO_UNIFIED_UI.md
docs/implementation-prompts/CLAUDE_CODE_FS_MEETING_SCRIPT_MINIMAL_UI.md
```

この統合指示書は実装順序と優先順位を定めるものです。

---

# 2. 要件が競合した場合の優先順位

直近のユーザー修正を最優先してください。

優先順位:

```text
最優先
CLAUDE_CODE_FS_MEETING_SCRIPT_MINIMAL_UI.md

↓
CLAUDE_CODE_FS_MEETING_MEMO_UNIFIED_UI.md

↓
CLAUDE_CODE_FS_UI_STABILIZATION.md
```

つまり、UI安定化要件に以前の表示要素が残っていても、
後から指定された「中央スクリプト簡略化」「右メモ統合」を優先してください。

例:

```text
FS_UI_STABILIZATION:
確認事項が見切れないようにする

最新要件:
商談実行画面では確認事項自体を表示しない

→ 最新要件を採用する
```

---

# 3. 絶対に変更しないもの

今回の目的はUI改善です。

以下を変更しないでください。

```text
- 取材用トーク本文
- 通常商談トーク本文
- スクリプト本文の文言
- フェーズの順番
- フェーズデータ
- 確認事項データ
- 次へ進む条件データ
- 使用禁止表現データ
- 商談資料URL
- 資料フェーズ連動ロジック
- SQLite既存データ
- 商談メモ既存データ
- AI解析の内部ロジック
- Obsidian連携
- Googleカレンダー連携
- 商談終了の業務ロジック
- 進捗管理FMT
```

「商談実行画面で表示しない」と「データを削除する」を混同しないこと。

---

# 4. 最初に現状確認

```bash
cd "/Users/maekawahiroyuki/hd-system-auto"

pwd
git remote -v
git branch --show-current
git status --short

find desktop/public -maxdepth 3 -type f | sort

sed -n '1,320p' desktop/public/styles.css
sed -n '1,440p' desktop/public/css/fs-meeting.css
sed -n '1,320p' desktop/public/css/fs-materials.css
sed -n '1,620p' desktop/public/app.js

for f in desktop/public/js/*.js; do
  echo "===== $f ====="
  sed -n '1,320p' "$f"
done

cat package.json
```

既存の未コミット変更を保持してください。

禁止:

```text
git reset
git restore
git clean
git checkout --
git stash
自動stash
既存未追跡ファイルの削除
```

今回はcommit・pushしないでください。

---

# 5. 今回の完成形

FS商談実行画面は、最終的に以下の役割分担にしてください。

```text
┌─────────────┬─────────────────────────────────┬────────────────────┐
│ 左          │ 中央                            │ 右                 │
│             │                                 │                    │
│ フェーズ一覧│ 小さいフェーズ名・目的          │ 商談メモ           │
│             │                                 │                    │
│             │ 読み上げスクリプト              │ 大きな入力欄       │
│             │                                 │                    │
│             │                                 │ AI整理して保存     │
│             │                                 │                    │
│             │                                 │ AI整理結果         │
│             │                                 │                    │
│             │                                 │ ▸ 過去メモ         │
│             │                                 │ ▸ アウト返し候補   │
│             │                                 │                    │
│             │ ← 前へ  アウト  次へ →          │                    │
└─────────────┴─────────────────────────────────┴────────────────────┘
```

基本原則:

```text
左 = 移動する場所
中央 = 読む場所
右 = 書く場所
```

---

# 6. FSサイドバー

表示順は維持:

```text
1. トークスクリプトテンプレ
2. 商談準備
3. 各種案件用
4. 各種案件結果と振り返り
```

修正:

- 長文がアイコンや隣要素と被らない
- 2行になってよい
- 高さを固定しすぎない
- sidebar自体の縦スクロールを許可
- 選択アクセントが文字へ重ならない
- 小さい横幅では折りたたみ

---

# 7. トークスクリプトテンプレ

## 一覧

現在の:

```text
確認
タイトル編集
フロー編集
内容編集
```

が被らないようにする。

必須:

```css
.script-card footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
```

または既存DOMに合う同等実装。

カードgrid:

```text
大画面: 最大3列
中画面: 2列
狭い: 1列
```

推奨:

```css
grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
```

## 詳細・編集

- フェーズ名
- 目的
- 読み上げスクリプト
- 確認事項
- 次へ進む条件
- 使用禁止表現

はテンプレート管理画面では残す。

編集modal:

- viewport外へ出さない
- max-height 90vh程度
- 本文だけスクロール
- footer操作を常に押せる
- textareaを十分広くする

---

# 8. 商談準備

既存入力項目は変更しない。

UIのみ:

- 文字被り解消
- 長いURL/住所のoverflow対策
- 2列→1列レスポンシブ
- textareaの高さ改善
- 保存ボタンの被り解消

---

# 9. 各種案件用

- 店舗名が長くてもカード外へ出さない
- オーナー名・日時・ステータスが被らない
- ボタンはflex-wrap
- badgeがはみ出さない
- URL生文字列で横幅を壊さない
- 全flex/grid子に必要な `min-width:0`

---

# 10. 商談画面中央：最新仕様を最優先

## 10.1 タイトルを小さくする

現在の大きな:

```text
PHASE ⑦
制作事例の紹介
```

を小さくする。

完成:

```text
⑦ 制作事例の紹介
制作事例を見せ、品質への率直な評価を得る
```

目的は大きなカードにしない。

## 10.2 中央の主役は読み上げスクリプト

順番:

```text
フェーズ名
小さい目的
基本スクリプト
読み上げ本文
前へ / アウト / 次へ
```

本文:

```text
16〜18px程度
line-height 1.75〜1.9
```

## 10.3 商談実行画面から非表示

以下は商談中の中央カラムに表示しない。

```text
HPの役割
例：Instagramを見たお客様が迷わず予約できる公式情報

中央側の商談メモ
ヒアリング回答や重要事項を記録

確認事項

参考サイトへの第一印象
回答メモ
相手の回答を短く記録
詳細を残す（必要な時だけ）

品質・デザインへの感想
回答メモ
相手の回答を短く記録
詳細を残す（必要な時だけ）

自店でも作りたいか
回答メモ
相手の回答を短く記録
詳細を残す（必要な時だけ）

次へ進む条件
品質への評価を確認したら取材へ

使用禁止表現
必ず同じ品質になります

戻る場所を選択
選択した場所へ戻る
```

重要:

```text
データ削除は禁止
商談実行画面で表示しないだけ
テンプレート管理画面には残す
```

## 10.4 確認事項によるgate

確認事項UIを非表示にするため、
「確認事項を入力していないから次へ進めない」という状態を作らない。

担当者は任意のタイミングで次へ進める。

## 10.5 ナビゲーション

中央は3操作だけ。

```text
[← 前へ] [アウト] [次へ →]
```

任意のフェーズ移動は左側一覧を使う。

「戻る場所を選択」selectは非表示。

---

# 11. 商談画面右：メモ最新仕様

右側は別々の2カードにしない。

現在の:

```text
MEETING MEMO
殴り書きメモ

REACTION ANALYSIS
反応・言質のAI整理
質問したときの反応、相手が実際に言ったこと...
```

は統合する。

## 完成

```text
商談メモ                       保存済み

[ 大きなtextarea ]

Enter：追加 / Shift+Enter：改行

[ AI整理して保存 ]

AI整理結果
要約 / 言質 / 懸念 / 次の確認

▸ 過去メモ
▸ アウト返し候補
```

## 削除する文言

```text
MEETING MEMO
殴り書きメモ
REACTION ANALYSIS
反応・言質のAI整理
質問したときの反応、相手が実際に言ったこと、
迷っている条件をそのまま入力してください。
```

## textarea

商談自由入力は1つだけ。

```text
相手の発言・反応・懸念・言質などをそのまま入力
```

推奨:

```css
min-height: 220px;
height: clamp(220px, 34vh, 380px);
font-size: 15px;
line-height: 1.65;
```

## AI整理

別textareaに再入力させない。

```text
商談メモ原文
↓
AI整理して保存
↓
AI整理結果
```

既存AI整理APIが別入力値を要求する場合、
当該商談の原文メモを既存APIへ渡すようUI側を調整する。

AIの内部ロジックは変更しない。

## 過去メモ

初期は折りたたみ:

```text
▸ 過去メモ（N）
```

## アウト返し

初期は折りたたみ:

```text
▸ アウト返し候補
```

---

# 12. 商談画面3列レイアウト

正式なFS商談レイアウト定義は:

```text
desktop/public/css/fs-meeting.css
```

へ集約。

`styles.css` と競合させない。

大画面:

```text
左フェーズ 220〜250px
中央 1fr
右メモ 320〜380px
```

中画面:

```text
左 190〜220px
中央 1fr
右 300〜340px
```

狭い画面:

- sidebar縮小
- phase一覧の折りたたみ可
- スクリプト優先
- メモdrawer化可

---

# 13. 二重スクロール解消

中央カラム:

```text
script-panel
```

をスクロール領域とし、

```text
document-script
```

内部スクロールを原則廃止。

目標:

```css
.document-script {
  max-height: none;
  overflow: visible;
}
```

右メモカラムは独立スクロールでよい。

左フェーズも独立スクロールでよい。

---

# 14. 資料バー

既存資料連動は変更しない。

UI:

- 高さを1〜2行以内
- 資料なし時は最小高さ
- 長い資料名でレイアウト破壊しない
- 「全資料を見る」が外へ出ない
- 横スクロールするのは資料ボタン領域だけ

---

# 15. 商談終了モーダル

既存最新業務仕様を維持。

UI対象:

- viewport外へ出さない
- 長文AI解析で横幅を壊さない
- 原文メモの長文overflow対策
- footer操作へ必ず到達
- checkbox/select/textareaをwidth:100%系で安全化

推奨:

```css
width: min(900px, calc(100vw - 32px));
max-height: 92vh;
```

---

# 16. 各種案件結果と振り返り

既存情報:

```text
店舗情報
商材
次の行動
原文メモ
AI解析
振り返り
FMT
編集履歴
```

を維持。

UI:

- 長文が隣へ侵入しない
- 編集ボタンが見出しと被らない
- actionはwrap
- 狭い画面は1列
- 原文とAI解析を明確に分離

---

# 17. CSS責務整理

## styles.css

```text
全体カラー
共通button
共通form
共通dialog
共通topbar
共通view
共通utility
```

## fs-meeting.css

```text
FSサイドバー
FSスクリプトテンプレ
FS商談準備
FS案件
FS商談3列
FS右メモ
FS中央スクリプト
FS終了・結果
FS専用responsive
```

## fs-materials.css

```text
資料バー
資料ライブラリ
資料カード
```

同一selectorを複数CSSから競合させない。

重点selector:

```text
.assist-grid
.phase-rail
.script-panel
.note-column
.script-card
.deal-card
```

---

# 18. Breakpoint整理

FS専用は原則:

```text
1440px以上
1100〜1439px
768〜1099px
767px以下
```

現在の多数の細かいbreakpointを必要以上に混在させない。

---

# 19. overflowルール

必要な子要素:

```css
min-width: 0;
min-height: 0;
```

長文:

```css
overflow-wrap: anywhere;
word-break: normal;
```

button:

```css
white-space: normal;
```

単純な `overflow:hidden` だけで問題を隠さない。

---

# 20. XSS / UI安全

以下のユーザー入力やDB文字列を未加工で `innerHTML` へ入れない。

```text
店舗名
オーナー名
IS備考
商談メモ
AI解析
スクリプト名
資料名
```

既存のUIレンダリングで危険な箇所が今回触る範囲にあれば、
`textContent` または既存escape関数へ修正。

---

# 21. 視覚確認viewport

最低限:

```text
1920 x 1080
1440 x 900
1280 x 800
1100 x 800
900 x 800
390 x 844
```

特に:

```text
1280〜1440px
```

のMacBook相当を重点確認。

---

# 22. テスト

実装前:

```bash
npm test
```

実装後:

```bash
npm test
```

`npm run check` が存在すれば:

```bash
npm run check
```

可能ならPlaywright UI smoke testを追加。

重点テスト:

```text
□ サイドバー文字被りなし
□ スクリプトカードbutton被りなし
□ 編集modalがviewport内
□ 商談準備overflowなし
□ 案件カードoverflowなし

□ 中央タイトルが小型化
□ 「このフェーズの目的」大カードなし
□ HPの役割なし
□ 中央商談メモなし
□ 確認事項なし
□ 回答メモなし
□ 詳細を残すなし
□ 次へ進む条件なし
□ 使用禁止表現なし
□ 戻る場所selectなし
□ 前へ/アウト/次へのみ
□ 左phase一覧から移動可能

□ 右自由入力textareaは1つだけ
□ REACTION ANALYSISなし
□ 反応・言質のAI整理見出しなし
□ 不要説明文なし
□ 大きいメモ入力欄
□ Enter保存
□ Shift+Enter改行
□ 日本語変換中誤送信なし
□ AI整理して保存が動く
□ 原文メモをAI入力元にする
□ 過去メモ折りたたみ
□ アウト返し折りたたみ

□ 商談3列安定
□ 二重スクロールなし
□ 資料バー崩れなし
□ 終了modal見切れなし
□ 横スクロール不要
```

---

# 23. 既存機能回帰

以下が壊れていないこと。

```text
トークスクリプト確認
タイトル編集
フロー編集
内容編集
商談準備保存
案件表示
商談開始
フェーズ移動
メモ保存
自動保存
資料表示
アウト返し
商談中断
商談再開
商談終了
商材チェック
AI解析
案件結果
進捗管理FMT
Obsidian保存
Googleカレンダー連携（存在する場合）
```

---

# 24. 実装順序

以下で進めてください。

```text
1. Git状態・既存テスト確認
2. CSS重複selector調査
3. CSS責務整理
4. スクリプトテンプレ一覧・編集UI
5. 商談準備
6. 各種案件用
7. 商談3列骨格
8. 中央スクリプト簡略化
9. 右商談メモ統合
10. 二重スクロール解消
11. 資料バー
12. 商談終了モーダル
13. 結果・振り返り
14. responsive統一
15. UI smoke test
16. 全既存テスト
```

---

# 25. 完成条件

最終的にFS商談画面は:

```text
左
フェーズ

中央
小さいタイトル
小さい目的
大きな読み上げトーク
前へ / アウト / 次へ

右
商談メモ
大きな入力欄
AI整理して保存
AI整理結果
過去メモ
アウト返し
```

だけを中心に表示する。

商談中に不要な管理用情報は表示しない。

---

# 26. 完了報告

```markdown
# FS UI統合改修結果

## 開始時の状態
- Git:
- Test:

## CSS競合調査
- 重複selector:
- 整理内容:

## トークスクリプトテンプレ
-

## 商談準備
-

## 各種案件用
-

## 商談画面
### 左
-

### 中央
-

### 右
-

## 商談終了
-

## 結果・振り返り
-

## レスポンシブ
-

## UIテスト
- 1920x1080:
- 1440x900:
- 1280x800:
- 1100x800:
- 900x800:
- 390x844:

## 既存機能回帰
- DB:
- Obsidian:
- AI:
- 資料:
- カレンダー:
- FMT:

## 変更ファイル
- `path`: 内容

## テスト
- 実行コマンド:
- 結果:

## 残課題
-

## commit・push
- 実施していない
```

---

# 27. Claude Codeへ最初に渡す文

```text
/Users/maekawahiroyuki/hd-system-auto を対象に、
docs/implementation-prompts/
CLAUDE_CODE_FS_UI_MASTER_20260807.md
を最初から最後まで読み、記載内容をすべて実装してください。

さらに以下3ファイルを詳細仕様として必ず読んでください。

・CLAUDE_CODE_FS_UI_STABILIZATION.md
・CLAUDE_CODE_FS_MEETING_MEMO_UNIFIED_UI.md
・CLAUDE_CODE_FS_MEETING_SCRIPT_MINIMAL_UI.md

競合した場合は、
SCRIPT_MINIMAL_UI
→ MEETING_MEMO_UNIFIED_UI
→ UI_STABILIZATION
の順で新しい要件を優先してください。

今回はFS側のUIをまとめて改善します。

特に、
・CSS競合と文字被り
・トークスクリプトテンプレ
・商談3列
・中央スクリプトの簡略化
・右商談メモの1入力欄統合
・二重スクロール
・終了モーダル
・1280〜1440px
を重点対応してください。

トーク本文、フェーズデータ、SQLite、Obsidian、
資料連動、AI内部ロジック、FMTは変更しないでください。

既存未コミット変更を保持し、
今回はcommit・pushしないでください。

途中確認は不要です。
実装、テスト、UI確認まで実施して結果を報告してください。
```
