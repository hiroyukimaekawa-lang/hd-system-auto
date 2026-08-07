# FS スクリプト作成 + アウト即時相談 Claude Codeパッケージ

## 配置

```bash
cd "/Users/maekawahiroyuki/hd-system-auto"

unzip -o \
  "$HOME/Downloads/HD_AIアシスタント_FS_スクリプト作成_アウト即時相談_ClaudeCodeパッケージ_20260807.zip"
```

## Claude Code

```bash
cd "/Users/maekawahiroyuki/hd-system-auto"
claude
```

入力:

```text
docs/implementation-prompts/CLAUDE_CODE_FS_SCRIPT_BUILDER_OBJECTION_ASSIST_20260807.md
を最初から最後まで読み、
requirementsと2026/08/06 RAW原稿・期待フェーズJSONもすべて読み、
記載内容を実装してください。

途中確認は不要です。
今回はcommit・pushせず、実装・テスト・UI確認まで行ってください。
```
