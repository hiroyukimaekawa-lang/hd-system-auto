---
name: hd-scrape-to-comdesk
description: Automate the HD sales-list workflow from area/category instructions or a Google Sheets URL through scraping, normalization, genre splitting, Comdesk project registration, duplicate review, two confirmation dialogs, and final import-status verification. Use when the user asks to scrape business lists, import a spreadsheet into Comdesk, resume a stopped Comdesk job, check import status, or design/operate LINE or Slack text-command automation for this pipeline.
---

# HD Scrape to Comdesk

Use the repository at `${HD_SYSTEM_AUTO_ROOT:-/Users/maekawahiroyuki/hd-system-auto}`. Preserve job state and never recreate a project merely because notification processing stopped.

## Choose the entry path

- For an existing Google Sheets URL, run `scripts/run.sh import-sheet --spreadsheet-url=<URL> --dry-run`, inspect the inferred area and genre counts, then run again with `--execute` after confirming live execution is authorized.
- For a new scrape, run `scripts/run.sh scrape --prefecture=<都道府県> --area=<市区町村> --category=<カテゴリ> --dry-run`, inspect the plan, then run with `--execute` after authorization.
- For an interrupted scrape-to-import job, run `scripts/run.sh resume --job-id=<ID> --execute`.
- For a registration-complete job whose duplicate confirmation remains, run `scripts/run.sh finalize --job-id=<ID> --execute`.
- To inspect Comdesk's authoritative state, run `scripts/run.sh status --project-name=<名称> --workgroup=<ジャンル>`.

## Apply safety rules

1. Treat dry-run as read-only and live execution as an external write.
2. Require explicit live-execution intent before `--execute`; a request such as “投入して”, “全部実行して”, or an authorized LINE command containing `実行` is sufficient.
3. Register every currently accessible Comdesk user unless the user specifies otherwise.
4. Match project name, workgroup, and project ID before opening a notification.
5. Validate review counts. Duplicate and prohibited-number sets may overlap; accept an expected total between `new + max(duplicate, prohibited)` and `new + duplicate + prohibited`.
6. Accept only the expected “本当によろしいですか” confirmation and the subsequent import-start alert.
7. Wait at least 90 seconds after submission before polling completion.
8. Use the `インポート状況` table as the authoritative final check. Interpret `完了` as complete, `重複チェック待ち` as ready for review, `待機中` as not ready, and `中止` as requiring investigation.
9. On DNS/network interruption, resume from saved state and skip confirmed-complete workgroups. Never register duplicate projects.

## Report outcomes

Report project, workgroup, input count, new count, duplicate/prohibited exclusions, completion state, job ID, and state/result paths. If stopped, state the exact last confirmed-complete workgroup and the safe resume command.

## LINE and chat automation

Read [references/line-integration.md](references/line-integration.md) when implementing or operating a LINE/Slack text entry point. Route every channel into the existing serial job queue; do not place scraping or browser automation inside the webhook handler.

Read [references/operations.md](references/operations.md) when diagnosing, resuming, or extending the pipeline.
