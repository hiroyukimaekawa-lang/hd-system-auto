# Claude Code 実装指示書
# HD AIアシスタント｜Obsidian IA再設計（HDシステム → IS / FS / CS）

## 0. 実装対象

ローカルリポジトリ:

```text
/Users/maekawahiroyuki/hd-system-auto
```

GitHub:

```text
https://github.com/hiroyukimaekawa-lang/hd-system-auto.git
```

現在のObsidian Vault実体として想定されるローカルパス:

```text
/Users/maekawahiroyuki/Library/CloudStorage/Dropbox/maehiro/個人用/AI会社/memory/company
```

ただし、この絶対パスをコードへ固定しないこと。既存のObsidian設定と `vaultId` 解決ロジックを優先する。

---

## 1. 目的

現在のHD AIアシスタントはObsidianと連携しており、FS商談情報などをMarkdownへ保存している。

今回、Obsidian内のHD事業部情報をGraph View上で以下のように見える構造へ整理する。

```text
                    HDシステム
                  /     |      \
                 /      |       \
               IS       FS       CS
              /|\      /|\      /|\
             / | \    / | \    / | \
        リスト 架電   商談準備   制作進捗
        Comdesk KPI   商談管理   素材回収
        前確          商談資料   修正管理
                      引き継ぎ   公開管理
```

フォルダ階層だけでなく、Obsidian Wikiリンク `[[...]]` を使って親子関係を作り、Graph Viewでも `HDシステム → IS / FS / CS → 各機能 → 各案件` の関係が見えるようにする。

---

## 2. 絶対条件（非破壊）

今回の変更は必ず非破壊で行う。

禁止:

```text
- 既存Vaultファイルの移動
- 既存Vaultファイルの改名
- 既存Vaultファイルの削除
- 既存Markdownの一括移行
- 既存添付ファイルの移動
- 既存JSONの削除
- 既存のHD AIアシスタント保存パスを壊す変更
- 既存の商談準備・商談案件・スクリプト保存を止める変更
- .obsidian/配下の大規模変更
```

現在の保存先:

```text
HD事業部/商談支援
```

およびその配下の既存ファイルはその場に残すこと。

`src/obsidian-sales-archive.js` の既存保存機能を壊さないこと。

---

## 3. 現在のObsidian連携

設定:

```text
config/sales-assist/obsidian.json
```

主要実装:

```text
src/obsidian-sales-archive.js
```

現在の主な出力:

```text
HD事業部/商談支援/
├── 商談内容/
│   ├── 商談準備/
│   └── 案件/
└── 各種スクリプト/
```

この既存保存構造は後方互換のため維持する。

---

## 4. Vault方針

Vaultは分割しない。

```text
company = 会社用の単一Vault
```

この1つのVaultの中でHD事業部の論理構造を分ける。

理由:

- IS / FS / CSを1枚のGraph Viewで確認できる
- 案件をIS → FS → CSでつなげられる
- 同一顧客を部署横断で追跡できる
- Vault分割によるリンク切断を避けられる

---

## 5. 新規追加する情報設計

既存ファイルは移動せず、以下を新規追加する。

```text
HD事業部/
│
├── HDシステム.md
│
├── IS/
│   ├── IS.md
│   ├── IS_リスト取得.md
│   ├── IS_Comdesk.md
│   ├── IS_架電管理.md
│   ├── IS_前確管理.md
│   ├── IS_アポ管理.md
│   ├── IS_KPI.md
│   └── 案件/
│
├── FS/
│   ├── FS.md
│   ├── FS_商談準備.md
│   ├── FS_トークスクリプト.md
│   ├── FS_商談資料.md
│   ├── FS_商談管理.md
│   ├── FS_商談結果と振り返り.md
│   ├── FS_引き継ぎFMT.md
│   ├── FS_KPI.md
│   └── 案件/
│
├── CS/
│   ├── CS.md
│   ├── CS_制作引き継ぎ.md
│   ├── CS_制作進捗.md
│   ├── CS_素材回収.md
│   ├── CS_修正管理.md
│   ├── CS_公開管理.md
│   └── 案件/
│
└── 共通/
    ├── HD_商材.md
    ├── HD_顧客.md
    ├── HD_KPI定義.md
    └── HD_業務ルール.md
```

`IS/案件`, `FS/案件`, `CS/案件` は将来の新規保存先候補として作成してよいが、今回既存案件ファイルをそこへ移動しない。

---

## 6. 親ノート

### 6.1 `HD事業部/HDシステム.md`

```markdown
---
type: hd-system-root
department: HD
status: active
managed_by: hd-ai-assistant
managed_version: 1
---

# HDシステム

HD事業部の業務・システム全体をつなぐ親ノート。

## 部署

- [[IS]]
- [[FS]]
- [[CS]]

## 共通

- [[HD_商材]]
- [[HD_顧客]]
- [[HD_KPI定義]]
- [[HD_業務ルール]]
```

### 6.2 `HD事業部/IS/IS.md`

```markdown
---
type: hd-department
department: IS
parent: HDシステム
status: active
managed_by: hd-ai-assistant
managed_version: 1
---

# IS

親：[[HDシステム]]

## ISシステム

- [[IS_リスト取得]]
- [[IS_Comdesk]]
- [[IS_架電管理]]
- [[IS_前確管理]]
- [[IS_アポ管理]]
- [[IS_KPI]]
```

### 6.3 `HD事業部/FS/FS.md`

```markdown
---
type: hd-department
department: FS
parent: HDシステム
status: active
managed_by: hd-ai-assistant
managed_version: 1
---

# FS

親：[[HDシステム]]

## FSシステム

- [[FS_商談準備]]
- [[FS_トークスクリプト]]
- [[FS_商談資料]]
- [[FS_商談管理]]
- [[FS_商談結果と振り返り]]
- [[FS_引き継ぎFMT]]
- [[FS_KPI]]
```

### 6.4 `HD事業部/CS/CS.md`

```markdown
---
type: hd-department
department: CS
parent: HDシステム
status: planned
managed_by: hd-ai-assistant
managed_version: 1
---

# CS

親：[[HDシステム]]

## CSシステム

- [[CS_制作引き継ぎ]]
- [[CS_制作進捗]]
- [[CS_素材回収]]
- [[CS_修正管理]]
- [[CS_公開管理]]
```

CSが未実装なら、実装済みとして偽装せず `status: planned` とする。

---

## 7. 各機能ノート

各機能ノートは必ず所属部署の親ノートへリンクする。

例 `FS_商談準備.md`:

```markdown
---
type: hd-system-module
department: FS
status: active
managed_by: hd-ai-assistant
managed_version: 1
---

# FS 商談準備

親：[[FS]]
上位：[[HDシステム]]

## 役割

HD AIアシスタントのFS商談準備情報を扱う。

## 関連

- [[FS_商談管理]]
- [[FS_トークスクリプト]]
```

IS・FS・CSすべて同じルールにする。

---

## 8. 既存FS案件をGraph Viewへ接続

既存案件ファイルは移動しない。

`src/obsidian-sales-archive.js` の `syncSession()` で生成するMarkdownへ以下を追加する。

Frontmatter:

```yaml
department: FS
system_parent: HDシステム
module: FS_商談管理
```

本文:

```markdown
## HDシステム

- 親：[[FS]]
- 上位：[[HDシステム]]
- 機能：[[FS_商談管理]]
```

これにより保存場所が従来のままでもGraph Viewでは:

```text
HDシステム
  ↓
FS
  ↓
FS_商談管理
  ↓
各案件
```

とつながる。

---

## 9. 商談準備ノートをFSへ接続

`syncPreparation()` へ追加。

Frontmatter:

```yaml
department: FS
system_parent: HDシステム
module: FS_商談準備
```

本文:

```markdown
## HDシステム

- 親：[[FS]]
- 上位：[[HDシステム]]
- 機能：[[FS_商談準備]]
```

---

## 10. トークスクリプトをFSへ接続

`syncTalkScripts()` へ追加。

Frontmatter:

```yaml
department: FS
system_parent: HDシステム
module: FS_トークスクリプト
```

本文:

```markdown
## HDシステム

- 親：[[FS]]
- 上位：[[HDシステム]]
- 機能：[[FS_トークスクリプト]]
```

---

## 11. アウト返し・反応関連もFSへ接続

`syncObjectionBooks()` が生成するMarkdownにも以下を入れる。

```markdown
- 親：[[FS]]
- 上位：[[HDシステム]]
- 機能：[[FS_トークスクリプト]]
```

---

## 12. IS・CSの扱い

今回、IS・CS側のObsidian自動同期が未実装なら、以下だけ作る。

- 親ノート
- 機能ノート
- フォルダ
- Frontmatter
- Wikiリンク

存在しない案件データは生成しない。

今回の優先はGraph Viewの情報設計。

---

## 13. 顧客ノードの将来設計

将来的に同じ顧客をIS → FS → CSで追えるようにテンプレートだけ用意する。

保存候補:

```text
HD事業部/共通/顧客/
```

テンプレート:

```markdown
---
type: hd-customer
customer_id: ""
customer_name: ""
---

# 顧客名

## 関連部署

- [[IS]]
- [[FS]]
- [[CS]]

## IS

## FS

## CS
```

既存顧客を大量生成しない。

---

## 14. Graph Viewノイズ対策

現在Graph Viewには `README`, `LICENSE`, `CHANGELOG` などのノードが多数表示されている。

`.obsidian/` の設定を強制変更しない。

代わりに以下を作る。

```text
HD事業部/HD_グラフビュー設定.md
```

内容はObsidianで有効なGraph filter構文を確認して記載する。

最低限:

```text
HD事業部だけを見る
README / LICENSE / CHANGELOGを除外する
FSだけを見る
```

目標:
`HDシステム.md` を開いてLocal Graphを表示した際に、`HDシステム → IS / FS / CS → 各機能` が見やすいこと。

---

## 15. INDEX / MOC方針

フォルダ自体はGraph Viewのノードにならない。

そのため:

```text
HD事業部/IS/IS.md
HD事業部/FS/FS.md
HD事業部/CS/CS.md
```

を各部署のINDEX/MOCとして使う。

新規 `README.md` は作らない。Graph ViewにREADMEノードを増やさない。

---

## 16. 設定ファイルの後方互換拡張

現在の `config/sales-assist/obsidian.json` の `vaultId` と `folder` は変更しない。

後方互換で以下を追加してよい。

```json
{
  "enabled": true,
  "vaultId": "既存値",
  "folder": "HD事業部/商談支援",
  "architecture": {
    "rootNote": "HD事業部/HDシステム.md",
    "isNote": "HD事業部/IS/IS.md",
    "fsNote": "HD事業部/FS/FS.md",
    "csNote": "HD事業部/CS/CS.md"
  }
}
```

`architecture` が存在しなくても既存連携が動くこと。

---

## 17. 新規実装クラス

既存 `ObsidianSalesArchive` へ全責務を詰め込まない。

推奨追加:

```text
src/obsidian-hd-architecture.js
```

責務:

```text
- HDシステム親ノート作成
- IS / FS / CS親ノート作成
- 各機能ノート作成
- 共通ノート作成
- Graph View設定ガイド作成
- 既存業務ノートは移動しない
```

API例:

```js
export class ObsidianHdArchitecture {
  constructor({ archive, store }) {}
  ensureStructure() {}
  ensureRootNote() {}
  ensureDepartmentNotes() {}
  ensureModuleNotes() {}
  ensureCommonNotes() {}
}
```

---

## 18. 自動生成ノートの安全な更新

HD AIアシスタントが作るMOC/INDEXにはmanaged markerを入れる。

```markdown
<!-- HD_AI_ASSISTANT_MANAGED_START -->
自動管理領域
<!-- HD_AI_ASSISTANT_MANAGED_END -->

## 自由メモ

ここはユーザーが自由に編集可能
```

既存ファイル更新時はmanaged領域だけ更新する。

ユーザー自由記述を全文上書きしない。

自動生成ノートには:

```yaml
managed_by: hd-ai-assistant
managed_version: 1
```

を付与する。

---

## 19. 初期化タイミング

HD AIアシスタント起動時に毎回全文上書きしない。

推奨:

- サーバー起動時またはObsidian同期初期化時に存在確認
- 不足しているMOC/INDEXだけ作成
- 既存managed noteはmanaged領域だけ更新
- ユーザー自由記述を保持

---

## 20. 既存データのバックフィル

今回、既存Vault全件を自動で一括書き換えしない。

基本は「今後同期された案件だけ親リンクを追加」とする。

必要なら明示実行コマンドを追加してよい。

```bash
npm run obsidian:hd-backfill
```

ただし:

- dry-runを既定
- `--apply` がない限り書き換えない
- ファイル移動禁止
- ファイル名変更禁止
- 本文削除禁止
- 親リンクが存在しない時だけ追記
- Frontmatterキーがなければ追加
- 適用前バックアップ

バックフィル実装は必須ではない。

---

## 21. テスト

追加推奨:

```text
test/obsidian-hd-architecture.test.js
```

最低限テスト:

1. 既存Vaultファイルを移動しない
2. 既存Vaultファイルを削除しない
3. `HDシステム.md` が作成される
4. `IS.md` / `FS.md` / `CS.md` が作成される
5. HDシステムからIS/FS/CSへWikiリンクがある
6. FSから各FS機能へWikiリンクがある
7. ISから各IS機能へWikiリンクがある
8. CSから各CS機能へWikiリンクがある
9. FS商談案件に `[[FS]]` が入る
10. FS商談案件に `[[HDシステム]]` が入る
11. FS商談案件に `[[FS_商談管理]]` が入る
12. 商談準備に `[[FS_商談準備]]` が入る
13. スクリプトに `[[FS_トークスクリプト]]` が入る
14. 既存商談本文・原文メモ・AI解析が消えない
15. 既存 `folder: HD事業部/商談支援` が維持される
16. architecture設定がない場合も既存連携が動く
17. managed領域更新でユーザー自由記述が消えない
18. 同じ処理を2回実行しても重複リンクが増えない

テストは一時ディレクトリをVaultとして使用し、実Dropbox Vaultをテストで変更しない。

---

## 22. 実装前確認

最初に以下を実行する。

```bash
cd "/Users/maekawahiroyuki/hd-system-auto"

pwd
git remote -v
git branch --show-current
git status --short

cat config/sales-assist/obsidian.json
sed -n '1,320p' src/obsidian-sales-archive.js
cat package.json
```

Vaultパスは存在確認だけ行ってよい。

```bash
ls -la "/Users/maekawahiroyuki/Library/CloudStorage/Dropbox/maehiro/個人用/AI会社/memory/company"
```

このパスが存在しなくても実装を止めない。既存 `vaultId` 解決ロジックを正とする。

---

## 23. Git安全ルール

既存未コミット変更を保持する。

禁止:

```text
git reset
git restore
git clean
git checkout --
自動stash
```

秘密情報・Dropboxローカルファイル・`.obsidian` キャッシュをGitへ追加しない。

今回はcommit・pushしない。

---

## 24. 実装順序

1. 現在のObsidian連携コード・テスト調査
2. 開始時点テスト実行
3. `src/obsidian-hd-architecture.js` 追加
4. HDシステム / IS / FS / CS MOC生成
5. 各部署機能ノート生成
6. 共通ノート生成
7. Graph Viewガイド生成
8. `obsidian-sales-archive.js` のFS出力へ親リンク追加
9. `config/sales-assist/obsidian.json` を後方互換で拡張
10. 起動時または同期初期化時に `ensureStructure()` 実行
11. テスト追加
12. 全テスト・品質チェック
13. 実Vault上で生成確認
14. 結果報告

---

## 25. 完成条件

Obsidianで `HD事業部/HDシステム.md` を開きLocal Graphを表示すると最低限:

```text
HDシステム
├── IS
├── FS
└── CS
```

さらにFS:

```text
FS
├── FS_商談準備
├── FS_トークスクリプト
├── FS_商談資料
├── FS_商談管理
├── FS_商談結果と振り返り
├── FS_引き継ぎFMT
└── FS_KPI
```

今後FS案件を同期すると:

```text
HDシステム
  ↓
FS
  ↓
FS_商談管理
  ↓
店舗案件
```

がGraph Viewでつながること。

同時に以下を満たすこと。

- 既存ファイルのパスが変わっていない
- 既存案件が消えていない
- 既存商談メモが消えていない
- AI解析が消えていない
- HD AIアシスタントからのObsidian保存が継続して動く

---

## 26. 品質チェック

開始時と実装後:

```bash
npm test
```

`npm run check` が存在する場合:

```bash
npm run check
```

存在しなければ `package.json` 上の既存lint/syntax/typecheck相当を実行する。

---

## 27. 完了報告フォーマット

```markdown
# 実装結果

## 現在のObsidian連携調査結果
-

## 新規作成したObsidian構造
-

## 変更ファイル
- `path`: 内容

## 既存パス保護
- 移動:
- 改名:
- 削除:

## FS同期変更
-

## Graph Viewリンク構造
-

## 設定変更
-

## テスト結果
- 開始時:
- 実装後:
- 実行コマンド:

## 実Vault確認
- Vault検出:
- HDシステム.md:
- IS.md:
- FS.md:
- CS.md:

## 残課題
-

## commit・push
- 実施していない
```

---

## 28. Claude Codeへ最初に渡す一文

```text
/Users/maekawahiroyuki/hd-system-auto を対象に、
docs/implementation-prompts/CLAUDE_CODE_HD_OBSIDIAN_IS_FS_CS_ARCHITECTURE.md
を最初から最後まで読み、記載内容をすべて実装してください。

既存Obsidian Vault内のファイルを移動・改名・削除せず、
現在の `HD事業部/商談支援` の保存パスとHD AIアシスタントの既存同期を壊さないことを最優先にしてください。

実装後はテストと実Vault上の生成確認まで行い、
今回はcommit・pushをせず結果を報告してください。
```
