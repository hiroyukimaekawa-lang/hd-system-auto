# HD IS リスト生成 スクレイピング自動化 PoC

## 1. ZIPをリポジトリへ展開

```bash
cd "/Users/maekawahiroyuki/hd-system-auto"

unzip -o \
  "$HOME/Downloads/HD_AIアシスタント_IS_リスト生成_スクレイピング自動化_PoC_ClaudeCodeパッケージ.zip"
```

## 2. ファイル存在確認

```bash
ls -la "docs/implementation-prompts/CLAUDE_CODE_HD_IS_LIST_GENERATION_SCRAPING_POC.md"
ls -la "docs/requirements/is-list-generation/HD_IS_LIST_GENERATION_SCRAPING_POC_REQUIREMENTS.md"
ls -la "config/is/list-generation/scraping-automation.local.example.json"
```

3つとも表示されたらOK。

## 3. Claude Code

```bash
cd "/Users/maekawahiroyuki/hd-system-auto"
claude
```

## 4. 貼り付け

```text
docs/implementation-prompts/CLAUDE_CODE_HD_IS_LIST_GENERATION_SCRAPING_POC.md
を最初から最後まで読み、
関連requirementsとconfig exampleもすべて読み、
記載内容を実装してください。

今回の機能はFSではなく、
HD AIアシスタント > IS > リスト生成 > 自動取得
として実装してください。

UI・API・コード・保存先・設定名をIS側に統一し、
FS機能へ混在させないでください。

今回は1エリア×1ジャンルのPoCです。
Google Mapsと食べログを既存処理で自動取得し、
統合・重複排除・チェーン/対象外除外・電話番号補完を行い、
現在のComdesk形式CSVを対象市区町村のGoogle Driveへ保存するところまで実装してください。

PoCではComdesk本番投入は絶対に実行しないでください。

既存未コミット変更とDrive既存ファイルを保持し、
git reset / restore / clean / stash は使用せず、
commit・pushせず、
現行コード調査・実装・テスト・安全な小規模PoC確認まで進めてください。
```
