#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';
import { downloadSpreadsheet, runFlow } from './flow.js';

function parseArgs(argv) {
  return Object.fromEntries(
    argv
      .filter((value) => value.startsWith('--'))
      .map((value) => {
        const [key, ...rest] = value.slice(2).split('=');
        return [key, rest.length ? rest.join('=') : true];
      })
  );
}

function safeName(value) {
  return String(value || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 120);
}

function salonAreaFromSheetName(sheetName) {
  const match = String(sheetName || '').match(/^04_SALES_(.+)_美容室$/);
  return match ? match[1].trim() : '';
}

function detectPrefecture(rows, sheetName) {
  const prefectures = new Set(
    rows.map((row) => String(row['都道府県'] || '').trim()).filter(Boolean)
  );
  if (prefectures.size !== 1) {
    throw new Error(
      `${sheetName}: 都道府県を一意に判定できません（${[...prefectures].join('、') || '未取得'}）`
    );
  }
  return [...prefectures][0];
}

async function main() {
  const values = parseArgs(process.argv.slice(2));
  if (!values['spreadsheet-url'] && !values.input) {
    throw new Error('--spreadsheet-url または --input を指定してください');
  }

  const dryRun = Boolean(values['dry-run']);
  const execute = Boolean(values.execute);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comdesk-salon-'));
  const sourceFile = path.join(tempDir, 'source.xlsx');

  try {
    if (values.input) {
      const inputPath = path.resolve(String(values.input));
      if (!fs.existsSync(inputPath)) throw new Error(`入力ファイルが見つかりません: ${inputPath}`);
      fs.copyFileSync(inputPath, sourceFile);
    } else {
      await downloadSpreadsheet(String(values['spreadsheet-url']), sourceFile);
    }

    const workbook = XLSX.readFile(sourceFile, { cellDates: true });
    const targetSheets = workbook.SheetNames.filter((name) => /^04_SALES_.+_美容室$/.test(name));
    if (!targetSheets.length) {
      throw new Error('04_SALES_*_美容室 のシートがありません');
    }

    console.log(`美容院専用モード: ${targetSheets.length}タブを検出しました`);
    const baseJobId = values['job-id'] || `salon_${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
    const summaries = [];

    for (let index = 0; index < targetSheets.length; index += 1) {
      const sheetName = targetSheets[index];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!rows.length) {
        console.log(`スキップ: ${sheetName}（データ0件）`);
        continue;
      }

      const area = salonAreaFromSheetName(sheetName);
      if (!area) throw new Error(`${sheetName}: エリア名を判定できません`);
      const prefecture = detectPrefecture(rows, sheetName);
      const projectName = `${prefecture}_${area}`;

      const singleWorkbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(singleWorkbook, sheet, sheetName);
      const singleFile = path.join(tempDir, `${String(index + 1).padStart(2, '0')}_${safeName(sheetName)}.xlsx`);
      XLSX.writeFile(singleWorkbook, singleFile);

      console.log(`\n[${index + 1}/${targetSheets.length}] ${sheetName} → ${projectName} / 美容院 (${rows.length}件)`);
      const { state } = await runFlow({
        input: singleFile,
        projectName,
        dryRun,
        execute,
        jobId: `${baseJobId}_${String(index + 1).padStart(2, '0')}`
      });
      summaries.push({ sheetName, projectName, rows: rows.length, status: state.status });
    }

    console.log('\n美容院専用処理結果');
    console.log(JSON.stringify({ ok: true, dryRun, count: summaries.length, results: summaries }, null, 2));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
