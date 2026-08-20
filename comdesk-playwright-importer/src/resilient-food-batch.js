#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { downloadSpreadsheet, inferProjectName, runFlow } from './flow.js';
import { filterWorkbook } from './limited-flow.js';

const FOOD_WORKGROUPS = ['カフェ', 'スイーツ', '居酒屋', 'スナック', 'Bar', '焼き鳥'];
const here = path.dirname(fileURLToPath(import.meta.url));
const importerRoot = path.resolve(here, '..');
const repositoryRoot = path.resolve(importerRoot, '..');
const jobsRoot = path.join(repositoryRoot, 'data', 'comdesk-jobs');

function parseArgs(argv) {
  const urls = [];
  const options = { list: null, execute: false, dryRun: false, stopOnError: false };
  for (const value of argv) {
    if (!value.startsWith('--')) continue;
    const [key, ...rest] = value.slice(2).split('=');
    const raw = rest.length ? rest.join('=') : true;
    if (key === 'spreadsheet-url') urls.push(String(raw));
    else if (key === 'list') options.list = String(raw);
    else if (key === 'execute') options.execute = true;
    else if (key === 'dry-run') options.dryRun = true;
    else if (key === 'stop-on-error') options.stopOnError = true;
  }
  return { urls, options };
}

function buildJobs({ urls, listFile }) {
  const jobs = [];
  if (listFile) {
    const resolved = path.resolve(listFile);
    if (!fs.existsSync(resolved)) throw new Error(`リストファイルが見つかりません: ${resolved}`);
    for (const line of fs.readFileSync(resolved, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [urlPart, ...nameParts] = trimmed.split(/\s*[|\t]\s*/);
      const spreadsheetUrl = String(urlPart || '').trim();
      if (!spreadsheetUrl) continue;
      jobs.push({ spreadsheetUrl, projectName: nameParts.join(' ').trim() || undefined });
    }
  }
  for (const raw of urls) {
    const spreadsheetUrl = String(raw || '').trim();
    if (spreadsheetUrl) jobs.push({ spreadsheetUrl, projectName: undefined });
  }
  const seen = new Set();
  return jobs.filter((job) => {
    if (seen.has(job.spreadsheetUrl)) return false;
    seen.add(job.spreadsheetUrl);
    return true;
  });
}

function makeJobId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${stamp}_${crypto.randomUUID().slice(0, 8)}`;
}

function runProcess(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function recoverJob(jobId) {
  console.warn(`[recovery] 通知・送信・完了確認の自動復旧を開始します: ${jobId}`);
  const code = await runProcess(process.execPath, ['src/resume.js', `--job-id=${jobId}`], importerRoot);
  return code === 0;
}

async function main() {
  const { urls, options } = parseArgs(process.argv.slice(2));
  const jobs = buildJobs({ urls, listFile: options.list });
  if (!jobs.length) throw new Error('--list=<ファイル> または --spreadsheet-url=<URL> を指定してください');
  const execute = options.execute && !options.dryRun;
  if (execute && process.env.COMDESK_EXECUTE !== 'true') {
    throw new Error('本番投入には COMDESK_EXECUTE=true と --execute の両方が必要です');
  }

  console.log(`[food6-batch] ${jobs.length}市を${execute ? '本番' : 'dry-run'}で順番に処理します。`);
  console.log(`[food6-batch] 対象ジャンル: ${FOOD_WORKGROUPS.join('、')}`);

  const results = [];
  for (let index = 0; index < jobs.length; index += 1) {
    const city = jobs[index];
    const label = `[${index + 1}/${jobs.length}]`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comdesk-food6-batch-'));
    const sourceFile = path.join(tempDir, 'source.xlsx');
    const filteredFile = path.join(tempDir, 'food6.xlsx');
    const jobId = makeJobId();
    console.log(`\n========== ${label} 開始 ==========`);
    console.log(`${label} ${city.spreadsheetUrl}`);

    try {
      await downloadSpreadsheet(city.spreadsheetUrl, sourceFile);
      const kept = filterWorkbook(sourceFile, filteredFile, FOOD_WORKGROUPS);
      const projectName = city.projectName || inferProjectName(filteredFile);
      console.log(`${label} プロジェクト: ${projectName}`);
      console.log(`${label} 対象シート: ${kept.map((item) => item.sheetName).join('、')}`);

      try {
        const { state } = await runFlow({ input: filteredFile, projectName, dryRun: !execute, execute, jobId });
        results.push({ ok: true, recovered: false, projectName, jobId, status: state.status, spreadsheetUrl: city.spreadsheetUrl });
        console.log(`${label} ✅ 完了: ${projectName}`);
      } catch (error) {
        if (!execute || !error.jobId) throw error;
        const jobDirectory = path.join(jobsRoot, error.jobId);
        fs.mkdirSync(jobDirectory, { recursive: true });
        fs.copyFileSync(filteredFile, path.join(jobDirectory, 'source.xlsx'));

        console.warn(`${label} ⚠️ 通知・送信・完了確認でエラーを検知: ${projectName}`);
        const recovered = await recoverJob(error.jobId);
        if (!recovered) throw Object.assign(new Error(`自動復旧でも未完了: ${projectName}`), { jobId: error.jobId });
        results.push({ ok: true, recovered: true, projectName, jobId: error.jobId, status: 'recovered', spreadsheetUrl: city.spreadsheetUrl });
        console.log(`${label} ✅ 自動復旧完了: ${projectName}`);
      }
    } catch (error) {
      console.error(`${label} ❌ 未完了: ${error.message}`);
      results.push({ ok: false, recovered: false, jobId: error.jobId || jobId, error: error.message, spreadsheetUrl: city.spreadsheetUrl });
      if (options.stopOnError) break;
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  const succeeded = results.filter((item) => item.ok);
  const failed = results.filter((item) => !item.ok);
  console.log('\n============ まとめ ============');
  console.log(`成功 ${succeeded.length}市 / 失敗 ${failed.length}市`);
  for (const item of results) {
    const mark = item.ok ? (item.recovered ? '✅ 復旧' : '✅ 完了') : '❌ 未完了';
    console.log(`${mark} ${item.projectName || item.spreadsheetUrl}${item.error ? `: ${item.error}` : ''}`);
  }

  const summaryDir = path.join(jobsRoot, 'batch-summaries');
  fs.mkdirSync(summaryDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const summaryFile = path.join(summaryDir, `food6-${stamp}.json`);
  fs.writeFileSync(summaryFile, JSON.stringify({ execute, workgroups: FOOD_WORKGROUPS, total: jobs.length, results }, null, 2));
  console.log(`[food6-batch] まとめ: ${summaryFile}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[food6-batch] ${error.message}`);
  process.exitCode = 1;
});
