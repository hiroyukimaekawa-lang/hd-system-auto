import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { GasWebAppClient } from './drive.js';
import { resolveLocation } from './drive.js';
import { findExports } from './gas-monitor.js';
import { markSheetJob } from './management-sheet.js';

function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }

export class SerialWorker {
  constructor({ queue, slackClient, root = process.cwd() }) { this.queue = queue; this.slack = slackClient; this.root = root; this.running = false; this.child = null; this.timer = null; }
  start() { if (this.timer) return; this.timer = setInterval(() => this.tick().catch(console.error), 1500); this.tick().catch(console.error); }
  async notify(job, text) { if (this.slack && job.channel_id) await this.slack.chat.postMessage({ channel: job.channel_id, thread_ts: job.thread_ts || undefined, text }).catch(console.error); }
  async tick() { if (this.running) { const current = this.queue.list(5).find(job => job.status === 'running'); if (current?.cancelRequested && this.child) this.child.kill('SIGTERM'); return; } const job = this.queue.next(); if (!job) return; await this.run(job); }
  async run(job) {
    this.running = true; const payload = job.payload; const gas = new GasWebAppClient();
    this.queue.update(job.id, { status: 'running', started_at: new Date().toISOString(), progress: 'スクレイピングを開始' });
    await this.notify(job, `処理を開始しました\nジョブID：${job.id}\n対象：${payload.prefecture} ${payload.city}\nジャンル：${payload.genre}`);
    if (payload.managementRowNumber) await markSheetJob(gas, payload.managementRowNumber, 'started', { jobId: job.id }).catch(console.error);
    const configDir = path.join(this.root, 'data', 'jobs'); fs.mkdirSync(configDir, { recursive: true });
    const config = path.join(configDir, `${job.id}.csv`);
    const sources = (payload.sources || ['googlemaps','tabelog']).join(',');
    fs.writeFileSync(config, `area,keyword,outputGenre,maxItems,sources,maxPages,tabelogUrl\n${[`${payload.prefecture} ${payload.city}`, payload.genre, payload.genre, payload.maxItems || 100, sources, 50, ''].map(csvCell).join(',')}\n`);
    let logs = ''; let scrapedMarked = false;
    try {
      const exitCode = await new Promise((resolve, reject) => {
        this.child = spawn(process.execPath, ['src/cli.js','run','--config',config,'--job-id',job.id], { cwd: this.root, env: process.env });
        const onData = async chunk => { const text = chunk.toString(); logs = (logs + text).slice(-12000); const line = text.trim().split(/\r?\n/).at(-1) || ''; this.queue.update(job.id, { progress: line.slice(0, 500) }); if (!scrapedMarked && line.includes('[Drive] アップロード') && payload.managementRowNumber) { scrapedMarked = true; await markSheetJob(gas, payload.managementRowNumber, 'scraped', { jobId: job.id }).catch(console.error); } };
        this.child.stdout.on('data', onData); this.child.stderr.on('data', onData); this.child.on('error', reject); this.child.on('exit', resolve);
      });
      const latest = this.queue.get(job.id);
      if (latest.cancelRequested) { this.queue.update(job.id, { status:'cancelled', progress:'キャンセルしました', finished_at:new Date().toISOString() }); await this.notify(job, `キャンセルしました\nジョブID：${job.id}`); return; }
      if (exitCode !== 0) throw new Error(logs.split(/\r?\n/).filter(Boolean).at(-1) || `取得処理が終了コード${exitCode}で停止しました`);
      const location = await resolveLocation(gas, { rootId: process.env.GOOGLE_DRIVE_RESTAURANT_ROOT_FOLDER_ID, prefecture: payload.prefecture, city: payload.city });
      const exports = await findExports(gas, location.exportFolderId, job.id);
      const links = exports.map(file => file.url).filter(Boolean);
      this.queue.update(job.id, { status:'completed', progress:'完了', result:{ exports }, finished_at:new Date().toISOString() });
      if (payload.managementRowNumber) await markSheetJob(gas, payload.managementRowNumber, 'completed', { jobId:job.id, completedCsvLink:links.join('\n') });
      await this.notify(job, `処理が完了しました\nジョブID：${job.id}\n完成CSV：${exports.length}件${links.length ? `\n${links.join('\n')}` : ''}`);
    } catch (error) {
      this.queue.update(job.id, { status:'failed', progress:'失敗', error:error.message.slice(0,2000), finished_at:new Date().toISOString() });
      if (payload.managementRowNumber) await markSheetJob(gas, payload.managementRowNumber, 'error', { jobId:job.id, error:error.message }).catch(console.error);
      await this.notify(job, `処理に失敗しました\nジョブID：${job.id}\n${error.message.slice(0,1200)}\n同じ条件で再実行できます。`);
    } finally { this.child = null; this.running = false; }
  }
}
