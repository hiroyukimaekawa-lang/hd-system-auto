import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeGenre } from '../src/genres.js';
import { GOOGLE_MAPS_HEADERS, parseCsv, TABELOG_HEADERS, writeCsv } from '../src/output.js';
import { canonicalUrl, isTargetAddress, selectPhone, splitAddress } from '../src/scraper-utils.js';
import { discoverLocation, DriveLocationError, GasWebAppClient } from '../src/drive.js';
import { driveCsvName } from '../src/drive-pipeline.js';
import { groupBelowMinimumByRoute, markSheetJob } from '../src/management-sheet.js';
import { parseSheetCommand } from '../src/sheet-command.js';

test('要求されたCSV列数と順序を維持する', () => {
  assert.equal(GOOGLE_MAPS_HEADERS.length, 20); assert.equal(TABELOG_HEADERS.length, 19);
  assert.equal(GOOGLE_MAPS_HEADERS[2], '検索ジャンル'); assert.ok(!TABELOG_HEADERS.includes('検索ジャンル'));
});

test('CSVはBOM・改行・引用符を壊さず往復する', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hd-list-')), 'test.csv');
  writeCsv(file, [{ 店名: '店,「A」', URL: 'https://example.com/1', 営業時間原文: '月曜\n火曜' }], TABELOG_HEADERS);
  const content = fs.readFileSync(file, 'utf8'); assert.ok(content.startsWith('\uFEFF'));
  const rows = parseCsv(content); assert.equal(rows[0].店名, '店,「A」'); assert.equal(rows[0].営業時間原文, '月曜\n火曜');
});

test('住所、市区町村外除外、電話、URLを正規化する', () => {
  assert.deepEqual(splitAddress('〒309-1211 茨城県桜川市岩瀬1'), { pref: '茨城県', city: '桜川市' });
  assert.equal(isTargetAddress('茨城県桜川市岩瀬1', '茨城県 桜川市'), true);
  assert.equal(isTargetAddress('茨城県水戸市中央1', '茨城県 桜川市'), false);
  assert.equal(selectPhone('予約 050-1234-5678 問合せ 0296-12-3456'), '0296-12-3456');
  assert.equal(canonicalUrl('https://tabelog.com/ibaraki/A0802/A080201/123/?x=1'), 'https://tabelog.com/ibaraki/A0802/A080201/123/');
});

test('既存拡張の主要ジャンル正規化を維持する', () => {
  assert.equal(normalizeGenre('喫茶店', '珈琲さくら', 'カフェ'), 'カフェ');
  assert.equal(normalizeGenre('カフェ、ラーメン', '麺屋さくら', 'カフェ'), 'ラーメン');
  assert.equal(normalizeGenre('弁当', 'さくら亭', ''), 'テイクアウト専門店');
});

test('Drive階層を都道府県、市区町村、固定名から探索する', async () => {
  const expected = { inputFolderId: 'input', spreadsheetId: 'sheet' };
  const result = await discoverLocation({ resolveLocation: async (root, pref, city, refresh) => { assert.deepEqual([root, pref, city, refresh], ['root', '茨城県', '土浦市', true]); return expected; } }, 'root', '茨城県', '土浦市');
  assert.equal(result.inputFolderId, 'input'); assert.equal(result.spreadsheetId, 'sheet');
});

test('Drive候補の重複は開始せず候補を返す', async () => {
  const folders = [{ id: 'a', name: '茨城県' }, { id: 'b', name: '茨城県' }];
  await assert.rejects(() => discoverLocation({ resolveLocation: async () => { throw new DriveLocationError('ambiguous', '重複', folders); } }, 'root', '茨城県', '土浦市'), error => error instanceof DriveLocationError && error.code === 'ambiguous' && error.candidates.length === 2);
});

test('Drive投入ファイル名は指定形式を使う', () => {
  assert.equal(driveCsvName('googlemaps', { area: '茨城県 土浦市', keyword: 'カフェ', outputGenre: 'カフェ' }, new Date('2026-07-16T01:30:00+09:00')), 'googlemaps_茨城県_土浦市_カフェ_20260716_0130.csv');
});

test('GAS Webアプリへ共有シークレット付きで探索要求を送る', async () => {
  let sent;
  const client = new GasWebAppClient({ url: 'https://example.test/exec', secret: 'secret', fetchImpl: async (_url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ ok: true, data: { cityFolderId: 'city' } }) };
  } });
  const result = await client.resolveLocation('root', '茨城県', '土浦市');
  assert.equal(result.cityFolderId, 'city'); assert.equal(sent.secret, 'secret'); assert.equal(sent.action, 'resolveLocation');
});

test('GAS Webアプリの探索エラーをSlack向け候補付きエラーに変換する', async () => {
  const client = new GasWebAppClient({ url: 'https://example.test/exec', secret: 'secret', fetchImpl: async () => ({ ok: true, json: async () => ({ ok: false, code: 'location_ambiguous', error: '重複', candidates: [{ id: '1', name: '土浦市' }] }) }) });
  await assert.rejects(() => client.resolveLocation('root', '茨城県', '土浦市'), error => error instanceof DriveLocationError && error.candidates[0].id === '1');
});

test('最低件数未満を営業ルートとジャンル単位でまとめる', () => {
  const groups = groupBelowMinimumByRoute([
    { city: '土浦市', route: 'E', genre: 'カフェ', minimumCount: 50, completedCount: 20 },
    { city: '阿見町', route: 'E', genre: 'カフェ', minimumCount: 50, completedCount: 30 },
    { city: '牛久市', route: 'E', genre: 'カフェ', minimumCount: 20, completedCount: 25 }
  ]);
  assert.equal(groups.length, 1); assert.deepEqual(groups[0].members.map(item => item.city), ['土浦市', '阿見町']);
});

test('管理マスタ状態更新をGASへ渡す', async () => {
  let request;
  await markSheetJob({ request: async (action, payload) => { request = { action, payload }; return { ok: true }; } }, 14, 'completed', { jobId: 'job-1', completedCsvLink: 'https://drive.test/file' });
  assert.equal(request.action, 'updateMasterStatus'); assert.equal(request.payload.rowNumber, 14); assert.equal(request.payload.state, 'completed');
});

test('管理マスタSlackコマンドを解析する', () => {
  assert.deepEqual(parseSheetCommand('茨城県 飲食店'), { prefecture: '茨城県', industry: '飲食店' });
  assert.throws(() => parseSheetCommand('茨城県'), /使い方/);
});
