import { DriveLocationError } from './drive.js';

function jobIdOf(file) {
  if (file.appProperties?.jobId) return file.appProperties.jobId;
  try { return JSON.parse(file.description || '{}').jobId || ''; } catch { return ''; }
}

export async function findExports(client, exportFolderId, jobId) {
  if (typeof client.findExports === 'function') return client.findExports(exportFolderId, jobId);
  return (await client.listChildren(exportFolderId)).filter(file => file.mimeType === 'text/csv' && jobIdOf(file) === jobId);
}

export async function waitForExports(client, { exportFolderId, jobId, timeoutMs = 30 * 60 * 1000, intervalMs = 15000, signal, onProgress = () => {} }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('完成CSVの待機をキャンセルしました');
    const files = await findExports(client, exportFolderId, jobId);
    if (files.length) return files;
    onProgress('GAS処理と完成CSVを待っています');
    await new Promise((resolve, reject) => { const timer = setTimeout(resolve, intervalMs); signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('完成CSVの待機をキャンセルしました')); }, { once: true }); });
  }
  throw new DriveLocationError('export_timeout', `ジョブ ${jobId} の完成CSVが制限時間内に見つかりませんでした。`);
}
