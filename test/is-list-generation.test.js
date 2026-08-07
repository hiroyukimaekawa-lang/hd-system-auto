import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CaptchaError } from '../src/google-maps.js';
import { RateLimitError } from '../src/tabelog.js';
import { readJsonl } from '../src/output.js';
import { loadIsListGenerationConfig } from '../src/is/list-generation/is-list-generation-config.js';
import { listAreaFolders, resolveArea, uploadExportCsv } from '../src/is/list-generation/is-drive.js';
import { enrichMissingPhones } from '../src/is/list-generation/is-phone-enrichment.js';
import { createJob, getJob, requestCancel, requestPause, __testables } from '../src/is/list-generation/is-list-generation-service.js';
import { jobDir, saveState } from '../src/is/list-generation/is-list-generation-jobs.js';
import { handleIsListGenerationRequest } from '../src/is/list-generation/is-list-generation-routes.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function rawRow(overrides = {}) {
  return {
    '店名': '', 'ジャンル': '居酒屋', '検索ジャンル': '居酒屋', '取得元ジャンル': '居酒屋',
    '都道府県': '静岡県', '市区町村': '伊東市', '住所': '静岡県伊東市A', '電話番号': '',
    '定休日': '', '営業日': '', '営業開始A': '', '営業終了A': '', '営業開始B': '', '営業終了B': '',
    '営業時間原文': '', 'URL': '', 'HP有無': '無', '媒体': 'Googleマップ', '取得元URL': '', '取得日時': '2026-08-07',
    ...overrides
  };
}

function fakeConfig(overrides = {}) {
  return {
    driveRootFolderId: '1EVUOKS-sIIWSy5J_WXEh2fAg6ip5rnsS',
    autoUploadToComdesk: false,
    sources: ['google_maps', 'tabelog'],
    maxResultsPerSource: 10,
    stopOnCaptcha: true,
    phone: { serpApiKey: '', dryRun: true, maxCalls: 500, minAutoAcceptScore: 85 },
    ...overrides
  };
}

test('IS所属: サービス実装にComdesk本番投入コードが一切含まれない', () => {
  const source = fs.readFileSync(path.join(root, 'src/is/list-generation/is-list-generation-service.js'), 'utf8');
  assert.ok(!/from ['"].*comdesk-playwright-importer/.test(source), 'comdesk-playwright-importerをimportしない');
  assert.ok(!/spawn\(/.test(source), '子プロセスとしてComdesk importerを起動しない');
  assert.ok(!/importComdesk/.test(source));
  assert.ok(!/COMDESK_EXECUTE/.test(source));
});

test('設定: exampleを読み込み、autoUploadToComdeskは常にfalse固定', () => {
  const config = loadIsListGenerationConfig({});
  assert.equal(config.driveRootFolderId, '1EVUOKS-sIIWSy5J_WXEh2fAg6ip5rnsS');
  assert.equal(config.autoUploadToComdesk, false);
  assert.deepEqual(config.sources, ['google_maps', 'tabelog']);
  const configWithTrueEnv = loadIsListGenerationConfig({ PHONE_ENRICHMENT_DRY_RUN: 'false', SERPAPI_API_KEY: 'x' });
  assert.equal(configWithTrueEnv.autoUploadToComdesk, false, 'envを変えても本番投入フラグは動かない');
});

test('Drive: IS専用actionを正しいpayloadで呼び出す（root直下=市区町村フォルダ）', async () => {
  const calls = [];
  const client = { request: async (action, payload) => { calls.push({ action, payload }); return action === 'listIsAreaFolders' ? [{ id: 'A1', name: '伊東市' }] : { areaFolderId: 'A1', areaName: '伊東市', exportFolderId: 'EXPORT1', spreadsheetName: '静岡県伊東市' }; } };
  const areas = await listAreaFolders(client, 'ROOT1');
  assert.deepEqual(areas, [{ id: 'A1', name: '伊東市' }]);
  assert.equal(calls[0].action, 'listIsAreaFolders');
  assert.equal(calls[0].payload.rootId, 'ROOT1');
  const location = await resolveArea(client, { rootId: 'ROOT1', areaFolderId: 'A1' });
  assert.equal(location.exportFolderId, 'EXPORT1');
  assert.equal(calls[1].action, 'resolveIsArea');
  assert.equal(calls[1].payload.areaFolderId, 'A1');
});

test('Drive: CSVアップロードはjobId・contentBase64付きでuploadIsExportCsvを呼ぶ', async () => {
  const tmpFile = path.join(root, 'test', '.tmp-is-upload.csv');
  fs.writeFileSync(tmpFile, '﻿a,b\r\n1,2', 'utf8');
  try {
    const calls = [];
    const client = { request: async (action, payload) => { calls.push({ action, payload }); return { id: 'F1', name: payload.name, url: 'https://drive.google.com/file/F1', skippedDuplicate: false }; } };
    const result = await uploadExportCsv(client, { exportFolderId: 'EXPORT1', jobId: 'JOB1', filePath: tmpFile, remoteName: 'sample.csv' });
    assert.equal(result.id, 'F1');
    assert.equal(calls[0].action, 'uploadIsExportCsv');
    assert.equal(calls[0].payload.exportFolderId, 'EXPORT1');
    assert.equal(calls[0].payload.jobId, 'JOB1');
    assert.ok(calls[0].payload.contentBase64.length > 0);
  } finally { fs.rmSync(tmpFile, { force: true }); }
});

test('電話番号補完: phoneありは触らない／dry-runでは外部呼び出しをしない', async () => {
  let fetchCalled = false;
  const fetchImpl = async () => { fetchCalled = true; return { ok: true, status: 200, json: async () => ({}) }; };
  const records = [
    { name: 'A店', area: '伊東市', address: '静岡県伊東市A', phone: '0557-1-1111' },
    { name: 'B店', area: '伊東市', address: '静岡県伊東市B', phone: '' }
  ];
  const { records: out, stats } = await enrichMissingPhones(records, { config: { serpApiKey: 'k', dryRun: true, maxCalls: 10, minAutoAcceptScore: 85 }, fetchImpl });
  assert.equal(fetchCalled, false);
  assert.equal(out[0].phone, '0557-1-1111');
  assert.equal(out[1].phone, '');
  assert.equal(out[1].phoneEnrichment, 'dry_run');
  assert.equal(stats.enriched, 0);
  assert.equal(stats.skippedDryRun, 1);
});

test('電話番号補完: 高信頼一致だけ自動採用し、低信頼は不採用のまま', async () => {
  const responses = [
    { ok: true, status: 200, json: async () => ({ place_results: { title: 'C店 伊東', address: '静岡県伊東市C', phone: '0557-9-9999' } }) },
    { ok: true, status: 200, json: async () => ({ place_results: { title: '全く別の店', address: '東京都新宿区', phone: '03-0000-0000' } }) }
  ];
  let index = 0;
  const fetchImpl = async () => responses[index++];
  const records = [
    { name: 'C店', area: '伊東市', address: '静岡県伊東市C', phone: '' },
    { name: 'D店', area: '伊東市', address: '静岡県伊東市D', phone: '' }
  ];
  const { records: out, stats } = await enrichMissingPhones(records, { config: { serpApiKey: 'k', dryRun: false, maxCalls: 10, minAutoAcceptScore: 85 }, fetchImpl });
  assert.equal(out[0].phone, '0557-9-9999');
  assert.equal(out[0].phoneEnrichment, 'enriched');
  assert.equal(out[1].phone, '', '低信頼度は自動採用しない');
  assert.equal(out[1].phoneEnrichment, 'low_confidence');
  assert.equal(stats.enriched, 1);
  assert.equal(stats.skippedLowConfidence, 1);
});

function baseDeps({ mapsRows, tabelogRows, uploadCalls }) {
  return {
    config: fakeConfig(),
    gasClient: {},
    browser: {},
    resolveArea: async (_client, { areaFolderId }) => ({ areaFolderId, areaName: '伊東市', exportFolderId: 'EXPORT1', spreadsheetName: '静岡県伊東市' }),
    runGoogleMapsJob: async (_browser, _job, _existingUrls, onRecord) => { mapsRows.forEach(onRecord); return mapsRows.length; },
    runTabelogJob: async (_browser, _job, _existingUrls, onRecord) => { tabelogRows.forEach(onRecord); return tabelogRows.length; },
    uploadExportCsv: async (_client, options) => { uploadCalls.push(options); return { id: 'FILE1', name: path.basename(options.filePath), url: 'https://drive.google.com/file/FILE1', skippedDuplicate: false }; }
  };
}

test('PoCパイプライン: 取得→統合→重複排除→チェーン除外→電話補完(dry-run)→Comdesk CSV→Drive保存→STOP', async () => {
  const maps = [
    rawRow({ '店名': '居酒屋 一号店', '電話番号': '0557-12-3456', '住所': '静岡県伊東市A', URL: 'https://maps.example/1', '取得元URL': 'https://maps.example/1' }),
    rawRow({ '店名': 'すき家 伊東店', '電話番号': '0557-99-8888', '住所': '静岡県伊東市B', URL: 'https://maps.example/2', '取得元URL': 'https://maps.example/2' }),
    rawRow({ '店名': '居酒屋 三号店', '電話番号': '', '住所': '静岡県伊東市C', URL: 'https://maps.example/3', '取得元URL': 'https://maps.example/3' })
  ];
  const tabelog = [
    rawRow({ '店名': '居酒屋 一号店', '電話番号': '0557-12-3456', '住所': '静岡県伊東市A', 'URL': 'https://tabelog.example/1', '取得元URL': 'https://tabelog.example/1', '媒体': '食べログ' })
  ];
  const uploadCalls = [];
  const deps = baseDeps({ mapsRows: maps, tabelogRows: tabelog, uploadCalls });

  const job = createJob({ areaFolderId: 'A1', areaName: '伊東市', genre: '居酒屋', sources: ['google_maps', 'tabelog'], maxItems: 10 });
  try {
    await __testables.runPipeline(job.jobId, deps);
    const finalState = getJob(job.jobId);

    assert.equal(finalState.status, 'completed');
    assert.equal(finalState.comdeskUploaded, false, 'Comdesk本番投入は絶対に実行しない');
    assert.equal(finalState.counts.maps, 3);
    assert.equal(finalState.counts.tabelog, 1);
    assert.equal(finalState.counts.merged, 3, '電話番号一致の1件はGoogleマップ側へ統合される');
    assert.equal(finalState.counts.duplicatesRemoved, 1);
    assert.equal(finalState.counts.chainExcluded, 1, 'すき家はチェーンマスタ一致で除外');
    assert.equal(finalState.counts.otherExcluded, 0);
    assert.equal(finalState.counts.phoneMissingBeforeEnrichment, 1);
    assert.equal(finalState.counts.phoneEnriched, 0, 'dry-runなので実際には補完しない');
    assert.equal(finalState.counts.phoneStillMissing, 1);
    assert.equal(finalState.counts.final, 1, '電話番号ありの1件だけが最終Comdesk CSVへ入る');

    assert.equal(uploadCalls.length, 1);
    assert.equal(uploadCalls[0].exportFolderId, 'EXPORT1');
    assert.equal(uploadCalls[0].jobId, job.jobId);
    assert.ok(fs.existsSync(uploadCalls[0].filePath));
    assert.match(path.basename(uploadCalls[0].filePath), /^コムデスク_リアルアフィリエイト_静岡県_伊東市_居酒屋_\d{8}\.csv$/);

    const csvText = fs.readFileSync(uploadCalls[0].filePath, 'utf8');
    const header = csvText.replace(/^﻿/, '').split('\r\n')[0];
    assert.equal(header, '"UUID","種別","名前","カナ","郵便番号","都道府県","住所１","住所２","住所カナ","Tel1","Tel2","Tel3","Tel4","FAX","URL","備考","旧社名","リードソース","旧進捗","履歴","オーナー名","HPある？","BP検索","アポ済商材","最新履歴","営業曜日","休業曜日","午前始","午前終","午後始","午後終"');
    assert.match(csvText, /居酒屋 一号店/);
    assert.ok(!/すき家/.test(csvText), 'チェーン除外店舗はComdesk CSVに入らない');

    const dir = jobDir(job.jobId);
    assert.ok(fs.existsSync(path.join(dir, 'maps.raw.jsonl')));
    assert.ok(fs.existsSync(path.join(dir, 'tabelog.raw.jsonl')));
    assert.ok(fs.existsSync(path.join(dir, 'merged.jsonl')));
    assert.ok(fs.existsSync(path.join(dir, 'rejected.jsonl')));
    assert.equal(readJsonl(path.join(dir, 'rejected.jsonl')).length, 1);
    assert.ok(Object.values(finalState.steps).every(value => value === 'completed'), 'checkpoint(steps)が全段階completedになっている');
  } finally { fs.rmSync(jobDir(job.jobId), { recursive: true, force: true }); }
});

test('一時停止→再開: 途中で止めてもJSONL/checkpointから再開し、同じ結果に到達する', async () => {
  const maps = [rawRow({ '店名': '居酒屋 一号店', '電話番号': '0557-12-3456', 'URL': 'https://maps.example/1', '取得元URL': 'https://maps.example/1' })];
  const tabelog = [rawRow({ '店名': '居酒屋 二号店', '電話番号': '0557-33-4444', 'URL': 'https://tabelog.example/2', '取得元URL': 'https://tabelog.example/2', '媒体': '食べログ' })];
  const uploadCalls = [];
  const job = createJob({ areaFolderId: 'A1', areaName: '伊東市', genre: '居酒屋', sources: ['google_maps', 'tabelog'], maxItems: 10 });
  const pausingDeps = {
    ...baseDeps({ mapsRows: maps, tabelogRows: tabelog, uploadCalls }),
    runTabelogJob: async (_browser, _job, _existingUrls, onRecord) => { tabelog.forEach(onRecord); requestPause(job.jobId); return tabelog.length; }
  };
  try {
    await __testables.runPipeline(job.jobId, pausingDeps);
    let state = getJob(job.jobId);
    assert.equal(state.status, 'paused');
    assert.equal(state.steps.tabelog, 'completed');
    assert.equal(state.steps.normalize, 'pending', 'まだ正規化前で止まっている');

    state.status = 'queued'; saveState(state);
    const resumingDeps = baseDeps({ mapsRows: maps, tabelogRows: tabelog, uploadCalls });
    await __testables.runPipeline(job.jobId, resumingDeps);
    state = getJob(job.jobId);
    assert.equal(state.status, 'completed');
    assert.equal(state.counts.maps, 1);
    assert.equal(state.counts.tabelog, 1);
    assert.equal(uploadCalls.length, 1, '再開後の1回だけDriveへ保存する');
  } finally { fs.rmSync(jobDir(job.jobId), { recursive: true, force: true }); }
});

test('中止: cancelRequestedが立つと以降のステージを実行せずcancelledで停止する', async () => {
  const maps = [rawRow({ '店名': '居酒屋 一号店', '電話番号': '0557-12-3456', 'URL': 'https://maps.example/1', '取得元URL': 'https://maps.example/1' })];
  const uploadCalls = [];
  const job = createJob({ areaFolderId: 'A1', areaName: '伊東市', genre: '居酒屋', sources: ['google_maps'], maxItems: 10 });
  const deps = {
    ...baseDeps({ mapsRows: maps, tabelogRows: [], uploadCalls }),
    runGoogleMapsJob: async (_browser, _job, _existingUrls, onRecord) => { maps.forEach(onRecord); requestCancel(job.jobId); return maps.length; }
  };
  try {
    await __testables.runPipeline(job.jobId, deps);
    const state = getJob(job.jobId);
    assert.equal(state.status, 'cancelled');
    assert.equal(uploadCalls.length, 0, '中止後はDriveへ保存しない');
  } finally { fs.rmSync(jobDir(job.jobId), { recursive: true, force: true }); }
});

test('CAPTCHA検知: Google MapsでCaptchaErrorが出たらneeds_humanで停止する', async () => {
  const job = createJob({ areaFolderId: 'A1', areaName: '伊東市', genre: '居酒屋', sources: ['google_maps'], maxItems: 10 });
  const deps = {
    config: fakeConfig(), gasClient: {}, browser: {},
    resolveArea: async (_client, { areaFolderId }) => ({ areaFolderId, areaName: '伊東市', exportFolderId: 'EXPORT1', spreadsheetName: '静岡県伊東市' }),
    runGoogleMapsJob: async () => { throw new CaptchaError('CAPTCHA検知'); }
  };
  try {
    await __testables.runPipeline(job.jobId, deps);
    const state = getJob(job.jobId);
    assert.equal(state.status, 'needs_human');
    assert.equal(state.steps.maps, 'pending');
  } finally { fs.rmSync(jobDir(job.jobId), { recursive: true, force: true }); }
});

test('429: 食べログのレート制限はpausedになり、後で再開できる', async () => {
  const job = createJob({ areaFolderId: 'A1', areaName: '伊東市', genre: '居酒屋', sources: ['tabelog'], maxItems: 10 });
  const deps = {
    config: fakeConfig(), gasClient: {}, browser: {},
    resolveArea: async (_client, { areaFolderId }) => ({ areaFolderId, areaName: '伊東市', exportFolderId: 'EXPORT1', spreadsheetName: '静岡県伊東市' }),
    runTabelogJob: async () => { throw new RateLimitError(429, 'https://tabelog.example/rstLst'); }
  };
  try {
    await __testables.runPipeline(job.jobId, deps);
    const state = getJob(job.jobId);
    assert.equal(state.status, 'paused');
    assert.equal(state.pausedReason, 'rate_limit_429');
  } finally { fs.rmSync(jobDir(job.jobId), { recursive: true, force: true }); }
});

test('403相当のブロックはneeds_humanとして扱う（無理に再試行しない）', async () => {
  const job = createJob({ areaFolderId: 'A1', areaName: '伊東市', genre: '居酒屋', sources: ['tabelog'], maxItems: 10 });
  const deps = {
    config: fakeConfig(), gasClient: {}, browser: {},
    resolveArea: async (_client, { areaFolderId }) => ({ areaFolderId, areaName: '伊東市', exportFolderId: 'EXPORT1', spreadsheetName: '静岡県伊東市' }),
    runTabelogJob: async () => { throw new RateLimitError(403, 'https://tabelog.example/rstLst'); }
  };
  try {
    await __testables.runPipeline(job.jobId, deps);
    const state = getJob(job.jobId);
    assert.equal(state.status, 'needs_human');
  } finally { fs.rmSync(jobDir(job.jobId), { recursive: true, force: true }); }
});

test('createJob: 必須項目が無ければ例外', () => {
  assert.throws(() => createJob({ areaFolderId: '', areaName: '', genre: '' }));
});

test('ルーティング: /api/is/list-generation/* だけを処理しFSへは関与しない', async () => {
  assert.equal(await handleIsListGenerationRequest('GET', '/api/fs/deals'), null);
  const [badStatus, badBody] = await handleIsListGenerationRequest('POST', '/api/is/list-generation/jobs', {});
  assert.equal(badStatus, 400);
  assert.equal(badBody.ok, false);
  const [notFoundStatus] = await handleIsListGenerationRequest('GET', '/api/is/list-generation/jobs/does-not-exist');
  assert.equal(notFoundStatus, 404);
  const [areasStatus, areasBody] = await handleIsListGenerationRequest('GET', '/api/is/list-generation/areas');
  assert.equal(areasStatus, 502, 'GAS未設定のローカル環境では明示的なエラーを返す');
  assert.equal(areasBody.ok, false);
});
