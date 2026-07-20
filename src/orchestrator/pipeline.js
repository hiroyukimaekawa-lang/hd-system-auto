import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { appendJsonl, ensureDir, readJsonl, sanitize } from '../output.js';
import { runGoogleMapsJob } from '../google-maps.js';
import { RateLimitError, runTabelogJob } from '../tabelog.js';
import { classifyRecords, mergeDuplicates, normalizeRecords, writeClassifiedOutputs } from './records.js';

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
  const stateFile = path.join(dir, 'state.json');
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {
    version: 1, jobId: path.basename(dir), status: 'running', dryRun: options.dryRun, createdAt: new Date().toISOString(),
    input: { prefecture: options.prefecture, area: options.area, category: options.category }, stopBefore: options.stopBefore || null,
    steps: { scrape: 'pending', normalize: 'pending', classify: 'pending', output: 'pending', comdesk: 'pending' }, genres: {}, errors: []
  };
  saveState(dir, state);
  try {
    if (state.dryRun) {
      state.status = 'completed'; state.steps = { scrape: 'planned', normalize: 'planned', classify: 'planned', output: 'planned', comdesk: options.stopBefore === 'comdesk' ? 'stopped' : 'planned' };
      state.plan = buildPlan(state); saveState(dir, state); log(dir, 'dry-run完了（外部サイトへのアクセス・Comdesk変更なし）');
      return { state, dir };
    }
    await scrape(state, dir, options); normalizeAndOutput(state, dir);
    if (options.stopBefore === 'comdesk' || state.stopBefore === 'comdesk') {
      state.steps.comdesk = 'stopped'; state.status = 'completed'; saveState(dir, state); return { state, dir };
    }
    await importComdesk(state, dir); state.status = Object.values(state.genres).some((g) => g.status === 'failed') ? 'failed' : 'completed'; saveState(dir, state);
    return { state, dir };
  } catch (error) {
    state.status = error.jobStatus === 'waiting_notification' ? 'waiting_notification' : 'failed';
    state.errors.push({ at: new Date().toISOString(), message: error.message, stack: error.stack }); saveState(dir, state); throw Object.assign(error, { jobId: state.jobId, dir });
  }
}

function buildPlan(state) {
  const { prefecture, area, category } = state.input;
  return { jobId: state.jobId, query: `${prefecture} ${area} ${category}`, sources: ['googlemaps', 'tabelog'], resume: true,
    outputs: ['normalized.json', 'target.csv', 'review.csv', 'excluded.csv', 'failed.csv', 'comdesk/<ジャンル>.csv'],
    comdesk: { willWrite: false, projectName: `${prefecture}_${area}`, workgroup: '正規化後ジャンル別', assignUsers: ['開発管理用','高原','岩井','松岡','坂本','橋本','肥田野','前川','前田'], duplicateCheck: { enabled: true, type: '電話番号', scope: 'テナント全体' } } };
}

async function scrape(state, dir, options) {
  if (state.steps.scrape === 'completed') return;
  state.steps.scrape = 'running'; saveState(dir, state);
  const browser = await chromium.launch({ headless: options.headed !== true });
  try {
    for (const source of ['googlemaps', 'tabelog']) {
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
  const raw = ['googlemaps', 'tabelog'].flatMap((source) => readJsonl(path.join(dir, 'raw', `${source}.jsonl`)).map((row) => ({ source, row })));
  const normalized = normalizeRecords(raw, state.input.category); const merged = mergeDuplicates(normalized);
  state.steps.normalize = 'completed'; state.steps.classify = 'running'; saveState(dir, state);
  const classified = classifyRecords(merged); state.steps.classify = 'completed';
  const result = writeClassifiedOutputs(path.join(dir, 'outputs'), classified); state.counts = result.summary;
  for (const item of result.files) state.genres[item.genre] ||= { status: 'pending', rows: item.rows, file: item.file };
  state.steps.output = 'completed'; saveState(dir, state);
}

async function importComdesk(state, dir) {
  const pending = Object.entries(state.genres).filter(([, value]) => value.status !== 'completed');
  if (!pending.length) { state.steps.comdesk = 'completed'; return; }
  state.steps.comdesk = 'running'; saveState(dir, state);
  for (const [genre, value] of pending) {
    value.status = 'running'; state.status = 'waiting_notification'; saveState(dir, state);
    const resultFile = path.join(dir, 'outputs', `comdesk-result-${sanitize(genre)}.json`);
    const args = ['src/import.js', `--input=${value.file}`, `--project-name=${state.input.prefecture}_${state.input.area}`, `--only-workgroups=${genre}`, `--result-file=${resultFile}`, `--screenshots-dir=${path.join(dir, 'screenshots')}`];
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
