# LINE text-command integration

## Architecture

Use this flow:

`LINE user → Messaging API webhook → signature/auth check → command parser → SQLite job queue → serial worker → scraper/normalizer → Comdesk importer → import-status check → LINE progress replies`

Keep the webhook fast: verify, parse, enqueue, reply with a job ID, and return HTTP 200. Run Playwright only in the serial worker.

## Supported messages

- `実行 長野県 長野市 飲食店 最大100件`
- `確認 長野県 長野市 飲食店`
- `シート投入 https://docs.google.com/spreadsheets/d/... 実行`
- `状況 <ジョブID>`
- `再開 <ジョブID>`
- `中止 <ジョブID>`

Normalize Japanese spaces, full-width punctuation, and common variants. Require prefecture, municipality/area, and category for scraping. Require a valid Google Sheets URL for sheet import.

## Authentication and idempotency

- Verify `x-line-signature` using `LINE_CHANNEL_SECRET` against the raw request body.
- Allow only IDs listed in `LINE_ALLOWED_USER_IDS` or approved group IDs.
- Store LINE event `webhookEventId`/message ID with a unique constraint. Return the existing job ID for retries.
- Never log channel secrets, access tokens, cookies, sheet contents, or customer telephone numbers.
- Store `LINE_CHANNEL_ACCESS_TOKEN` only in `.env` or a secret manager.

## Execution policy

- `確認` runs dry-run only.
- `実行` or `シート投入 ... 実行` authorizes the external write for an allowlisted sender.
- Reply immediately with job ID, parsed target, mode, and whether Comdesk write is enabled.
- Send progress at accepted, scraping, output-ready, Comdesk registration, duplicate-review, and completed/failed states.
- On transient network failure, mark `failed_retryable`; accept `再開 <jobId>` and continue from saved state.
- Before announcing success, query `インポート状況` and require all targeted workgroups to be `完了`.

## Implementation sequence

1. Extract the current Slack command parsing into channel-neutral `src/chat-command.js`.
2. Adapt `SerialWorker.notify` to a notifier interface with Slack and LINE implementations.
3. Add `src/line-webhook.js` using Node HTTP/Express-compatible raw-body handling and the existing `JobQueue`.
4. Add message-event idempotency storage to SQLite.
5. Add status-table parsing as a reusable module and make the orchestrator reconcile before resume.
6. Add unit tests for signature verification, command parsing, allowlists, idempotency, and status transitions.
7. Deploy behind HTTPS (Cloud Run or another always-on host), register `/line/webhook`, and keep the Mac worker connected if Comdesk's saved browser session remains local.

For a fully unattended service, move Comdesk authentication to a dedicated secured worker host. Do not copy a personal Chrome profile to an untrusted server.
