#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeSalesSources } from './merge.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).filter((value) => value.startsWith('--')).map((value) => { const [key, ...rest] = value.slice(2).split('='); return [key, rest.length ? rest.join('=') : true]; }));
const areas = String(args.areas || '').split(',').map((value) => value.trim()).filter(Boolean);
if (areas.join(',') !== '美浦村,稲敷市') fail('--areas=美浦村,稲敷市 を指定してください');
if (args.category !== '飲食店') fail('--category=飲食店 を指定してください');
if (!args['project-name']) fail('--project-nameを指定してください');
const dryRun = Boolean(args['dry-run']);
const finalizeOnly = Boolean(args['finalize-only']);
if (!dryRun && !args.execute && !finalizeOnly) fail('安全のため、--dry-run、--execute、--finalize-onlyのいずれかが必要です');

const snapshotFile = path.join(root, 'data', 'merge-sources', 'inashiki-miho.json');
const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
let merged;
try { merged = mergeSalesSources(snapshot, areas); }
catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, differences: error.differences, countMismatches: error.countMismatches }, null, 2)); process.exit(1);
}
const outputDir = path.join(root, 'outputs', '019f7e48-3b54-7983-8b02-5f8cc68fafd6'); fs.mkdirSync(outputDir, { recursive: true });
const workbookFile = path.join(outputDir, '稲敷市・美浦村.xlsx');
const buildInput = path.join(outputDir, 'merge-workbook-input.json');
fs.writeFileSync(buildInput, JSON.stringify({ sheets: merged.sheets, sourceUrls: snapshot.sources.map((source) => source.sourceUrl) }));
await run(process.execPath, [path.join(root, 'tools', 'artifact-runtime', 'build-merge-workbook.mjs'), buildInput, workbookFile, path.join(outputDir, 'qa')], root);

const comdeskResult = path.join(outputDir, 'comdesk-dry-run.json');
const importerArgs = ['src/import.js', ...(dryRun ? ['--dry-run'] : []), ...(finalizeOnly ? ['--finalize-only'] : []), `--input=${workbookFile}`, `--project-name=${args['project-name']}`, `--result-file=${comdeskResult}`, `--screenshots-dir=${path.join(outputDir, 'screenshots')}`];
await run(process.execPath, importerArgs, path.join(root, 'comdesk-playwright-importer'));
fs.writeFileSync(path.join(outputDir, 'merge-result.json'), JSON.stringify({ ok: true, dryRun, finalizeOnly, projectName: args['project-name'], workbookFile, ...merged, sheets: undefined }, null, 2));
printSummary(merged);
console.log(JSON.stringify({ ok: true, dryRun, finalizeOnly, workbookFile, projectName: args['project-name'], beforeTotal: merged.beforeTotal, duplicateTotal: merged.duplicateTotal, afterTotal: merged.afterTotal }, null, 2));

function printSummary(result) {
  console.log('\nジャンル別統合結果');
  for (const item of result.summary) console.log(`${item.sheetName}: 美浦村 ${item.counts['美浦村']}件 / 稲敷市 ${item.counts['稲敷市']}件 / 統合前 ${item.before}件 / 重複除外 ${item.duplicates}件 / 統合後 ${item.after}件`);
  console.log(`合計: 美浦村 ${result.areaTotals['美浦村']}件 / 稲敷市 ${result.areaTotals['稲敷市']}件 / 統合前 ${result.beforeTotal}件 / 重複除外 ${result.duplicateTotal}件 / 統合後 ${result.afterTotal}件`);
}
function run(command, commandArgs, cwd) { return new Promise((resolve, reject) => { const child = spawn(command, commandArgs, { cwd, stdio: 'inherit' }); child.once('error', reject); child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`子処理が失敗しました (exit ${code})`))); }); }
function fail(message) { console.error(message); process.exit(2); }
