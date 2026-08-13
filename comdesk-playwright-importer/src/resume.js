#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const importerRoot = path.resolve(here, '..');
const repositoryRoot = path.resolve(importerRoot, '..');
const jobsRoot = path.join(repositoryRoot, 'data', 'comdesk-jobs');

const jobId = valueArgument('--job-id=');
const requestedGroups = parseListArgument('--only-workgroups=');
const jobDirectory = jobId ? path.join(jobsRoot, jobId) : findLatestFailedJob(jobsRoot);
if (!jobDirectory || !fs.existsSync(jobDirectory)) fail('再開対象の失敗ジョブが見つかりません');

const stateFile = path.join(jobDirectory, 'state.json');
const sourceFile = path.join(jobDirectory, 'source.xlsx');
const resultFile = path.join(jobDirectory, 'comdesk-result.json');
if (!fs.existsSync(stateFile)) fail(`state.json が見つかりません: ${stateFile}`);
if (!fs.existsSync(sourceFile)) fail(`source.xlsx が見つかりません: ${sourceFile}`);

const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const previousResults = fs.existsSync(resultFile)
  ? JSON.parse(fs.readFileSync(resultFile, 'utf8'))
  : Array.isArray(state.results) ? state.results : [];
const projectName = state.projectName;
if (!projectName) fail('プロジェクト名を state.json から取得できません');

const remaining = previousResults.filter((item) => {
  if (!item?.workgroup) return false;
  if (!['success', 'existing'].includes(item.status)) return false;
  if (item.importStatus === 'completed') return false;
  if (requestedGroups.size && !requestedGroups.has(item.workgroup)) return false;
  return true;
});

if (!remaining.length) {
  console.log(`再開対象はありません: ${path.basename(jobDirectory)}`);
  process.exit(0);
}

console.log(`再開ジョブ: ${path.basename(jobDirectory)}`);
console.log(`プロジェクト: ${projectName}`);
console.log(`残り: ${remaining.map((item) => item.workgroup).join('、')}`);

const resumeResults = [];
for (const item of remaining) {
  const workgroup = item.workgroup;
  console.log(`\n再開処理: ${projectName} / ${workgroup}`);
  const finalizeReport = path.join(jobDirectory, `resume-finalize-${safeName(workgroup)}.json`);
  const finalizeCode = await runImporter([
    '--finalize-only',
    `--input=${sourceFile}`,
    `--project-name=${projectName}`,
    `--only-workgroups=${workgroup}`,
    `--result-file=${finalizeReport}`
  ]);

  if (finalizeCode === 0) {
    console.log(`再開完了: ${projectName} / ${workgroup}`);
    resumeResults.push({ workgroup, status: 'completed', mode: 'finalize-only' });
    continue;
  }

  console.warn(`承認処理でエラーを検知。完了通知だけを確認します: ${projectName} / ${workgroup}`);
  const completionReport = path.join(jobDirectory, `resume-completion-${safeName(workgroup)}.json`);
  const completionCode = await runImporter([
    '--completion-only',
    `--input=${sourceFile}`,
    `--project-name=${projectName}`,
    `--only-workgroups=${workgroup}`,
    `--result-file=${completionReport}`
  ]);

  if (completionCode === 0) {
    console.log(`完了通知を確認済みとして継続: ${projectName} / ${workgroup}`);
    resumeResults.push({ workgroup, status: 'completed', mode: 'completion-only-recovery' });
    continue;
  }

  console.error(`未完了のため記録して次へ進みます: ${projectName} / ${workgroup}`);
  resumeResults.push({ workgroup, status: 'failed', mode: 'completion-only-recovery' });
}

const resumeSummaryFile = path.join(jobDirectory, `resume-summary-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(resumeSummaryFile, JSON.stringify({
  jobId: path.basename(jobDirectory),
  projectName,
  resumedAt: new Date().toISOString(),
  results: resumeResults
}, null, 2));

const failed = resumeResults.filter((item) => item.status === 'failed');
console.log(`\n再開結果: 成功${resumeResults.length - failed.length}件 / 未完了${failed.length}件`);
console.log(`結果ファイル: ${resumeSummaryFile}`);
if (failed.length) process.exitCode = 1;

function runImporter(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/import.js', ...args], {
      cwd: importerRoot,
      stdio: 'inherit',
      env: process.env
    });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

function findLatestFailedJob(root) {
  if (!fs.existsSync(root)) return null;
  const candidates = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
  for (const directory of candidates) {
    const candidateState = path.join(directory, 'state.json');
    if (!fs.existsSync(candidateState)) continue;
    try {
      const value = JSON.parse(fs.readFileSync(candidateState, 'utf8'));
      if (value.status === 'failed') return directory;
    } catch {}
  }
  return null;
}

function parseListArgument(prefix) {
  const argument = process.argv.find((value) => value.startsWith(prefix));
  if (!argument) return new Set();
  return new Set(argument.slice(prefix.length).split(',').map((value) => value.trim()).filter(Boolean));
}

function valueArgument(prefix) {
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
}

function safeName(value) {
  return String(value || '').replace(/[^a-zA-Z0-9ぁ-んァ-ヶ一-龠_-]/g, '_').slice(0, 100);
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
