# Claude Code 実装指示｜HD AIアシスタント FS UI全面安定化
# 対象: トークスクリプトテンプレ / 商談準備 / 各種案件 / 商談画面 / 結果・振り返り

## 0. 実装対象

```text
/Users/maekawahiroyuki/hd-system-auto
```

GitHub:

```text
https://github.com/hiroyukimaekawa-lang/hd-system-auto.git
```

今回の目的は **FS側のUIだけを整理・安定化すること** です。

業務ロジック、トークスクリプト本文、DBデータ、Obsidian連携、資料連携、AI解析ロジックは変更しないでください。

---

# 1. 最初に現状確認

実装前に必ず以下を確認してください。

```bash
cd "/Users/maekawahiroyuki/hd-system-auto"

pwd
git remote -v
git branch --show-current
git status --short

sed -n '1,260p' desktop/public/styles.css
sed -n '1,360p' desktop/public/css/fs-meeting.css
sed -n '1,260p' desktop/public/css/fs-materials.css
sed -n '1,300p' desktop/public/index.html
sed -n '1,520p' desktop/public/app.js

find desktop/public/js -maxdepth 1 -type f -print | sort
cat package.json
```

既存の未コミット変更を必ず保持してください。

禁止:

```text
git reset
git restore
git clean
git checkout --
自動stash
既存未追跡ファイルの削除
```

今回はcommit・pushしないでください。

---

# 2. 現在確認できているUI課題

現在、FS画面のレイアウト定義が以下に分散しています。

```text
desktop/public/styles.css
desktop/public/css/fs-meeting.css
desktop/public/css/fs-materials.css
```

特に `styles.css` と `fs-meeting.css` の両方で、以下が定義されています。

```text
.assist-grid
.phase-rail
.script-panel
.assist-panel
レスポンシブbreakpoint
```

そのため、

```text
旧CSS
↓
FS専用CSS
↓
旧media query
↓
FS専用media query
```

という上書き構造になっており、画面幅によって文字被り・横はみ出し・意図しない折り返しが発生しやすい状態です。

今回、CSSをさらに上から継ぎ足すだけではなく、FS画面の責務を整理してください。

---

# 3. 今回の絶対条件

変更しないもの:

```text
- 取材用トーク本文
- 通常商談トーク本文
- フェーズ数
- フェーズ順
- 確認事項
- 次へ進む条件
- 商談資料URL
- 資料フェーズ連動
- 商談メモの保存処理
- AI解析処理
- 商談終了ロジック
- Googleカレンダー連携
- Obsidian連携
- SQLite既存データ
- APIレスポンス仕様（UI上必要な軽微拡張を除く）
```

今回の変更は原則:

```text
HTML構造
CSS
フロントエンド上の表示ロジック
レスポンシブ
アクセシビリティ
```

に限定してください。

---

# 4. FSサイドバー

現在の4項目はそのまま維持する。

```text
1. トークスクリプトテンプレ
2. 商談準備
3. 各種案件用
4. 各種案件結果と振り返り
```

要件:

- 文字が2行になってもアイコンや隣の項目と被らない
- 高さを固定しすぎない
- `line-height` を明示する
- 長い項目名は自然に折り返す
- サイドバー幅を縮めた時はアイコン表示へ切替
- 選択中の左アクセント線が文字に重ならない
- 画面高が低い場合でも最下部メニューが見切れない
- サイドバーだけ必要に応じて縦スクロールできる

推奨:

```css
.sidebar button {
  min-height: 52px;
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.45;
}
```

---

# 5. トークスクリプトテンプレ画面

ここを今回の重点対象にする。

## 5.1 一覧カード

スクリプトカードに以下を表示:

```text
スクリプト名
対象顧客
対象商材
バージョン
フェーズ数
状態
```

カード内の文字・ボタンが絶対に重ならないこと。

### 操作ボタン

現在複数の操作が横一列になっている場合:

```text
確認
タイトル編集
フロー編集
内容編集
```

を無理に1行へ並べない。

推奨:

横幅が十分:

```text
[確認] [タイトル編集]
[フロー編集] [内容編集]
```

または:

```text
[確認] [編集 ▼]
```

横幅が狭い:

```text
[確認]
[タイトル編集]
[フロー編集]
[内容編集]
```

最低限:

```css
.script-card footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
```

各ボタンに:

```css
min-width: 0;
white-space: normal;
```

を適用。

## 5.2 一覧グリッド

```text
1440px以上: 3列まで
1000〜1439px: 2列
1000px未満: 1列
```

ただしカード最小幅を確保し、ボタンが潰れる場合は列数を落とす。

推奨:

```css
grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
```

## 5.3 トークスクリプト詳細

詳細画面は以下を明確に分ける。

```text
左: フェーズ一覧
右: フェーズ内容
```

または十分な横幅がない場合:

```text
上: フェーズ選択
下: フェーズ内容
```

表示するもの:

```text
フェーズ名
目的
読み上げスクリプト
確認事項
次へ進む条件
```

読み上げスクリプトは文字幅を広げすぎず、1行が読みやすい長さにする。

```css
max-width: 80ch;
line-height: 1.8;
overflow-wrap: break-word;
```

## 5.4 編集画面

タイトル編集・フロー編集・内容編集のモーダル/画面は:

- 画面外へはみ出さない
- モーダル本文のみスクロール
- 保存/キャンセルボタンは常に操作可能
- textareaは最低240px程度
- 長文入力時にモーダル全体が画面外へ伸びない

推奨:

```css
dialog {
  max-height: 90vh;
}

dialog form {
  max-height: 90vh;
  overflow-y: auto;
}
```

---

# 6. 商談準備画面

現行項目・機能は変更しない。

UIのみ以下を修正:

- ラベルと入力欄が被らない
- URLや住所の長文が横にはみ出さない
- 2列表示が狭い時は1列へ落とす
- 必須/任意が視覚的に分かる
- textareaが適切な高さ
- 保存ボタンが他要素と被らない

推奨:

```text
1200px以上: 2列
1200px未満: 1列またはauto-fit
```

---

# 7. 各種案件用

案件カードは現在の情報量を維持する。

要件:

- 店舗名が長くてもはみ出さない
- オーナー名・日時・ステータスが被らない
- アクションボタンを折り返す
- URLを生文字列で横長表示しない
- ステータスbadgeがカード外へ出ない

```css
.deal-card,
.deal-card * {
  min-width: 0;
}

.deal-card-head h3,
.deal-field b {
  overflow-wrap: anywhere;
}
```

---

# 8. 商談画面

商談画面は現在の基本構成を維持する。

```text
事前情報
資料バー
─────────────────────────
フェーズ一覧 | スクリプト | メモ
```

## 8.1 事前情報

現在のコンパクト方式を維持。

表示:

```text
店舗名
オーナー名
HP/SNSリンク
IS備考
必要に応じて住所
```

不要な大きなヘッダーは復活させない。

長文は2行程度でclampし、全文表示で展開。

展開時に下のスクリプトを押しつぶしすぎない。

## 8.2 3列構成

1440px以上:

```text
フェーズ: 220〜250px
スクリプト: 残り幅
メモ: 320〜380px
```

1100〜1439px:

```text
フェーズ: 190〜220px
スクリプト: 残り幅
メモ: 300〜340px
```

1100px未満:

- サイドバーを自動縮小
- フェーズ一覧を折りたたみ/ドロワー化してよい
- スクリプトを最優先
- メモは300px程度またはドロワー化

重要:

```css
grid-template-columns
```

の値を `styles.css` と `fs-meeting.css` の両方で競合させないこと。

FS商談画面の正式なレイアウト定義は:

```text
desktop/public/css/fs-meeting.css
```

へ集約すること。

`styles.css` に残る旧 `.assist-grid` 系は:

- 共通最低限のみ残す
- FS画面で競合する定義を削除または明確にスコープ外へする

## 8.3 フェーズ一覧

現在、長いフェーズ名がある。

要件:

- 1行固定にしない
- 2〜3行まで自然に表示
- 文字を途中で切らない
- active状態でも読み取れる
- 番号と本文が被らない

禁止:

```css
white-space: nowrap;
```

をフェーズタイトルへ使用。

推奨:

```css
.phase-rail button b {
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.45;
}
```

## 8.4 スクリプト本文

現在の `.script-panel` と `.document-script` の二重スクロールを解消する。

正式仕様:

```text
script-panel 自体を縦スクロール
document-script 内部は原則スクロールさせない
```

つまり原則:

```css
.document-script {
  max-height: none;
  overflow: visible;
}
```

とし、中央カラム全体でスクロールする。

これにより、マウスホイール位置によってスクロール先が変わる状態をなくす。

### 文字

```text
本文: 16〜18px
line-height: 1.75〜1.9
見出し: clampを利用
```

```css
.script-panel h1 {
  font-size: clamp(26px, 3vw, 40px);
}
```

日本語長文の読みやすさを最優先。

## 8.5 確認事項

チェックボックスと文章が重ならない。

```css
.check-list label {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
}
```

長い文章は複数行で表示。

## 8.6 右側メモ

既存の保存機能は変更しない。

UI:

- 入力欄は常時見える
- 過去メモはその下
- AI解析はさらに下
- 右カラム全体が独立スクロール
- メモ入力欄だけ画面外に流れない

ただし `position: sticky` が原因で重なりが出る場合は、右カラム内だけのstickyとして正しく実装する。

固定操作バーとメモ入力欄が重ならないよう、下paddingを右カラムだけでなく必要な全カラムへ適用。

---

# 9. 資料バー

既存機能を維持。

要件:

- 1〜2行以内
- 長い資料名はellipsisまたは適切に折り返し
- ボタン同士が被らない
- 資料がない時に高さを大きく取らない
- 「全資料を見る」が画面外へ飛び出さない
- 横スクロールする場合は資料ボタンだけ

---

# 10. 商談終了モーダル

既存の最新仕様を維持。

UI上は:

```text
今回扱った商材
次の行動
原文メモ
AIによる整理結果
担当者振り返り
引き継ぎFMT
保存して終了
```

が見やすくなるようにする。

要件:

- 画面高が低くても「保存して終了」に到達できる
- dialog全体ではなく内容部分をスクロール
- footer操作をstickyにしてもよい
- select/checkbox/textareaが横にはみ出さない
- AI解析長文でdialog幅が広がらない
- 原文メモの長文も `white-space: pre-wrap; overflow-wrap:anywhere;`

モーダル幅:

```css
width: min(900px, calc(100vw - 32px));
max-height: 92vh;
```

---

# 11. 各種案件結果と振り返り

詳細画面:

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

をカード/セクション単位で表示する。

要件:

- 長文が隣セクションへ侵入しない
- 編集ボタンが見出しと被らない
- メモ追記・編集のボタンは折り返し可能
- AI解析と原文メモを視覚的に分離
- 画面幅が狭い時は1列

---

# 12. CSSの責務整理

今回の重要部分。

## styles.css

担当:

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

担当:

```text
FSサイドバー
FS商談準備
FS案件カード
FSトークスクリプトテンプレ
FS商談3列画面
FS終了・結果画面
FS専用レスポンシブ
```

## fs-materials.css

担当:

```text
商談資料バー
資料ライブラリ
資料カード
```

同じselectorを複数ファイルから競合して定義しない。

特に以下の正式定義を1箇所へ集約:

```text
.assist-grid
.phase-rail
.script-panel
.note-column
.script-card
.deal-card
```

---

# 13. Breakpointを整理

FS UIで使用する主要breakpointは原則4段階へ統一する。

```text
1440px以上
1100〜1439px
768〜1099px
767px以下
```

必要な例外は認めるが、現在のように:

```text
1439
1400
1200
1100
1050
900
800
700
650
600
```

を無秩序に混在させない。

既存共通UI由来のbreakpointを変更すると他画面へ影響する場合は、FS専用scope内で整理する。

---

# 14. overflowの原則

すべてのFlex/Grid子要素に必要に応じて:

```css
min-width: 0;
min-height: 0;
```

を設定。

長文:

```css
overflow-wrap: anywhere;
word-break: normal;
```

URL:

```css
overflow-wrap: anywhere;
```

ボタン:

```css
white-space: normal;
```

ただし短いCTAはnowrapでもよい。

横方向の `overflow:hidden` で単純に問題を隠さないこと。

---

# 15. アクセシビリティ

- buttonのクリック領域最低44px程度
- focus-visibleを消さない
- テキストを色だけで区別しない
- モーダルの閉じる/キャンセルを明確化
- checkbox label全体をクリック可能
- 文字サイズ14px未満を多用しない
- 重要な本文は16px以上

---

# 16. XSS / HTML安全

UI改修時も以下を維持。

```text
店舗名
オーナー名
IS備考
メモ
AI解析
スクリプト名
資料名
```

を未加工で `innerHTML` に入れない。

既存実装で危険な箇所を見つけた場合、UI改修範囲内で `textContent` またはescape関数へ変更する。

ただし業務ロジックの大規模改修はしない。

---

# 17. 視覚テスト対象

最低限以下のviewportで確認する。

```text
1920 x 1080
1440 x 900
1280 x 800
1100 x 800
900 x 800
390 x 844
```

特にMacBook/13インチ相当:

```text
1280〜1440幅
```

を重点確認する。

各viewportで確認:

```text
- サイドバー
- トークスクリプトテンプレ一覧
- スクリプト詳細
- 商談準備
- 各種案件用
- 商談実行画面
- 商談終了モーダル
- 各種案件結果と振り返り
```

---

# 18. 自動UI確認

Playwrightが利用可能なため、可能ならUI smoke testを追加する。

例:

```text
test/fs-ui-layout.test.js
```

確認:

- 横スクロールが発生していない
- 主要要素のbounding boxが重なっていない
- ボタンがviewport外へ出ていない
- dialogがviewport内
- 商談3列が期待通り
- 1100px未満でfallback layoutになる

DOMの `scrollWidth > clientWidth` を主要containerで確認するテストも追加してよい。

スクリーンショットテストを導入する場合、環境依存で不安定にならないよう最低限にする。

---

# 19. 既存機能回帰テスト

以下を壊さない。

```text
- スクリプト確認
- タイトル編集
- フロー編集
- 内容編集
- 商談準備保存
- 商談開始
- フェーズ移動
- 商談メモ
- メモ自動保存
- 資料表示
- 商談中断
- 商談再開
- 商談終了
- 商材チェック
- AI解析
- 案件結果表示
- Obsidian保存
```

---

# 20. 実装方針

最初に現在のCSSの競合を洗い出し、不要な旧定義を整理する。

推奨順:

```text
1. CSS責務調査
2. 重複selector一覧を作る
3. FS専用定義をfs-meeting.cssへ集約
4. スクリプトテンプレ一覧修正
5. 商談画面3列修正
6. 二重スクロール解消
7. モーダル修正
8. その他FS画面修正
9. responsive統一
10. smoke test
```

無関係なデザイン刷新はしない。

現在の:

```text
深緑
生成り
コーラル
ミント
```

のブランドカラー・世界観は維持する。

---

# 21. 完成条件

以下をすべて満たす。

```text
□ トークスクリプト一覧で文字・ボタンが被らない
□ スクリプトカードが画面幅に応じて自然に1〜3列へ変化する
□ スクリプト詳細の長文が読みやすい
□ 編集modalが画面外へ出ない
□ サイドバーの長い文字が被らない
□ 商談準備フォームが横にはみ出さない
□ 案件カードの店舗名・ボタンが被らない
□ 商談画面の3列が安定している
□ フェーズ名が途中で不自然に切れない
□ スクリプト本文の二重スクロールがない
□ メモ入力欄が常時利用できる
□ 資料バーが高さを取りすぎない
□ 終了modalで保存ボタンへ必ず到達できる
□ 1280〜1440pxで商談に実用的な表示になる
□ 900px以下でも操作不能にならない
□ 横スクロールが不要
□ 既存トーク本文が変更されていない
□ 既存データ・Obsidian同期が壊れていない
```

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

`npm run check` が存在する場合:

```bash
npm run check
```

存在しない場合は `package.json` 上の利用可能なlint / syntax / testを実行する。

可能ならPlaywright UI smoke testも実行。

---

# 23. Git安全ルール

今回:

```text
commitしない
pushしない
```

既存未コミット変更を保持。

実装後:

```bash
git status --short
git diff --stat
```

を報告する。

---

# 24. 完了報告

```markdown
# FS UI改修結果

## 調査したUI構造
-

## CSS競合
- 削除・整理した重複:
- 正式な定義先:

## トークスクリプトUI
-

## 商談画面
-

## 商談準備
-

## 案件一覧・結果
-

## レスポンシブ
-

## 二重スクロール
-

## XSS/UI安全性
-

## 変更ファイル
- `path`: 内容

## テスト
- 開始時:
- 実装後:
- UI確認viewport:
- 実行コマンド:

## 既存機能保護
- トーク本文:
- DB:
- Obsidian:
- 資料連動:
- AI解析:

## 残課題
-

## commit・push
- 実施していない
```

---

# 25. Claude Codeへ最初に入力する文

```text
/Users/maekawahiroyuki/hd-system-auto を対象に、
docs/implementation-prompts/CLAUDE_CODE_FS_UI_STABILIZATION.md
を最初から最後まで読み、記載内容をすべて実装してください。

今回はFS側のUI安定化だけを行ってください。
トークスクリプト本文、フェーズ、DB、Obsidian連携、資料連動、AI解析ロジックは変更しないでください。

特に、
・トークスクリプトテンプレの文字/ボタン被り
・CSS競合
・商談画面3列
・フェーズ名の折り返し
・スクリプト本文の二重スクロール
・終了モーダル
・1280〜1440pxのMacBook相当表示
を重点修正してください。

既存未コミット変更を保持し、今回はcommit・pushしないでください。
実装後は全テストとUI確認を行い、結果を報告してください。
```
