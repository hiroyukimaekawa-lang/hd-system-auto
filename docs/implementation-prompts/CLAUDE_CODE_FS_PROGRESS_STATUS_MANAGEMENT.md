# Claude Code実装指示｜FS 2軸進捗ステータス管理

対象:
`/Users/maekawahiroyuki/hd-system-auto`

必ず読む:
- `docs/requirements/fs-sales/FS_PROGRESS_STATUS_MANAGEMENT_REQUIREMENTS.md`
- `config/fs-sales/progress-statuses.json`

最重要:
1. 進捗を1種類にまとめず、必ず2軸で分離する
2. 申込・審査進捗: AA/A/B/C/D
3. 案件進捗: A/B/C/D/E/XA/XB
4. 「各種案件用」「各種案件結果と振り返り」から両方変更可能
5. 変更履歴を保存
6. 申込A/B/CのnextActionHintを補助表示
7. AI/ルールは提案のみ。自動変更は禁止
8. XA/XBでも案件データを削除しない
9. Obsidian案件Markdownへ最新2軸進捗を反映
10. Googleカレンダーは進捗変更だけで自動変更しない
11. 既存DBは追加マイグレーション
12. 過去データを勝手に推定変換しない

表示例:
```text
案件進捗
[D｜商談済み回答待ち ▼]

申込・審査進捗
[C｜申し込み書⭕️＋各種商材お申し込み❌ ▼]
```

Git安全:
```bash
cd "/Users/maekawahiroyuki/hd-system-auto"
git status --short
git branch --show-current
npm test
```

禁止:
- git reset
- git restore
- git clean
- git stash
- 既存未追跡ファイル削除
- commit
- push

実装後:
- npm test
- npm run check があれば実行
- 2軸保存
- 履歴
- XA/XB
- フィルタ
- Obsidian回帰

途中確認は不要です。
最後に、UI/DB/履歴/フィルタ/Obsidian/変更ファイル/テスト/残課題を報告してください。
