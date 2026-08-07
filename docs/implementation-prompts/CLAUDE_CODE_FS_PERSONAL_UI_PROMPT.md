# Claude Code 実装指示｜HD AIアシスタント FS個人画面・商談資料・取材トーク連動

以下をそのまま実行してください。

## 1. 実装対象

```text
/Users/maekawahiroyuki/hd-system-auto
```

GitHubリポジトリ:

```text
https://github.com/hiroyukimaekawa-lang/hd-system-auto.git
```

このリポジトリ以外は修正しないでください。

```text
参照のみ:
/Users/maekawahiroyuki/Desktop/HD-Automation

起動確認:
/Users/maekawahiroyuki/Desktop/HD AIアシスタント.app
```

`Desktop/HD-Automation` は旧版・参照専用です。変更、コミット、pushを行わないでください。

---

## 2. 最初に必ず行うこと

実装前に次を確認してください。

```bash
cd "/Users/maekawahiroyuki/hd-system-auto"
pwd
git remote -v
git status --short
git branch --show-current
find docs/requirements/fs-sales -maxdepth 2 -type f 2>/dev/null | sort
```

重要:

- 既存の未コミット変更を保持する
- `git reset`、`git restore`、`git checkout --`、`git clean`、自動stashを行わない
- 既存ファイルや未追跡ファイルを勝手に削除しない
- 実装中に既存変更との競合を見つけた場合は、既存変更を優先して統合する
- 今回はcommit・pushを行わない
- `.env`、認証情報、SQLite実データ、ログ、ブラウザセッションをGit管理へ追加しない

---

## 3. 必ず読む要件ファイル

```text
docs/requirements/fs-sales/FS_PERSONAL_UI_MATERIALS_INTERVIEW_REQUIREMENTS.md
config/fs-sales/fs-interview-script-phase-map.json
config/private/fs-sales-materials.local.json
```

この3ファイルを実装の正本としてください。

`config/private/fs-sales-materials.local.json` には社内用Google Drive URLやアフィリエイト管理情報が含まれます。公開GitHubへ追加しないでください。

`.gitignore` に以下がなければ追加してください。

```gitignore
config/private/
```

---

## 4. 今回の実装目的

既存のHD AIアシスタント内にあるFS個人画面を、実際の商談順に使いやすく改修してください。

### サイドバー

上から次の4項目にしてください。

```text
1. トークスクリプトテンプレ
2. 商談準備
3. 各種案件用
4. 各種案件結果と振り返り
```

既存の配色と基本デザインは維持してください。

### 商談準備

次の情報を登録・保存できるようにしてください。

必須:

- 店舗名
- オーナー名
- 商談担当者
- IS担当者
- 商談日時
- 対象商材
- IS時点での備考

任意:

- 住所
- 店舗電話番号
- オーナー携帯番号
- 公式HP
- Instagram
- Googleマップ
- その他SNS・参考URL
- 決裁者情報
- IS時点の懸念
- アポ獲得経緯
- IS時点の温度感

### 商談画面

商談画面を次の構成にしてください。

```text
上部: 店舗情報ヘッダー
中央左: 現在のトークスクリプト
中央上または店舗情報直下: 現在フェーズで使用する資料
右側: 常時表示される殴り書きメモ
```

店舗情報ヘッダーには、商談準備で入力した以下を自動表示してください。

- 店舗名
- オーナー名
- HP・Instagram・Googleマップ・その他リンク
- IS時点での備考
- 商談日時
- IS担当者
- 対象商材
- 決裁者情報

URLがない項目は表示しないでください。リンクは新しいタブで開き、`rel="noopener noreferrer"` を付けてください。

### 右側メモ

- 商談中は常に表示
- スクリプトとは独立してスクロール
- Enterでメモ追加
- Shift+Enterで改行
- 日本語変換中のEnter誤送信を防止
- 入力時刻と現在フェーズを保存
- 自動保存
- 再読み込み後に復元
- 商談中断・再開後に復元
- XSS対策を行う

---

## 5. 取材用トークの正本

要件ファイルに記載されている以下を、そのまま実装してください。

```text
名称: 取材用トーク
バージョン: 2026/07/30
対象商材: HP無料制作
対象顧客: 店舗オーナー・小規模事業者
フェーズ数: 10
```

フェーズ:

```text
① 挨拶・前提のすり合わせ
② 本日のアジェンダ
③ 決裁権の確認
④ 会社紹介
⑤ なぜ今ホームページなのか
⑥ 当社がホームページ事業を行う理由
⑦ 制作事例の紹介
⑧ インタビュー
⑨ ホームページの用途・方向性確認
⑩ 無料制作の条件提示・申し込み
```

最重要:

- 読み上げスクリプトを要約しない
- 校正しない
- 言い換えない
- 文言を勝手に追加・削除しない
- 確認事項を変更しない
- 次へ進む条件を変更しない
- ⑩-2「申込書説明」は11フェーズ目にしない
- ⑩内のサブセクションとして扱う

⑩のサブセクション:

```text
phase_10_scheme
phase_10_provider_check
phase_10_electricity_offer
phase_10_card_branch
phase_10_application_form
phase_10_objection_pre_screening
phase_10_line_cloudsign
```

---

## 6. 商談資料ライブラリ

「トークスクリプトテンプレ」画面内に次のタブを作ってください。

```text
[トークスクリプト] [商談資料ライブラリ]
```

資料ライブラリで最低限、次を表示してください。

- 資料名
- カテゴリ
- 対象商材
- 使用フェーズ
- 使用サブセクション
- 開くボタン
- 有効・無効
- 表示順

実際の資料URLは `config/private/fs-sales-materials.local.json` から読み込み、必要であればSQLiteへ初期登録してください。

資料URLをHTMLやフロントエンドJavaScriptへ直書きしないでください。

---

## 7. フェーズ・資料連動

`phaseId` と `sectionId` を使って、現在のトーク位置に合う資料を自動表示してください。

### ④〜⑥

- 新規事業ご提案資料

### ⑦ 制作事例

次の順番で表示してください。

```text
1. sankouin
2. Art Crafter
```

### ⑧ インタビュー

資料を大量表示せず、次の6項目を構造化保存できる入力欄を表示してください。

- 開業時期・開業のきっかけ
- 店舗の強み・コンセプト
- おすすめ商品・メニュー
- 増やしたいターゲット
- 今後の展望
- 現在の課題・理想とのギャップ

右側の殴り書きメモとは別データとして保存してください。

### ⑨ 用途・方向性確認

⑧の構造化回答を確認できるようにしてください。

`〇〇`へ入れる候補を補助表示しても構いませんが、読み上げ本文を自動置換しないでください。

### ⑩ 無料制作条件・申込

サブセクションごとに表示資料を切り替えてください。

```text
phase_10_scheme:
- 新規事業ご提案資料
- エネパル公式サイト

phase_10_provider_check:
- エネパル公式サイト

phase_10_electricity_offer:
- パルパワー料金表
- 関東エリア・違約金・事務手数料

phase_10_card_branch:
- 選択したカードの申込マニュアル
- アフィリエイトリンク管理表

phase_10_application_form:
- エネパル申込書テンプレート

phase_10_objection_pre_screening:
- エネパル申込書テンプレート

phase_10_line_cloudsign:
- エネパル申込書テンプレート
```

カード未選択時は、次の選択ボタンだけを表示してください。

```text
AMEX
三井住友ビジネスオーナーズ
ACマスターカード
```

カード選択後は、選択したカードの資料を優先表示してください。3種類すべてのマニュアルを同時表示しないでください。

---

## 8. ⑩で保存する状態

最低限、次を商談セッションへ保存してください。

```json
{
  "electricityProvider": "",
  "electricityEligibility": "unknown",
  "monthlyElectricityCost": null,
  "selectedAlternativeService": null,
  "selectedCardProduct": null,
  "applicationFormReviewed": false,
  "officialLineAdded": false,
  "cloudsignSent": false,
  "cloudsignSigned": false
}
```

`electricityEligibility`:

```text
unknown
eligible
ineligible_existing_group
needs_manual_review
```

電力会社名だけで確定せず、FS担当者が手動修正できるようにしてください。

---

## 9. 資料を開いた操作履歴

資料リンクを開いた時、次を保存してください。

```json
{
  "meetingId": "",
  "materialId": "",
  "phaseId": "",
  "sectionId": "",
  "openedAt": ""
}
```

これは顧客の閲覧証明ではなく、FS担当者が資料リンクを開いた操作履歴です。

---

## 10. 既存機能を壊さないこと

以下を維持してください。

- 現在の商談開始
- 中断
- 再開
- 終了
- 既存メモ
- 進捗管理FMT
- アウト返し
- 商談履歴
- Obsidian保存
- SQLite既存データ
- 現在の未コミット実装

DB変更が必要な場合は、既存データを消さない追加マイグレーションにしてください。

---

## 11. セキュリティ

- 店舗名、オーナー名、IS備考、メモ、資料名を未加工の `innerHTML` へ入れない
- 原則 `textContent` または安全なエスケープ処理を使う
- URLは `http:` と `https:` のみ許可
- `javascript:` 等を拒否
- 資料APIで存在しないIDや他案件IDを検証
- private設定ファイルをGitへ追加しない
- 認証情報や実データを出力ログへ表示しない

---

## 12. 実装方針

現在の構成を先に調査し、既存設計へ合わせて実装してください。

想定対象:

```text
desktop/public/index.html
desktop/public/app.js
desktop/public/styles.css
desktop/server.js
src/sales-assist.js
config/sales-assist/
test/sales-assist.test.js
```

`app.js` や `sales-assist.js` が肥大化している場合は、責務を分割して構いません。ただし、大規模な無関係リファクタリングはしないでください。

推奨分割例:

```text
desktop/public/js/fs-sidebar.js
desktop/public/js/fs-deal-header.js
desktop/public/js/fs-meeting-note.js
desktop/public/js/fs-materials.js
desktop/public/css/fs-meeting.css
src/fs-materials.js
```

既存構成に合わない場合は無理にこの名前へ合わせず、同等の責務分離を行ってください。

---

## 13. 実装手順

1. 現在のファイル構成とGit差分を確認
2. 既存のFSデータモデル、API、画面遷移を確認
3. 既存テストを先に実行し、開始時点の状態を記録
4. 必要な追加マイグレーションを作成
5. サイドバーを改修
6. 商談準備項目を追加
7. 店舗情報ヘッダーを実装
8. 右側メモを固定・自動保存
9. 取材用トーク10フェーズを正本へ合わせる
10. 資料ライブラリを実装
11. phaseId・sectionId連動表示を実装
12. ⑧の6項目を構造化保存
13. ⑨で⑧の回答を表示
14. ⑩の電気・カード・申込状態を保存
15. 資料を開いた履歴を保存
16. XSS・URL検証を実装
17. 既存・追加テストを実行
18. 実装結果を報告

---

## 14. テスト

最低限、次を追加または更新してください。

- サイドバー4項目と順番
- 旧メニューの重複がない
- 商談準備情報の保存
- 店舗情報ヘッダーへの反映
- リンクがあるものだけ表示
- 外部リンクの安全属性
- 右側メモの保存・復元
- Enter、Shift+Enter、日本語変換中Enter
- 10フェーズの順番と名称
- ⑩-2が11フェーズ目になっていない
- スクリプト本文の一致
- ④〜⑦、⑩の資料表示
- ⑦の制作事例の順番
- ⑧の6項目保存
- ⑨で⑧の回答表示
- ⑩の電力会社・カード・申込状態保存
- 選択カードだけ優先表示
- 資料オープン履歴保存
- XSS文字列が実行されない
- 不正URLが拒否される
- 商談中断・再開
- 進捗管理FMT
- Obsidian保存

実装後に次を実行してください。

```bash
npm test
```

`check` スクリプトが存在する場合:

```bash
npm run check
```

存在しない場合は勝手に成功扱いにせず、`package.json` にある既存のlint、typecheck、syntax check相当を実行し、何を実行したか報告してください。

---

## 15. 実装完了時の報告形式

次の形式で報告してください。

```markdown
# 実装結果

## 実装した内容
- 

## 変更ファイル
- `path`: 内容

## DB・マイグレーション
- 

## API変更
- 

## UI変更
- 

## テスト結果
- 実行コマンド:
- 成功:
- 失敗:
- 開始時点から存在した失敗:

## 動作確認
- 

## 既存未コミット変更への対応
- 

## Git管理対象外を確認したもの
- `config/private/`
- `.env`
- SQLite実データ
- 認証セッション

## 残課題
- 

## commit・push
- 実施していない
```

実装が完了しても、commit・pushは行わないでください。
