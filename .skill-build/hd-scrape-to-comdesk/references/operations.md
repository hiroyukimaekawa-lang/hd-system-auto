# Operations reference

## Existing entry points

- Spreadsheet import dry-run: `npm run comdesk:auto:dry -- --spreadsheet-url=<URL>`
- Spreadsheet live import: `npm run comdesk:auto -- --spreadsheet-url=<URL> --execute`
- Full pipeline dry-run: `npm run hd:dry -- --prefecture=<県> --area=<市区町村> --category=<カテゴリ>`
- Full pipeline live: `COMDESK_EXECUTE=true npm run hd:run -- --prefecture=<県> --area=<市区町村> --category=<カテゴリ>`
- Resume: `COMDESK_EXECUTE=true npm run hd:resume -- --job-id=<ID>`
- Finalize existing registrations: `COMDESK_EXECUTE=true npm run hd:finalize -- --job-id=<ID>`

## State locations

- Full jobs: `data/jobs/<jobId>/state.json`
- Sheet-to-Comdesk jobs: `data/comdesk-jobs/<jobId>/state.json`
- Results and failure screenshots live under the corresponding job directory.

## Recovery decisions

- If registration failed before a project was created, rerun the failed workgroup.
- If projects exist but review is pending, use finalize-only/resume; do not rerun registration.
- If a notification link reports that processing is already stopped or finished, query `インポート状況` and completion notifications before taking further action.
- If status is `完了`, record completion and skip.
- If status is `重複チェック待ち`, perform review and submit.
- If status is `待機中`, poll with bounded waits.
- If status is `中止`, preserve screenshots/logs and require diagnosis before resubmission.

## Known Comdesk behavior

- Duplicate and prohibited tabs can overlap.
- Confirmation occurs twice: submit confirmation, then import-start alert.
- Completion can take several minutes.
- Notifications may be stale or one-time links; the import-status table is authoritative.
- Transient DNS/network failures are retryable and must not cause duplicate project creation.
