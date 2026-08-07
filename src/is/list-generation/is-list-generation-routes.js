import { createJob, getJob, listAreas, listJobsSummary, requestCancel, requestPause, requestResume, startJob } from './is-list-generation-service.js';
import { readLog } from './is-list-generation-jobs.js';

// HD AIアシスタント > IS > リスト生成 > 自動取得 のAPI。
// /api/is/list-generation/* 配下のみを扱い、FSのルーティングには一切関与しない。

export async function handleIsListGenerationRequest(method, rawUrl, body = {}) {
  const url = new URL(rawUrl, 'http://127.0.0.1');
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/api/is/list-generation/areas') {
    try { return [200, { ok: true, areas: await listAreas() }]; }
    catch (error) { return [502, { ok: false, text: error.message }]; }
  }

  if (method === 'GET' && pathname === '/api/is/list-generation/jobs') {
    return [200, { ok: true, jobs: listJobsSummary(Number(url.searchParams.get('limit')) || 20) }];
  }

  if (method === 'POST' && pathname === '/api/is/list-generation/jobs') {
    try {
      const job = createJob(body);
      startJob(job.jobId);
      return [201, { ok: true, job }];
    } catch (error) { return [400, { ok: false, text: error.message }]; }
  }

  const jobMatch = pathname.match(/^\/api\/is\/list-generation\/jobs\/([^/]+)(?:\/(pause|resume|cancel|log))?$/);
  if (jobMatch) {
    const jobId = decodeURIComponent(jobMatch[1]);
    const action = jobMatch[2];
    if (!action) {
      if (method !== 'GET') return null;
      const job = getJob(jobId);
      return job ? [200, { ok: true, job }] : [404, { ok: false, text: 'ジョブが見つかりません' }];
    }
    if (action === 'log') {
      if (method !== 'GET') return null;
      return [200, { ok: true, log: readLog(jobId) }];
    }
    if (method !== 'POST') return null;
    const handlers = { pause: requestPause, resume: requestResume, cancel: requestCancel };
    const job = handlers[action](jobId);
    return job ? [200, { ok: true, job }] : [404, { ok: false, text: 'ジョブが見つかりません' }];
  }

  return null;
}
