import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseCsv } from '../src/output.js';
import { COMDESK_HEADERS, assignRegions, classifyRecords, consolidateMinorGenres, validateComdeskRecords, writeClassifiedOutputs } from '../src/orchestrator/records.js';
import { preflightEnvironment, sourcesForCategory } from '../src/orchestrator/config.js';

const base = (overrides = {}) => ({ name:'個人店', address:'茨城県水戸市泉町1-2 第三ビル4F', prefecture:'茨城県', area:'水戸市', phone:'0291234567', genre:'焼き鳥', bucket:'target', source:'googlemaps', sourceUrl:'https://maps.test/1', raw:{}, ...overrides });

test('AFFILIATEはビル・階表記だけで除外せず、ELECTRICは確認対象にする', () => {
  assert.equal(classifyRecords([base()], { profile:'AFFILIATE' })[0].bucket, 'target');
  assert.equal(classifyRecords([base()], { profile:'ELECTRIC' })[0].bucket, 'review');
});

test('共通除外と明確な管理会社を除外する', () => {
  for (const name of ['道の駅みと','カラオケ青空','中央総合公園','霞ヶ浦ゴルフ','ホテル水戸','スーパー水戸','イオンモール水戸','水戸ビル管理会社']) {
    assert.equal(classifyRecords([base({ name })], { profile:'AFFILIATE' })[0].bucket, 'excluded', name);
  }
});

test('少数ジャンルは19件で統合、20件で独立する', () => {
  const nineteen = Array.from({ length:19 }, (_, i) => base({ name:`店${i}`, phone:`02912345${String(i).padStart(2,'0')}` }));
  assert.ok(consolidateMinorGenres(nineteen, 20).records.every((row) => row.genre === '居酒屋'));
  const twenty = [...nineteen, base({ name:'店20', phone:'0291234599' })];
  assert.ok(consolidateMinorGenres(twenty, 20).records.every((row) => row.genre === '焼き鳥'));
});

test('県一括データを地域マスタへ一意に分割し、不明は確認対象にする', () => {
  const master = [{ prefecture:'茨城県', outputArea:'稲敷市・美浦村', municipalities:['稲敷市','美浦村'] }];
  const [known, unknown] = assignRegions([base({ address:'茨城県稲敷市江戸崎1' }), base({ address:'茨城県土浦市中央1' })], master);
  assert.equal(known.area, '稲敷市・美浦村'); assert.equal(unknown.reason, 'エリア不明'); assert.equal(unknown.bucket, 'review');
});

test('コムデスクCSVは31列・指定順で内部監査列を含まない', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-e2e-'));
  const result = writeClassifiedOutputs(dir, [base({ bucket:'target', sources:['googlemaps'], sourceUrls:['https://maps.test/1'] })], { date:new Date('2026-07-22T00:00:00+09:00') });
  const csv = fs.readFileSync(result.files[0].file, 'utf8'); const [row] = parseCsv(csv);
  assert.deepEqual(Object.keys(row), COMDESK_HEADERS); assert.equal(Object.keys(row).length, 31); assert.equal(row.Tel1, '0291234567'); assert.ok(!('判定理由' in row));
});

test('電話形式と重複を事前検証する', () => {
  assert.equal(validateComdeskRecords([base()]).ok, true);
  assert.equal(validateComdeskRecords([base(), base()]).ok, false);
});

test('飲食店だけ食べログを取得し、本番設定は明示必須', () => {
  assert.deepEqual(sourcesForCategory('飲食店'), ['googlemaps','tabelog']); assert.deepEqual(sourcesForCategory('花屋'), ['googlemaps']);
  assert.equal(preflightEnvironment({}).ok, false);
  assert.equal(preflightEnvironment({ SYSTEM_PROFILE:'AFFILIATE', GAS_WEB_APP_URL:'x', GAS_WEB_APP_SECRET:'1234567890123456' }).ok, true);
});
