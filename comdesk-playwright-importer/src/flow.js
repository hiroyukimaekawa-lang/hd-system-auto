#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import XLSX from 'xlsx';
import { downloadGoogleSpreadsheetAuthenticated } from './google-auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const importerRoot = path.resolve(here, '..');
const repositoryRoot = path.resolve(importerRoot, '..');
dotenv.config({ path: path.join(repositoryRoot, '.env'), quiet: true });
dotenv.config({ path: path.join(importerRoot, '.env'), quiet: true });

export function spreadsheetIdFromUrl(value) {
  const match = String(value || '').match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('GoogleスプレッドシートのURLを確認できません');
  return match[1];
}

export async function downloadSpreadsheet(url, destination, fetchImpl = fetch) {
  const id = spreadsheetIdFromUrl(url);
  try {
    const response = await fetchImpl(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { redirect: 'follow' });
    const contentType = response.headers?.get?.('content-type') || '';
    if (!response.ok || /text\/html/i.test(contentType)) throw new Error('スプレッドシートを公開URLから取得できません');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 100 || bytes.subarray(0, 2).toString() !== 'PK') throw new Error('取得結果がExcelファイルではありません');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
    return { id, bytes: bytes.length, authenticated: false };
  } catch (error) {
    // Tests and callers that inject their own fetch implementation should keep
    // deterministic behavior and must not unexpectedly launch a browser.
    if (fetchImpl !== fetch) throw error;
    console.warn('[google-auth] 公開取得できないため、保存済みGoogleログイン状態で再取得します。');
    return downloadGoogleSpreadsheetAuthenticated(url, destination);
  }
}

export function inferProjectName(workbookFile) {
  const workbook = XLSX.readFile(workbookFile, { cellDates: true });
  const prefectures = new Set(); const municipalities = new Set();
  for (const sheetName of workbook.SheetNames.filter((name) => name.startsWith('04_SALES_'))) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    for (const row of rows) {
      const prefecture = String(row['都道府県'] || '').trim();
      if (prefecture) prefectures.add(prefecture);
      let address = String(row['住所１'] || row['住所'] || '').trim();
      while (prefecture && address.startsWith(prefecture)) address = address.slice(prefecture.length).trim();
      address = address.replace(/^県(?=.{1,16}(?:市|区|町|村))/, '');
      const municipality = address.match(/^(.{1,16}?(?:市|区|町|村))/)?.[1];
      if (municipality) municipalities.add(municipality.replace(/^.+郡(?=.{1,8}(?:町|村)$)/, ''));
    }
  }
  if (prefectures.size !== 1) throw new Error(`都道府県を一意に判定できません（${[...prefectures].join('、') || '未取得'}）`);
  if (!municipalities.size) throw new Error('住所から市区町村を判定できません');
  if (municipalities.size > 8) throw new Error(`市区町村が多すぎるためプロジェクト名を自動決定できません（${municipalities.size}件）`);
  return `${[...prefectures][0]}_${[...municipalities].sort((a, b) => a.localeCompare(b, 'ja')).join('・')}`;
}

function resultWorkgroup(item) {
  if (item?.workgroup) return String(item.workgroup).trim();
  const sheetName = String(item?.sheetName || '').trim();
  return sheetName.startsWith('04_SALES_') ? sheetName.slice('04_SALES_'.length).trim() : '';
}

export function isTransientRegistrationUiFailure(item) {
  if (item?.status !== 'failed' || item?.importStatus === 'failed') return false;
  if (!resultWorkgroup(item)) return false;
  const message = String(item?.error || '');
  return /select\[name=["']client_id["']\]/i.test(message)
    || /アサインユーザーの選択欄が見つかりません/.test(message)
    || /アサインユーザーが0人になっています/.test(message)
    || /指定したアサインユーザーが画面にいません/.test(message);
}

export function mergeRetryResults(originalResults, retryResults, targetWorkgroups) {
  const targets = targetWorkgroups instanceof Set ? targetWorkgroups : new Set(targetWorkgroups || []);
  const replacements = new Map();
  for (const item of retryResults || []) {
    const workgroup = resultWorkgroup(item);
    if (!targets.has(workgroup) || item?.status === 'skipped') continue;
    replacements.set(workgroup, { ...item, workgroup });
  }
  return (originalResults || []).map((item) => {
    const workgroup = resultWorkgroup(item);
    return targets.has(workgroup) && replacements.has(workgroup) ? replacements.get(workgroup) : item;
  });
}

export async function runFlow(options) {
  if (!options.dryRun && (!options.execute || process.env.COMDESK_EXECUTE !== 'true')) throw new Error('本番投入には--executeとCOMDESK_EXECUTE=trueの両方が必要です');
  const jobId = options.jobId || `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${crypto.randomUUID().slice(0, 8)}`;
  const directory = path.join(repositoryRoot, 'data', 'comdesk-jobs', jobId); fs.mkdirSync(directory, { recursive: true });
  const stateFile = path.join(directory, 'state.json'); const state = { version:1, jobId, status:'preparing', spreadsheetUrl:options.spreadsheetUrl || null, createdAt:new Date().toISOString(), events:[] };
  const save = () => { state.updatedAt = new Date().toISOString(); const temporary = `${stateFile}.tmp`; fs.writeFileSync(temporary, JSON.stringify(state, null, 2)); fs.renameSync(temporary, stateFile); };
  const event = (status, details = {}) => { state.status = status; state.events.push({ at:new Date().toISOString(), status, ...details }); save(); };
  try {
    const workbookFile = options.input ? path.resolve(options.input) : path.join(directory, 'source.xlsx');
    if (options.input) { if (!fs.existsSync(workbookFile)) throw new Error(`入力ファイルが見つかりません: ${workbookFile}`); }
    else { event('downloading'); state.download = await downloadSpreadsheet(options.spreadsheetUrl, workbookFile); }
    state.workbookFile = workbookFile; const projectName = options.projectName || inferProjectName(workbookFile); state.projectName = projectName;
    event('validated', { projectName });
    const resultFile = path.join(directory, 'comdesk-result.json');
    const baseImporterArgs = ['src/import.js', `--input=${workbookFile}`, `--project-name=${projectName}`, `--screenshots-dir=${path.join(directory, 'screenshots')}`];
    const importerArgs = [...baseImporterArgs, `--result-file=${resultFile}`];
    if (options.dryRun) importerArgs.push('--dry-run');
    event(options.dryRun ? 'dry_running' : 'comdesk_registering');
    let code = await runProcess(process.execPath, importerArgs, importerRoot, path.join(directory, 'comdesk.log'));
    let currentResults = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : [];

    if (!options.dryRun) {
      const maxRetries = Math.max(0, Number(process.env.COMDESK_UI_RETRY_ATTEMPTS ?? 3));
      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        const retryable = currentResults.filter(isTransientRegistrationUiFailure);
        if (!retryable.length) break;
        const workgroups = [...new Set(retryable.map(resultWorkgroup).filter(Boolean))];
        console.log(`\n通信未読込の可能性を検知: ${workgroups.join('、')}`);
        console.log(`プロジェクト管理画面を再読込して自動再試行します (${attempt}/${maxRetries})`);
        event('comdesk_ui_retrying', { attempt, maxRetries, workgroups });
        const retryResultFile = path.join(directory, `comdesk-result.retry-${attempt}.json`);
        const retryArgs = [...baseImporterArgs, `--result-file=${retryResultFile}`, `--only-workgroups=${workgroups.join(',')}`];
        code = await runProcess(process.execPath, retryArgs, importerRoot, path.join(directory, `comdesk-retry-${attempt}.log`));
        const retryResults = fs.existsSync(retryResultFile) ? JSON.parse(fs.readFileSync(retryResultFile, 'utf8')) : [];
        currentResults = mergeRetryResults(currentResults, retryResults, new Set(workgroups));
        fs.writeFileSync(resultFile, JSON.stringify(currentResults, null, 2));
      }
    }

    state.results = currentResults;
    const unresolved = currentResults.filter((item) => item.status === 'failed' || item.importStatus === 'failed');
    if (code !== 0 || unresolved.length) throw new Error(`コムデスク自動投入が安全停止しました（exit ${code}）`);
    event(options.dryRun ? 'dry_run_completed' : 'completed'); return { state, directory };
  } catch (error) { state.error = error.message; event('failed'); throw Object.assign(error, { jobId, stateFile }); }
}

function runProcess(command, args, cwd, logFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio:['ignore','pipe','pipe'] }); const log = fs.createWriteStream(logFile, { flags:'a' });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr); child.stdout.pipe(log); child.stderr.pipe(log);
    child.once('error', reject); child.once('close', (code) => { log.end(); resolve(code); });
  });
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const values = Object.fromEntries(process.argv.slice(2).filter((value) => value.startsWith('--')).map((value) => { const [key, ...rest] = value.slice(2).split('='); return [key, rest.length ? rest.join('=') : true]; }));
  if (!values['spreadsheet-url'] && !values.input) fail('--spreadsheet-urlまたは--inputを指定してください');
  runFlow({ spreadsheetUrl:values['spreadsheet-url'], input:values.input, projectName:values['project-name'], dryRun:Boolean(values['dry-run']), execute:Boolean(values.execute), jobId:values['job-id'] }).then(({ state, directory }) => {
    console.log(JSON.stringify({ ok:true, jobId:state.jobId, status:state.status, projectName:state.projectName, stateFile:path.join(directory, 'state.json') }, null, 2));
  }).catch((error) => { console.error(JSON.stringify({ ok:false, jobId:error.jobId, error:error.message, stateFile:error.stateFile }, null, 2)); process.exitCode = 1; });
}
function fail(message) { console.error(message); process.exit(2); }
