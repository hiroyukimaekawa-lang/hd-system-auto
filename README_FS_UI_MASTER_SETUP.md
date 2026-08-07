# HD AIアシスタント｜FS UI統合改修パッケージ

このパッケージは以下の4つをまとめています。

```text
CLAUDE_CODE_FS_UI_MASTER_20260807.md
CLAUDE_CODE_FS_UI_STABILIZATION.md
CLAUDE_CODE_FS_MEETING_MEMO_UNIFIED_UI.md
CLAUDE_CODE_FS_MEETING_SCRIPT_MINIMAL_UI.md
```

## 配置

```bash
cd "/Users/maekawahiroyuki/hd-system-auto"

unzip -o \
  "$HOME/Downloads/HD_AIアシスタント_FS_UI統合改修_ClaudeCodeパッケージ_20260807.zip"
```

## Claude Code

```bash
cd "/Users/maekawahiroyuki/hd-system-auto"
claude
```

入力:

```text
docs/implementation-prompts/CLAUDE_CODE_FS_UI_MASTER_20260807.md
を最初から最後まで読み、記載内容をすべて実装してください。

同ディレクトリにある3つの詳細要件も必ず読み、
MASTERに記載された優先順位で統合実装してください。

途中確認は不要です。
今回はcommit・pushせず、実装・テスト・UI確認まで行ってください。
```
