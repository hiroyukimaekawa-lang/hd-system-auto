import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRecords, mergeDuplicates, normalizePhone } from '../src/orchestrator/records.js';

test('電話番号を国内数字形式へ正規化する', () => { assert.equal(normalizePhone('+81 90-1234-5678'), '09012345678'); });
test('電話番号が同じ媒体レコードを統合する', () => {
  const rows = mergeDuplicates([{ name:'店A',address:'住所',phone:'0291234567',source:'googlemaps',sourceUrl:'g' },{ name:'店A',address:'住所',phone:'0291234567',source:'tabelog',sourceUrl:'t' }]);
  assert.equal(rows.length, 1); assert.deepEqual(rows[0].sources, ['googlemaps','tabelog']);
});
test('電話なしは確認、チェーンは除外する', () => {
  const result = classifyRecords([{ name:'個人店',address:'茨城県',phone:'',raw:{} },{ name:'スターバックス店',address:'茨城県',phone:'1',raw:{} }]);
  assert.equal(result[0].bucket, 'review'); assert.equal(result[1].bucket, 'excluded');
});
