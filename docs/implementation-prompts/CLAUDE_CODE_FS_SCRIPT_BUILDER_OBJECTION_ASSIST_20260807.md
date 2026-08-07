# Claude Code 実装指示｜FS Script Builder + Objection Quick Assist

対象:
`/Users/maekawahiroyuki/hd-system-auto`

必ず読む:
- `docs/requirements/fs-sales/FS_SCRIPT_BUILDER_OBJECTION_ASSIST_REQUIREMENTS.md`
- `config/fs-sales/import/HD_TALK_SCRIPT_INTERVIEW_20260806_RAW.md`
- `config/fs-sales/import/HD_TALK_SCRIPT_INTERVIEW_20260806_EXPECTED_PHASES.json`

既に配置済みなら `docs/implementation-prompts/CLAUDE_CODE_FS_UI_MASTER_20260807.md` のUI方針も維持してください。

開始前:
```bash
cd "/Users/maekawahiroyuki/hd-system-auto"
git status --short
git branch --show-current
git remote -v
npm test
```

禁止:
- git reset / restore / clean / stash
- 既存未追跡ファイル削除
- commit / push

最重要:
1. 商談フェーズタイトル横にアウト入力欄
2. approved → rule → optional LLM の順でpopup候補
3. 実LLM候補だけAI候補表記
4. 商談準備をコンパクト化
5. Template画面をコンパクト化
6. 全FS利用者に新規作成/文章から自動作成
7. 貼り付け原稿を構造化しphase draft作成
8. 人がtitle/body/order/branchを微修正可能
9. 2026/08/06 RAWをpublished defaultへseed/import
10. 旧取材用トーク2026/07/30は物理削除せずarchive
11. HP無料制作支援金トーク2026/07/25は維持
12. duplicate script/versionを一覧に出さない
13. 公開済み編集は新version/draft
14. raw本文を勝手に校正・言換えしない

自動フロー化:
- まずdeterministic heading parser
- Optional LLM provider abstraction
- LLM/API key未設定でもRAW 2026/08/06は解析可能

UI:
```text
⑦ 制作事例の紹介       [アウト内容を入力…] [相談]
小さい目的

読み上げスクリプト...
```

商談準備:
```text
商談準備                         [各種案件へ]
[編集中：店舗]
使用トーク [HDトーク... 2026/08/06 ▼] [内容確認]
フェーズchips...
```

Template:
```text
トークスクリプト              [+新規作成] [文章から自動作成]
[スクリプト] [商談資料]
```

実装後:
- npm test
- npm run check があれば実行
- RAW import test
- archive/backcompat
- objection popup
- duplicate
- published immutability
- 1280x800 / 1440x900 UI smoke

今回はcommit・pushせず、実装・テスト・UI確認まで行い、変更ファイル/DB/API/UI/テスト/残課題を報告してください。
