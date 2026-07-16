import { listSheetJobs, markSheetJob } from './management-sheet.js';

export function parseSheetCommand(text) {
  const [prefecture, industry, ...extra] = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!prefecture || !industry || extra.length) throw new Error('使い方: /hd-list-sheet 茨城県 飲食店');
  return { prefecture, industry };
}

export function createSheetCommandHandler({ gasClient, enqueue, createJobId }) {
  return async function handle({ command, ack, respond }) {
    await ack();
    try {
      const input = parseSheetCommand(command.text);
      const rows = await listSheetJobs(gasClient, input.prefecture, input.industry);
      if (!rows.length) { await respond('自動取得対象がTRUEかつ飲食取得完了がFALSEの市区町村はありません。'); return; }
      const accepted = [];
      for (const row of rows) {
        const jobId = createJobId(row);
        await markSheetJob(gasClient, row.rowNumber, 'started', { jobId });
        await enqueue({ ...row, jobId, prefecture: input.prefecture, industry: input.industry, managementRowNumber: row.rowNumber });
        accepted.push(`${row.city}（${jobId}）`);
      }
      await respond(`管理マスタから${accepted.length}件を受け付けました。\n${accepted.map(value => `・${value}`).join('\n')}`);
    } catch (error) { await respond(`処理を開始できませんでした。\n${error.message}`); }
  };
}
