#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { appendJsonl, parseCsv, readJsonl, sanitize, TABELOG_HEADERS, writeCsv } from './output.js';
import { runGoogleMapsJob } from './google-maps.js';
import { RateLimitError, runTabelogJob } from './tabelog.js';
import { DriveLocationError, GasWebAppClient } from './drive.js';
import { uploadJobCsvs } from './drive-pipeline.js';
import { waitForExports } from './gas-monitor.js';
import { loadEnv } from './env.js';

function args(argv) {
  const out = { command: argv[0] || 'run', config: 'config/jobs.csv', output: 'output', state: 'state', headless: true, dryRun: false, jobId: '' };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--config') out.config = argv[++i];
    else if (argv[i] === '--output') out.output = argv[++i];
    else if (argv[i] === '--state') out.state = argv[++i];
    else if (argv[i] === '--headed') out.headless = false;
    else if (argv[i] === '--dry-run') out.dryRun = true;
    else if (argv[i] === '--job-id') out.jobId = argv[++i];
  }
  return out;
}

loadEnv();
const opt = args(process.argv.slice(2));
if (opt.command !== 'run') { console.error('使い方: node src/cli.js run --config config/jobs.csv [--headed] [--dry-run]'); process.exit(1); }
if (!fs.existsSync(opt.config)) { console.error(`設定ファイルがありません: ${opt.config}`); process.exit(1); }
const jobs = parseCsv(fs.readFileSync(opt.config, 'utf8')).map((j, i) => ({
  area: j.area, keyword: j.keyword, outputGenre: j.outputGenre || j.keyword,
  maxItems: Math.max(1, Number(j.maxItems) || 100), maxPages: Math.max(1, Number(j.maxPages) || 50),
  sources: (j.sources || 'googlemaps').split(',').map(value => value.trim()).filter(value => ['googlemaps', 'tabelog'].includes(value)),
  tabelogUrl: j.tabelogUrl || '', id: opt.jobId || `${String(i + 1).padStart(3, '0')}_${sanitize(j.area)}_${sanitize(j.outputGenre || j.keyword)}`
})).filter(j => j.area && j.keyword);
if (!jobs.length) { console.error('実行対象がありません。jobs.csvを確認してください。'); process.exit(1); }
console.log(`実行対象: ${jobs.length}件${opt.dryRun ? '（確認のみ）' : ''}`);
jobs.forEach(j => console.log(`- ${j.area} × ${j.keyword} → ${j.outputGenre} [${j.sources.join(',')}] 各最大${j.maxItems}件`));
if (opt.dryRun) process.exit(0);

const browser = await chromium.launch({ headless: opt.headless });
let pausedJobs = false;
try {
  for (const job of jobs) {
    const generatedFiles = {};
    let paused = false;
    for (const source of job.sources) {
      const stateFile = path.join(opt.state, `${job.id}_${source}.jsonl`);
      const legacyState = source === 'googlemaps' ? path.join(opt.state, `${job.id}.jsonl`) : '';
      const rows = readJsonl(fs.existsSync(stateFile) ? stateFile : legacyState);
      const urls = new Set(rows.map(r => r['URL']).filter(Boolean));
      console.log(`\n[開始] ${source} ${job.area} × ${job.keyword}（再開データ ${rows.length}件）`);
      try {
        const runner = source === 'tabelog' ? runTabelogJob : runGoogleMapsJob;
        await runner(browser, job, urls, record => { appendJsonl(stateFile, record); rows.push(record); }, console.log);
      } catch (error) {
        if (error instanceof RateLimitError) { console.error(`[一時停止] paused_rate_limit: ${error.message}。時間を置いて同じ設定で再開してください。`); paused = true; }
        else throw error;
      }
      const csv = path.join(opt.output, `${source}_${job.id}.csv`);
      const count = writeCsv(csv, rows, source === 'tabelog' ? TABELOG_HEADERS : undefined);
      generatedFiles[source] = csv;
      console.log(`[完了] ${csv} ${count}件`);
      if (paused) break;
    }
    if (paused) { pausedJobs = true; console.log('[Drive] 一時停止中のジョブは投入しません。'); continue; }
    if (process.env.GOOGLE_DRIVE_RESTAURANT_ROOT_FOLDER_ID && process.env.GAS_WEB_APP_URL && process.env.GAS_WEB_APP_SECRET) {
      const client = new GasWebAppClient();
      try {
        const { location, uploaded } = await uploadJobCsvs(client, job, job.id, generatedFiles);
        uploaded.forEach(file => console.log(file.skippedDuplicate ? `[Drive] 二重投入をスキップ: ${file.name}` : `[Drive] アップロード: ${file.name}`));
        const exports = await waitForExports(client, { exportFolderId: location.exportFolderId, jobId: job.id, onProgress: console.log });
        console.log(`[Drive] 完成CSV ${exports.length}件: ${exports.map(file => file.name).join(', ')}`);
      } catch (error) {
        if (error instanceof DriveLocationError) console.error(error.toSlackMessage());
        throw error;
      }
    } else {
      console.log('[Drive] GAS Webアプリ設定または飲食店ルートIDが未設定のため、ローカルCSV生成までで終了します。');
    }
  }
} finally { await browser.close(); }
if (pausedJobs) process.exitCode = 2;
