export const MANAGEMENT_HEADERS = ['自動取得対象','取得ジャンル','取得元','最低統合件数','ジョブID','最終実行日時','エラー内容','完成CSVリンク'];

export async function listSheetJobs(client, prefecture, industry = '飲食店') {
  return client.request('listMasterJobs', { prefecture, industry });
}

export async function markSheetJob(client, rowNumber, state, details = {}) {
  const allowed = ['started', 'scraped', 'completed', 'error'];
  if (!allowed.includes(state)) throw new Error(`不正な管理状態です: ${state}`);
  return client.request('updateMasterStatus', { rowNumber, state, ...details });
}

export async function consolidateRouteCsv(client, { route, genre, minimumCount, members, jobId }) {
  if (!route || !members?.length) throw new Error('営業ルートまたは統合対象がありません');
  return client.request('consolidateRouteCsv', { route, genre, minimumCount, members, jobId });
}

export function groupBelowMinimumByRoute(jobs) {
  const groups = new Map();
  for (const job of jobs) {
    const minimum = Number(job.minimumCount) || 0;
    if (!minimum || Number(job.completedCount) >= minimum) continue;
    const key = `${job.route}\u0001${job.genre}`;
    if (!groups.has(key)) groups.set(key, { route: job.route, genre: job.genre, minimumCount: minimum, members: [] });
    groups.get(key).members.push(job);
  }
  return [...groups.values()];
}
