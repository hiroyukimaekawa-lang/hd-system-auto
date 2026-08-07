import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { appendJsonl, ensureDir, readJsonl } from '../../output.js';
import { CaptchaError, runGoogleMapsJob as defaultRunGoogleMapsJob } from '../../google-maps.js';
import { RateLimitError, runTabelogJob as defaultRunTabelogJob } from '../../tabelog.js';
import { classifyRecords, mergeDuplicates, normalizeRecords, writeClassifiedOutputs } from '../../orchestrator/records.js';
import { splitAddress } from '../../scraper-utils.js';
import { GasWebAppClient } from '../../drive.js';
import { listAreaFolders, resolveArea as defaultResolveArea, uploadExportCsv as defaultUploadExportCsv } from './is-drive.js';
import { enrichMissingPhones } from './is-phone-enrichment.js';
import { loadIsListGenerationConfig } from './is-list-generation-config.js';
import { appendLog, jobDir, listJobs, loadState, newJobId, saveState } from './is-list-generation-jobs.js';

// IS > リスト生成 > 自動取得 のPoCパイプライン。
// 取得 → 統合 → 重複排除 → チェーン/対象外除外 → 電話番号なしだけ補完 → 既存Comdesk形式CSV → Drive保存 → STOP。
// Comdesk本番投入（comdesk-playwright-importer）は、このモジュールのどの経路からも一切呼び出さない。

const STEP_KEYS = ['drive_scan', 'maps', 'tabelog', 'normalize', 'merge', 'exclude', 'phone_enrichment', 'csv_export', 'drive_upload'];

const controllers = new Map(); // jobId -> { cancelRequested, pauseRequested }
let runningJobId = null;

function jsonlWrite(file, rows) {
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

function freshSteps() { return Object.fromEntries(STEP_KEYS.map(key => [key, 'pending'])); }

export async function listAreas(deps = {}) {
  const client = deps.gasClient || new GasWebAppClient();
  const config = deps.config || loadIsListGenerationConfig();
  return listAreaFolders(client, config.driveRootFolderId);
}

export function createJob(input = {}) {
  if (!input.areaFolderId || !input.areaName || !input.genre) throw new Error('areaFolderId・areaName・genreは必須です');
  const jobId = newJobId();
  const sources = (Array.isArray(input.sources) && input.sources.length ? input.sources : ['google_maps', 'tabelog'])
    .filter(source => ['google_maps', 'tabelog'].includes(source));
  const state = {
    jobId, status: 'queued', stage: 'drive_scan', steps: freshSteps(),
    input: {
      areaFolderId: input.areaFolderId, areaName: input.areaName, prefectureName: input.prefectureName || '',
      genre: String(input.genre).trim(), sources: sources.length ? sources : ['google_maps', 'tabelog'],
      maxItems: Math.max(1, Math.min(Number(input.maxItems) || 10, 30))
    },
    counts: {
      maps: 0, tabelog: 0, merged: 0, duplicatesRemoved: 0, chainExcluded: 0, otherExcluded: 0, failed: 0,
      phoneMissingBeforeEnrichment: 0, phoneEnriched: 0, phoneStillMissing: 0, final: 0
    },
    drive: null, comdeskUploaded: false, cancelRequested: false, pauseRequested: false, errors: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  saveState(state);
  appendLog(jobId, 'ジョブを作成しました', { input: state.input });
  return state;
}

export function getJob(jobId) { return loadState(jobId); }
export function listJobsSummary(limit) { return listJobs(limit); }

export function requestPause(jobId) {
  const state = loadState(jobId); if (!state) return null;
  if (!['queued', 'running'].includes(state.status)) return state;
  const controller = controllers.get(jobId); if (controller) controller.pauseRequested = true;
  state.pauseRequested = true; return saveState(state);
}

export function requestCancel(jobId) {
  const state = loadState(jobId); if (!state) return null;
  if (['completed', 'failed', 'cancelled'].includes(state.status)) return state;
  const controller = controllers.get(jobId); if (controller) controller.cancelRequested = true;
  state.cancelRequested = true; return saveState(state);
}

export function requestResume(jobId, deps = {}) {
  const state = loadState(jobId); if (!state) return null;
  if (state.status !== 'paused' && state.status !== 'needs_human') return state;
  state.status = 'queued'; state.pauseRequested = false; saveState(state);
  runPipeline(jobId, deps).catch(error => appendLog(jobId, `再開時エラー: ${error.message}`));
  return state;
}

export function startJob(jobId, deps = {}) {
  runPipeline(jobId, deps).catch(error => appendLog(jobId, `実行時エラー: ${error.message}`));
  return loadState(jobId);
}

async function runPipeline(jobId, deps = {}) {
  if (runningJobId && runningJobId !== jobId) throw new Error(`別のISリスト生成ジョブが実行中です: ${runningJobId}`);
  runningJobId = jobId;
  const controller = controllers.get(jobId) || { cancelRequested: false, pauseRequested: false };
  controllers.set(jobId, controller);
  const config = deps.config || loadIsListGenerationConfig();
  let state = loadState(jobId);
  if (!state) { runningJobId = null; throw new Error(`ジョブが見つかりません: ${jobId}`); }
  const dir = jobDir(jobId); ensureDir(dir); ensureDir(path.join(dir, 'outputs'));
  const log = (message, details) => appendLog(jobId, message, details);
  const persist = () => saveState(state);
  state.status = 'running'; state.cancelRequested = false; persist(); log('実行を開始しました');

  const checkStop = () => {
    if (controller.cancelRequested) { state.status = 'cancelled'; persist(); log('中止しました'); return 'cancel'; }
    if (controller.pauseRequested) { state.status = 'paused'; controller.pauseRequested = false; state.pauseRequested = false; persist(); log('一時停止しました'); return 'pause'; }
    return null;
  };

  try {
    const mapsFile = path.join(dir, 'maps.raw.jsonl');
    const tabelogFile = path.join(dir, 'tabelog.raw.jsonl');

    // --- drive_scan ---
    if (state.steps.drive_scan !== 'completed') {
      state.stage = 'drive_scan'; persist();
      const client = deps.gasClient || new GasWebAppClient();
      const resolveArea = deps.resolveArea || defaultResolveArea;
      const location = await resolveArea(client, { rootId: config.driveRootFolderId, areaFolderId: state.input.areaFolderId });
      state.drive = {
        areaFolderId: location.areaFolderId || state.input.areaFolderId,
        areaName: location.areaName || state.input.areaName,
        exportFolderId: location.exportFolderId,
        spreadsheetName: location.spreadsheetName || ''
      };
      if (!state.input.prefectureName) {
        const parsed = splitAddress(location.spreadsheetName || location.areaName || state.input.areaName);
        if (parsed.pref) state.input.prefectureName = parsed.pref;
      }
      state.steps.drive_scan = 'completed'; persist();
      log('Driveエリアを解決しました', { drive: state.drive });
    }
    if (checkStop()) return;

    const areaQuery = `${state.input.prefectureName} ${state.drive.areaName || state.input.areaName}`.trim();

    // --- maps ---
    if (state.input.sources.includes('google_maps') && state.steps.maps !== 'completed') {
      state.stage = 'maps'; persist();
      const rows = readJsonl(mapsFile); const urls = new Set(rows.map(row => row.URL).filter(Boolean));
      const runner = deps.runGoogleMapsJob || defaultRunGoogleMapsJob;
      const browser = deps.browser || await chromium.launch({ headless: deps.headed !== true });
      try {
        const job = { area: areaQuery, keyword: state.input.genre, outputGenre: state.input.genre, maxItems: Math.min(config.maxResultsPerSource, state.input.maxItems), maxPages: 50, tabelogUrl: '' };
        await runner(browser, job, urls, record => appendJsonl(mapsFile, record), message => log(`[maps] ${message}`));
      } catch (error) {
        if (error instanceof CaptchaError) { state.status = 'needs_human'; state.pausedReason = 'captcha'; persist(); log(`Google MapsでCAPTCHAを検知したため停止しました: ${error.message}`); return; }
        throw error;
      } finally { if (!deps.browser) await browser.close(); }
      state.counts.maps = readJsonl(mapsFile).length; state.steps.maps = 'completed'; persist();
      log('Google Maps取得が完了しました', { count: state.counts.maps });
    }
    if (checkStop()) return;

    // --- tabelog ---
    if (state.input.sources.includes('tabelog') && state.steps.tabelog !== 'completed') {
      state.stage = 'tabelog'; persist();
      const rows = readJsonl(tabelogFile); const urls = new Set(rows.map(row => row.URL).filter(Boolean));
      const runner = deps.runTabelogJob || defaultRunTabelogJob;
      const browser = deps.browser || await chromium.launch({ headless: deps.headed !== true });
      try {
        const job = { area: areaQuery, keyword: state.input.genre, outputGenre: state.input.genre, maxItems: Math.min(config.maxResultsPerSource, state.input.maxItems), maxPages: 10, tabelogUrl: '' };
        await runner(browser, job, urls, record => appendJsonl(tabelogFile, record), message => log(`[tabelog] ${message}`));
      } catch (error) {
        if (error instanceof RateLimitError) {
          state.status = error.status === 429 ? 'paused' : 'needs_human';
          state.pausedReason = error.status === 429 ? 'rate_limit_429' : 'captcha_or_block';
          persist(); log(`食べログでアクセス制限を検知しました: ${error.message}`); return;
        }
        throw error;
      } finally { if (!deps.browser) await browser.close(); }
      state.counts.tabelog = readJsonl(tabelogFile).length; state.steps.tabelog = 'completed'; persist();
      log('食べログ取得が完了しました', { count: state.counts.tabelog });
    }
    if (checkStop()) return;

    // --- normalize / merge ---
    if (state.steps.merge !== 'completed') {
      state.stage = 'normalize'; persist();
      const sourceRows = [
        ...readJsonl(mapsFile).map(row => ({ source: 'googlemaps', row })),
        ...readJsonl(tabelogFile).map(row => ({ source: 'tabelog', row }))
      ];
      const normalized = normalizeRecords(sourceRows, state.input.genre);
      jsonlWrite(path.join(dir, 'normalized.jsonl'), normalized);
      state.steps.normalize = 'completed'; state.stage = 'merge'; persist();
      const merged = mergeDuplicates(normalized);
      jsonlWrite(path.join(dir, 'merged.jsonl'), merged);
      state.counts.merged = merged.length;
      state.counts.duplicatesRemoved = Math.max(0, normalized.length - merged.length);
      state.steps.merge = 'completed'; persist();
      log('統合・重複排除が完了しました', { merged: merged.length, duplicatesRemoved: state.counts.duplicatesRemoved });
    }
    if (checkStop()) return;

    // --- exclude (チェーン / 対象外) ---
    if (state.steps.exclude !== 'completed') {
      state.stage = 'exclude'; persist();
      const merged = readJsonl(path.join(dir, 'merged.jsonl'));
      const classified = classifyRecords(merged, { profile: process.env.SYSTEM_PROFILE || 'AFFILIATE' });
      const excludedChain = classified.filter(record => record.bucket === 'excluded' && record.reason === 'チェーンマスタ一致');
      const excludedOther = classified.filter(record => record.bucket === 'excluded' && record.reason !== 'チェーンマスタ一致');
      const failedRecords = classified.filter(record => record.bucket === 'failed');
      const candidates = classified.filter(record => record.bucket === 'target' || record.bucket === 'review');
      state.counts.chainExcluded = excludedChain.length;
      state.counts.otherExcluded = excludedOther.length;
      state.counts.failed = failedRecords.length;
      const rejected = [...excludedChain, ...excludedOther, ...failedRecords];
      jsonlWrite(path.join(dir, 'rejected.jsonl'), rejected);
      jsonlWrite(path.join(dir, 'candidates.jsonl'), candidates);
      state.steps.exclude = 'completed'; persist();
      log('チェーン・対象外除外が完了しました', { chainExcluded: excludedChain.length, otherExcluded: excludedOther.length, failed: failedRecords.length });
    }
    if (checkStop()) return;

    // --- phone_enrichment（電話番号なしだけ） ---
    if (state.steps.phone_enrichment !== 'completed') {
      state.stage = 'phone_enrichment'; persist();
      const candidates = readJsonl(path.join(dir, 'candidates.jsonl'));
      state.counts.phoneMissingBeforeEnrichment = candidates.filter(record => !record.phone).length;
      const { records: enrichedCandidates, stats } = await enrichMissingPhones(candidates, {
        config: config.phone, fetchImpl: deps.fetchImpl || fetch, log: message => log(`[phone] ${message}`)
      });
      jsonlWrite(path.join(dir, 'enriched.jsonl'), enrichedCandidates);
      state.counts.phoneEnriched = stats.enriched;
      state.counts.phoneStillMissing = enrichedCandidates.filter(record => !record.phone).length;
      state.steps.phone_enrichment = 'completed'; persist();
      log('電話番号補完が完了しました', { stats });
    }
    if (checkStop()) return;

    // --- csv_export（既存Comdesk形式CSV） ---
    if (state.steps.csv_export !== 'completed') {
      state.stage = 'csv_export'; persist();
      const enrichedCandidates = readJsonl(path.join(dir, 'enriched.jsonl'));
      const rejected = readJsonl(path.join(dir, 'rejected.jsonl'));
      const finalRecords = enrichedCandidates.map(record => ({ ...record, bucket: record.phone ? 'target' : 'review', reason: record.phone ? '' : (record.reason || '電話番号なし') }));
      const result = writeClassifiedOutputs(path.join(dir, 'outputs'), [...finalRecords, ...rejected], {
        profile: process.env.SYSTEM_PROFILE || 'AFFILIATE', operation: 'リアルアフィリエイト'
      });
      state.counts.final = result.summary.target;
      const csvFile = result.files[0];
      state.csv = csvFile ? { file: csvFile.file, rows: csvFile.rows } : null;
      state.steps.csv_export = 'completed'; persist();
      log('Comdesk形式CSVを生成しました', { file: csvFile?.file, rows: csvFile?.rows });
      if (!csvFile) { state.status = 'needs_human'; persist(); log('対象件数が0件のため、Comdesk CSVを生成できませんでした（人による確認が必要です）'); return; }
    }
    if (checkStop()) return;

    // --- drive_upload ---
    if (state.steps.drive_upload !== 'completed') {
      state.stage = 'drive_upload'; persist();
      if (!state.csv) { state.status = 'needs_human'; persist(); log('CSVがないためDrive保存をスキップしました'); return; }
      const client = deps.gasClient || new GasWebAppClient();
      const uploadExportCsv = deps.uploadExportCsv || defaultUploadExportCsv;
      const uploaded = await uploadExportCsv(client, {
        exportFolderId: state.drive.exportFolderId, jobId, filePath: state.csv.file, remoteName: path.basename(state.csv.file)
      });
      state.drive.uploadedFile = uploaded;
      state.steps.drive_upload = 'completed'; persist();
      log('Driveへ保存しました', { uploaded });
    }

    state.stage = 'done'; state.status = 'completed'; state.comdeskUploaded = false; persist();
    log('完了しました（Comdesk本番投入は実行していません／STOP）');
  } catch (error) {
    state.status = 'failed';
    state.errors.push({ at: new Date().toISOString(), message: error.message, stack: error.stack });
    persist(); log(`エラーが発生しました: ${error.message}`);
  } finally {
    if (runningJobId === jobId) runningJobId = null;
    controllers.delete(jobId);
  }
}

export const __testables = { runPipeline };
