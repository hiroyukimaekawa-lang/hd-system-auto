import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { appendJsonl, ensureDir, readJsonl, sanitize } from '../output.js';
import { runGoogleMapsJob } from '../google-maps.js';
import { RateLimitError, runTabelogJob } from '../tabelog.js';
import { assignRegions, classifyRecords, mergeDuplicates, normalizeRecords, writeClassifiedOutputs } from './records.js';
import { preflightEnvironment, sourcesForCategory } from './config.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
export function newJobId() { return `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${crypto.randomUUID().slice(0, 8)}`; }
export function jobDir(id) { return path.join(ROOT, 'data', 'jobs', id); }

function saveState(dir, state) {
  state.updatedAt = new Date().toISOString();
  const target = path.join(dir, 'state.json'); const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2)); fs.renameSync(temporary, target);
}
function log(dir, message, details = {}) {
  const entry = { at: new Date().toISOString(), message, ...details };
  fs.appendFileSync(path.join(dir, 'job.log'), `${JSON.stringify(entry)}\n`); console.log(message);
}

export async function createOrResume(options) {
  const dir = jobDir(options.jobId || newJobId()); ensureDir(dir); ensureDir(path.join(dir, 'outputs')); ensureDir(path.join(dir, 'screenshots')); ensureDir(path.join(dir, 'raw'));
  const lockFile = path.join(dir, '.lock');
  let lock;
  try { lock = fs.openSync(lockFile, 'wx'); } catch (error) { if (error.code === 'EEXIST') throw new Error(`同じジョブが実行中です: ${path.basename(dir)}`); throw error; }
  const stateFile = path.join(dir, 'state.json');
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {
    version: 2, jobId: path.basename(dir), status: 'queued', dryRun: options.dryRun, createdAt: new Date().toISOString(),
    input: { prefecture: options.prefecture, area: options.area, category: options.category }, stopBefore: options.stopBefore || null,
    steps: { scrape: 'pending', normalize: 'pending', classify: 'pending', output: 'pending', comdesk: 'pending' }, genres: {}, errors: []
  };
  const preflight = preflightEnvironment(process.env, { executeComdesk: options.executeComdesk });
  state.preflight = preflight; saveState(dir, state);
  try {
    if (state.dryRun) {
      state.status = 'completed'; state.steps = { scrape: 'planned', normalize: 'planned', classify: 'planned', output: 'planned', comdesk: options.stopBefore === 'comdesk' ? 'stopped' : 'planned' };
      state.plan = buildPlan(state); state.plan.preflight = preflight; saveState(dir, state); log(dir, 'dry-run完了（外部サイトへのアクセス・Comdesk変更なし）');
      return { state, dir };
    }
    if (!preflight.ok) { const error = new Error(`事前検査に失敗しました: ${preflight.errors.join('、')}`); error.jobStatus = 'failed_terminal'; throw error; }
    await scrape(state, dir, options); normalizeAndOutput(state, dir);
    if (!options.executeComdesk || options.stopBefore === 'comdesk' || state.stopBefore === 'comdesk') {
      state.steps.comdesk = 'stopped'; state.status = 'output_ready'; saveState(dir, state); return { state, dir };
    }
    await importComdesk(state, dir, options); state.status = Object.values(state.genres).some((g) => g.status === 'failed') ? 'failed_retryable' : 'completed'; saveState(dir, state);
    return { state, dir };
  } catch (error) {
    state.status = error.jobStatus || (error instanceof RateLimitError ? 'paused_rate_limit' : 'failed_retryable');
    state.errors.push({ at: new Date().toISOString(), message: error.message, stack: error.stack }); saveState(dir, state); throw Object.assign(error, { jobId: state.jobId, dir });
  } finally { if (lock !== undefined) fs.closeSync(lock); fs.rmSync(lockFile, { force: true }); }
}

function buildPlan(state) {
  const { prefecture, area, category } = state.input;
  return { jobId: state.jobId, query: `${prefecture} ${area} ${category}`, sources: sourcesForCategory(category), resume: true,
    outputs: ['normalized.json', 'target.csv', 'review.csv', 'excluded.csv', 'failed.csv', 'comdesk/<ジャンル>.csv'],
    comdesk: { willWrite: false, projectName: `${prefecture}_${area}`, workgroup: '正規化後ジャンル別', assignUsers: ['開発管理用','高原','岩井','松岡','坂本','橋本','肥田野','前川','前田'], duplicateCheck: { enabled: true, type: '電話番号', scope: 'テナント全体' } } };
}

async function scrape(state, dir, options) {
  if (state.steps.scrape === 'completed') return;
  state.steps.scrape = 'running'; state.status = 'scraping'; saveState(dir, state);
  const browser = await chromium.launch({ headless: options.headed !== true });
  try {
    for (const source of sourcesForCategory(state.input.category)) {
      const file = path.join(dir, 'raw', `${source}.jsonl`); const rows = readJsonl(file); const urls = new Set(rows.map((r) => r.URL).filter(Boolean));
      const job = { area: `${state.input.prefecture} ${state.input.area}`, keyword: state.input.category, outputGenre: state.input.category, maxItems: options.maxItems || 100, maxPages: options.maxPages || 50, tabelogUrl: '' };
      try { await (source === 'tabelog' ? runTabelogJob : runGoogleMapsJob)(browser, job, urls, (row) => appendJsonl(file, row), (message) => log(dir, `[${source}] ${message}`)); }
      catch (error) { if (error instanceof RateLimitError) throw error; throw error; }
    }
    state.steps.scrape = 'completed'; saveState(dir, state);
  } finally { await browser.close(); }
}

function normalizeAndOutput(state, dir) {
  if (state.steps.output === 'completed') return;
  state.steps.normalize = 'running'; saveState(dir, state);
  state.status = 'gas_running';
  const raw = sourcesForCategory(state.input.category).flatMap((source) => readJsonl(path.join(dir, 'raw', `${source}.jsonl`)).map((row) => ({ source, row })));
  const normalized = normalizeRecords(raw, state.input.category); let merged = mergeDuplicates(normalized);
  if (state.input.area === '県全体') {
    const regionFile = path.join(ROOT, 'config', 'regions.json');
    const regionMaster = fs.existsSync(regionFile) ? JSON.parse(fs.readFileSync(regionFile, 'utf8')) : [];
    merged = assignRegions(merged, regionMaster);
  }
  state.steps.normalize = 'completed'; state.steps.classify = 'running'; saveState(dir, state);
  const classified = classifyRecords(merged, { profile: process.env.SYSTEM_PROFILE }); state.steps.classify = 'completed';
  const result = writeClassifiedOutputs(path.join(dir, 'outputs'), classified, { profile: process.env.SYSTEM_PROFILE }); state.counts = result.summary;
  for (const item of result.files) state.genres[`${item.area}/${item.genre}`] ||= { status: 'pending', area: item.area, genre: item.genre, rows: item.rows, file: item.file };
  state.steps.output = 'completed'; state.status = 'output_ready'; saveState(dir, state);
}

async function importComdesk(state, dir, options) {
  const pending = Object.entries(state.genres).filter(([, value]) => value.status !== 'completed');
  if (!pending.length) { state.steps.comdesk = 'completed'; return; }
  state.steps.comdesk = 'running'; saveState(dir, state);
  for (const [genreKey, value] of pending) {
    const genre = value.genre || genreKey;
    value.status = 'running'; state.status = 'comdesk_registering'; saveState(dir, state);
    const resultFile = path.join(dir, 'outputs', `comdesk-result-${sanitize(genre)}.json`);
    const args = ['src/import.js', `--input=${value.file}`, `--project-name=${state.input.prefecture}_${value.area || state.input.area}`, `--only-workgroups=${genre}`, `--result-file=${resultFile}`, `--screenshots-dir=${path.join(dir, 'screenshots')}`];
    if (options.finalizeOnly) args.push('--finalize-only');
    const result = await runProcess(process.execPath, args, path.join(ROOT, 'comdesk-playwright-importer'), dir);
    const report = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : [];
    const completed = report.find((r) => r.workgroup === genre && r.importStatus === 'completed');
    if (result.code !== 0 || !completed) { value.status = 'failed'; value.error = report.find((r) => r.workgroup === genre)?.importError || `Comdesk importer exit ${result.code}`; }
    else { value.status = 'completed'; value.result = completed; }
    saveState(dir, state);
  }
  state.status = 'running';
  state.steps.comdesk = Object.values(state.genres).every((g) => g.status === 'completed') ? 'completed' : 'failed';
}

function runProcess(command, args, cwd, dir) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stream = fs.createWriteStream(path.join(dir, 'comdesk.log'), { flags: 'a' }); child.stdout.pipe(stream); child.stderr.pipe(stream);
    child.once('error', reject); child.once('close', (code) => { stream.end(); resolve({ code }); });
  });
}
