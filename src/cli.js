#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { appendJsonl, parseCsv, readJsonl, sanitize, writeCsv } from './output.js';
import { runGoogleMapsJob } from './google-maps.js';

function args(argv) {
  const out = { command: argv[0] || 'run', config: 'config/jobs.csv', output: 'output', state: 'state', headless: true, dryRun: false };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--config') out.config = argv[++i];
    else if (argv[i] === '--output') out.output = argv[++i];
    else if (argv[i] === '--state') out.state = argv[++i];
    else if (argv[i] === '--headed') out.headless = false;
    else if (argv[i] === '--dry-run') out.dryRun = true;
  }
  return out;
}

const opt = args(process.argv.slice(2));
if (opt.command !== 'run') { console.error('使い方: node src/cli.js run --config config/jobs.csv [--headed] [--dry-run]'); process.exit(1); }
if (!fs.existsSync(opt.config)) { console.error(`設定ファイルがありません: ${opt.config}`); process.exit(1); }
const jobs = parseCsv(fs.readFileSync(opt.config, 'utf8')).map((j, i) => ({
  area: j.area, keyword: j.keyword, outputGenre: j.outputGenre || j.keyword,
  maxItems: Math.max(1, Number(j.maxItems) || 100), id: `${String(i + 1).padStart(3, '0')}_${sanitize(j.area)}_${sanitize(j.outputGenre || j.keyword)}`
})).filter(j => j.area && j.keyword);
if (!jobs.length) { console.error('実行対象がありません。jobs.csvを確認してください。'); process.exit(1); }
console.log(`実行対象: ${jobs.length}件${opt.dryRun ? '（確認のみ）' : ''}`);
jobs.forEach(j => console.log(`- ${j.area} × ${j.keyword} → ${j.outputGenre} 最大${j.maxItems}件`));
if (opt.dryRun) process.exit(0);

const browser = await chromium.launch({ headless: opt.headless });
try {
  for (const job of jobs) {
    const stateFile = path.join(opt.state, `${job.id}.jsonl`);
    const rows = readJsonl(stateFile);
    const urls = new Set(rows.map(r => r['URL']).filter(Boolean));
    console.log(`\n[開始] ${job.area} × ${job.keyword}（再開データ ${rows.length}件）`);
    await runGoogleMapsJob(browser, job, urls, record => { appendJsonl(stateFile, record); rows.push(record); }, console.log);
    const csv = path.join(opt.output, `${job.id}.csv`);
    const count = writeCsv(csv, rows);
    console.log(`[完了] ${csv} ${count}件`);
  }
} finally { await browser.close(); }
