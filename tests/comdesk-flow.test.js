import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { inferProjectName, spreadsheetIdFromUrl } from '../comdesk-playwright-importer/src/flow.js';

const require = createRequire(import.meta.url);
const XLSX = require('../comdesk-playwright-importer/node_modules/xlsx');

test('GoogleスプレッドシートURLからIDを取得する', () => {
  assert.equal(spreadsheetIdFromUrl('https://docs.google.com/spreadsheets/d/abc_DEF-123/edit?gid=0'), 'abc_DEF-123');
  assert.throws(() => spreadsheetIdFromUrl('https://example.com/file'), /URL/);
});

test('31列シートの住所からプロジェクト名を決定する', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'comdesk-flow-')), 'source.xlsx');
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet([{ 都道府県:'茨城県', '住所１':'稲敷市江戸崎1', 名前:'店A', Tel1:'0291234567' }, { 都道府県:'茨城県', '住所１':'稲敷郡美浦村大谷2', 名前:'店B', Tel1:'0291234568' }]);
  XLSX.utils.book_append_sheet(workbook, sheet, '04_SALES_カフェ'); XLSX.writeFile(workbook, file);
  assert.equal(inferProjectName(file), '茨城県_稲敷市・美浦村');
});

test('管理・監査シートの住所はプロジェクト名判定に混入させない', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'comdesk-flow-')), 'source.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ 都道府県:'神奈川県', '住所１':'神奈川県神奈川県小田原市栄町1', 名前:'店A', Tel1:'0465123456' }]), '04_SALES_カフェ');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ 都道府県:'東京都', 住所:'新宿区西新宿1' }]), '電話番号補完ログ');
  XLSX.writeFile(workbook, file);
  assert.equal(inferProjectName(file), '神奈川県_小田原市');
});
