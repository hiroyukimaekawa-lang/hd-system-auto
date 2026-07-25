#!/usr/bin/env node
/**
 * コムデスク一括自動投入ランナー
 *
 * 複数のGoogleスプレッドシートを、1回のコマンドで順番に投入する。
 * 既存の単発フロー（flow.js の runFlow）をそのまま呼び出すため、
 * 投入・通知確認・結果取得の挙動は単発実行と完全に同じ。
 *
 * ログイン状態を持つブラウザを共有するため、並列ではなく1件ずつ順番に実行する。
 *
 * 入力の指定方法（いずれか、併用可）:
 *   --list=<ファイル>          1行1件のテキスト。詳しくは下の「リストファイルの形式」参照
 *   --spreadsheet-url=<URL>    複数回指定できる（--spreadsheet-url=A --spreadsheet-url=B）
 *
 * リストファイルの形式:
 *   ・1行に1つ、GoogleスプレッドシートのURLを書く
 *   ・空行と # で始まる行（コメント）は無視する
 *   ・プロジェクト名を明示したい場合は URL の後ろに縦棒かタブで続ける
 *       https://docs.google.com/.../edit | 神奈川県_寒川町
 *     省略時は単発実行と同じく住所から自動決定する
 *
 * 使い方:
 *   node src/batch.js --list=../config/comdesk-batch.txt --dry-run
 *   node src/batch.js --list=../config/comdesk-batch.txt --execute   （要 COMDESK_EXECUTE=true）
 *
 * オプション:
 *   --dry-run            登録せず確認だけ（既定。--execute未指定時）
 *   --execute            本番投入
 *   --stop-on-error      1件でも失敗したらそこで中断する（既定は失敗しても次へ進む）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFlow } from './flow.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const urls = [];
  const options = { list: null, dryRun: false, execute: false, stopOnError: false };
  for (const value of argv) {
    if (!value.startsWith('--')) continue;
    const [key, ...rest] = value.slice(2).split('=');
    const raw = rest.length ? rest.join('=') : true;
    if (key === 'spreadsheet-url') urls.push(String(raw));
    else if (key === 'list') options.list = String(raw);
    else if (key === 'dry-run') options.dryRun = true;
    else if (key === 'execute') options.execute = true;
    else if (key === 'stop-on-error') options.stopOnError = true;
  }
  return { urls, options };
}

// リストファイル / URL指定を、{ spreadsheetUrl, projectName } の配列へ正規化する
function buildJobs({ urls, listFile }) {
  const jobs = [];

  if (listFile) {
    const resolved = path.resolve(listFile);
    if (!fs.existsSync(resolved)) throw new Error(`リストファイルが見つかりません: ${resolved}`);
    const lines = fs.readFileSync(resolved, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [urlPart, ...nameParts] = trimmed.split(/\s*[|\t]\s*/);
      const url = urlPart.trim();
      if (!url) continue;
      jobs.push({ spreadsheetUrl: url, projectName: nameParts.join(' ').trim() || undefined });
    }
  }

  for (const url of urls) {
    const clean = String(url).trim();
    if (clean) jobs.push({ spreadsheetUrl: clean, projectName: undefined });
  }

  // 同一URLの重複は除く（先に現れたものを優先）
  const seen = new Set();
  return jobs.filter((job) => {
    if (seen.has(job.spreadsheetUrl)) return false;
    seen.add(job.spreadsheetUrl);
    return true;
  });
}

async function main() {
  const { urls, options } = parseArgs(process.argv.slice(2));

  let jobs;
  try {
    jobs = buildJobs({ urls, listFile: options.list });
  } catch (error) {
    console.error(`[batch] ${error.message}`);
    process.exit(2);
  }

  if (!jobs.length) {
    console.error('[batch] 投入対象がありません。--list=<ファイル> か --spreadsheet-url=<URL> を指定してください。');
    process.exit(2);
  }

  const mode = options.execute ? '本番投入' : '確認（dry-run）';
  console.log(`[batch] ${jobs.length}件を${mode}で順番に処理します。`);
  jobs.forEach((job, index) => console.log(`  ${index + 1}. ${job.spreadsheetUrl}${job.projectName ? `  → ${job.projectName}` : ''}`));
  console.log('');

  const results = [];
  for (let index = 0; index < jobs.length; index++) {
    const job = jobs[index];
    const label = `[${index + 1}/${jobs.length}]`;
    console.log(`\n========== ${label} 開始 ==========`);
    console.log(`${label} ${job.spreadsheetUrl}`);

    try {
      const { state, directory } = await runFlow({
        spreadsheetUrl: job.spreadsheetUrl,
        projectName: job.projectName,
        dryRun: !options.execute,
        execute: options.execute
      });
      console.log(`${label} 完了: ${state.projectName}（${state.status}）`);
      results.push({ ok: true, index: index + 1, spreadsheetUrl: job.spreadsheetUrl, projectName: state.projectName, status: state.status, jobId: state.jobId, directory });
    } catch (error) {
      console.error(`${label} 失敗: ${error.message}`);
      results.push({ ok: false, index: index + 1, spreadsheetUrl: job.spreadsheetUrl, error: error.message, jobId: error.jobId, stateFile: error.stateFile });
      if (options.stopOnError) {
        console.error(`${label} --stop-on-error が指定されているため、ここで中断します。`);
        break;
      }
    }
  }

  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  console.log('\n============ まとめ ============');
  console.log(`対象 ${jobs.length}件 / 成功 ${succeeded.length}件 / 失敗 ${failed.length}件 / 未処理 ${jobs.length - results.length}件`);
  for (const item of results) {
    const head = item.ok ? `OK   ${item.projectName}（${item.status}）` : `NG   ${item.error}`;
    console.log(`  ${String(item.index).padStart(2, ' ')}. ${head}`);
    console.log(`      ${item.spreadsheetUrl}`);
  }

  // まとめをファイルにも残す
  const summaryDir = path.resolve(here, '..', '..', 'data', 'comdesk-jobs');
  fs.mkdirSync(summaryDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const summaryFile = path.join(summaryDir, `batch-${stamp}.json`);
  fs.writeFileSync(summaryFile, JSON.stringify({ mode, total: jobs.length, succeeded: succeeded.length, failed: failed.length, results }, null, 2));
  console.log(`\n[batch] まとめを保存しました: ${summaryFile}`);

  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => { console.error('[batch] 想定外のエラー:', error); process.exit(1); });
