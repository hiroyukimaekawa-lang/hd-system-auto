# HD AIアシスタント｜FS フェーズ一覧・アウト返し重なり修正

## 1. リポジトリへ配置

このZIPをDownloadsへ保存した後、以下を実行してください。

```bash
cd "/Users/maekawahiroyuki/hd-system-auto"

unzip -o \
  "$HOME/Downloads/HD_AIアシスタント_FS_フェーズ全件表示_アウト返し重なり修正_ClaudeCodeパッケージ.zip"
```

配置後:

```text
/Users/maekawahiroyuki/hd-system-auto/
└── docs/
    └── implementation-prompts/
        └── CLAUDE_CODE_FS_PHASE_RAIL_AND_OBJECTION_OVERLAP_FIX.md
```

## 2. Claude Codeを起動

```bash
cd "/Users/maekawahiroyuki/hd-system-auto"
claude
```

## 3. Claude Codeへ入力

```text
docs/implementation-prompts/CLAUDE_CODE_FS_PHASE_RAIL_AND_OBJECTION_OVERLAP_FIX.md
を最初から最後まで読み、記載内容をすべて実装してください。

今回の最重要は以下の2点です。

1. FS商談画面左側のフェーズ一覧は、標準の8〜10フェーズでは内部スクロールを禁止し、1280x800でも全フェーズが1画面内に常時見えるようにしてください。

2. タイトル横のアウト相談から表示される候補カードは、読み上げスクリプトや右側メモへ重ねず、中央カラムの通常document flow内に展開し、その高さ分だけ本文を下へ押し下げてください。

空文字や「」だけではアウト候補を表示しないでください。

既存のトーク本文、DB、商談メモ、AI整理、アウト返し内容、Obsidian同期は変更しないでください。

既存未コミット変更を保持してください。
git reset / restore / clean / stash は使用しないでください。

今回はcommit・pushしないでください。

途中確認は不要です。
実装後にnpm testと利用可能な品質チェックを実行し、
1280x800 / 1440x900でUI確認まで行って、
変更ファイル・テスト結果・UI確認結果・残課題を報告してください。
```
