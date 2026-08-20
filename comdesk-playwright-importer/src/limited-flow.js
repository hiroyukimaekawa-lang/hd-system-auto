#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import XLSX from 'xlsx';
import { downloadSpreadsheet, inferProjectName } from './flow.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const importerRoot = path.resolve(here, '..');
const config = JSON.parse(fs.readFileSync(path.join(importerRoot, 'config.json'), 'utf8'));

function parseArgs(argv) {
  return Object.fromEntries(argv.filter((value) => value.startsWith('--')).map((value) => {
    const [key, ...rest] = value.slice(2).split('=');
    return [key, rest.length ? rest.join('=') : true];
  }));
}

function normalizeWorkgroups(value) {
  const requested = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!requested.length) throw new Error('--only-workgroups に対象ジャンルをカンマ区切りで指定してください');

  const aliases = config.workgroupAliases || {};
  const normalized = [];
  const unknown = [];
  for (const raw of requested) {
    const match = Object.entries(aliases).find(([canonical, words]) => {
      if (canonical.toLowerCase() === raw.toLowerCase()) return true;
      return (words || []).some((word) => String(word).toLowerCase() === raw.toLowerCase());
    });
    if (!match) unknown.push(raw);
    else if (!normalized.includes(match[0])) normalized.push(match[0]);
  }
  if (unknown.length) throw new Error(`未登録のジャンルがあります: ${unknown.join('、')}`);
  return normalized;
}

function detectWorkgroup(sheetName) {
  const aliases = config.workgroupAliases || {};
  for (const [canonical, words] of Object.entries(aliases)) {
    if ([canonical, ...(words || [])].some((word) => String(sheetName).toLowerCase().includes(String(word).toLowerCase()))) {
      return canonical;
    }
  }
  return '';
}

export function filterWorkbook(inputFile, outputFile, onlyWorkgroups) {
  const workbook = XLSX.readFile(inputFile, { cellDates: true });
  const selected = new Set(onlyWorkgroups);
  const output = XLSX.utils.book_new();
  const kept = [];
  for (const sheetName of workbook.SheetNames) {
    const workgroup = detectWorkgroup(sheetName);
    if (!workgroup || !selected.has(workgroup)) continue;
    XLSX.utils.book_append_sheet(output, workbook.Sheets[sheetName], sheetName);
    kept.push({ sheetName, workgroup });
  }
  if (!kept.length) throw new Error(`指定ジャンルの対象シートがありません: ${onlyWorkgroups.join('、')}`);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  XLSX.writeFile(output, outputFile);
  return kept;
}

function runProcess(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const values = parseArgs(process.argv.slice(2));
  if (!values['spreadsheet-url']) throw new Error('--spreadsheet-url を指定してください');
  const onlyWorkgroups = normalizeWorkgroups(values['only-workgroups']);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comdesk-limited-'));
  const source = path.join(tempDir, 'source.xlsx');
  const filtered = path.join(tempDir, 'filtered.xlsx');

  try {
    await downloadSpreadsheet(values['spreadsheet-url'], source);
    const projectName = values['project-name'] || inferProjectName(source);
    const kept = filterWorkbook(source, filtered, onlyWorkgroups);
    console.log(`対象ジャンル: ${onlyWorkgroups.join('、')}`);
    console.log(`対象シート: ${kept.map((item) => item.sheetName).join('、')}`);

    const args = ['src/flow.js', `--input=${filtered}`, `--project-name=${projectName}`];
    if (values['dry-run']) args.push('--dry-run');
    if (values.execute) args.push('--execute');
    if (values['job-id']) args.push(`--job-id=${values['job-id']}`);

    const code = await runProcess(process.execPath, args, importerRoot);
    process.exitCode = code;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`限定ジャンル投入でエラー: ${error.message}`);
    process.exitCode = 1;
  });
}
