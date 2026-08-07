# HD AIアシスタント｜Claude Code直接投入パッケージ

## 1. パッケージをリポジトリへ配置

ダウンロードしたZIPが `Downloads` にある場合:

```bash
cd "/Users/maekawahiroyuki/hd-system-auto"
unzip -o "$HOME/Downloads/HD_AIアシスタント_ClaudeCode直接投入パッケージ.zip"
```

または同梱のセットアップスクリプトを実行:

```bash
bash "$HOME/Downloads/install-hd-fs-claude-package.sh"
```

## 2. Claude Codeを起動

```bash
cd "/Users/maekawahiroyuki/hd-system-auto"
claude
```

## 3. 指示を渡す

次のファイルをClaude Codeへ読ませて、そのまま実装させます。

```text
docs/implementation-prompts/CLAUDE_CODE_FS_PERSONAL_UI_PROMPT.md
```

Claude Codeへの最初の入力:

```text
docs/implementation-prompts/CLAUDE_CODE_FS_PERSONAL_UI_PROMPT.md を最初から最後まで読み、記載内容をすべて実装してください。
```

## 注意

- `config/private/fs-sales-materials.local.json` は社内用リンクを含むためGitへ追加しない
- 既存の未コミット変更を消さない
- 今回はcommit・pushしない
