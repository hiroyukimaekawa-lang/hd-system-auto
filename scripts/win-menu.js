#!/usr/bin/env node
/**
 * Windows / macOS 共通のメニュー式ランチャー。
 *
 * run.ps1 と同じ操作を、PowerShell を使わずに Node.js だけで行う。
 * PowerShell の実行ポリシー（スクリプトの実行がシステムで無効になっています）や、
 * cmd.exe の文字化けの影響を受けない。
 *
 * 起動方法（Windows）: run.bat をダブルクリック
 * 起動方法（直接）  : node scripts/win-menu.js [タスク名] [オプション]
 *
 * このファイルは外部パッケージに依存しない。npm install の前でも動く必要があるため。
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ScriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ImporterDir = path.join(ScriptDir, 'comdesk-playwright-importer');
const AssistantPort = process.env.HD_ASSISTANT_PORT || '43117';
const AssistantUrl = `http://127.0.0.1:${AssistantPort}`;

const IsWindows = process.platform === 'win32';

const TASKS = [
  'menu', 'setup', 'login', 'dry', 'run',
  'comdesk', 'batch', 'merge', 'assistant', 'slack', 'check',
];

// ---------------------------------------------------------------------
// 画面表示
// ---------------------------------------------------------------------
const color = (code, text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const step = (m) => console.log(color('36', `[run] ${m}`));
const warn = (m) => console.log(color('33', `[run] ${m}`));
const err = (m) => console.log(color('31', `[run] ${m}`));

let rl;
const ask = async (prompt) => {
  if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${prompt}: `);
  return String(answer).trim().replace(/^["']|["']$/g, '');
};

const askRequired = async (prompt, current) => {
  if (current) return String(current).trim();
  return ask(prompt);
};

const confirm = async (message) => /^[yY]/.test(await ask(`${message} (y/N)`));

// ---------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { task: 'menu', flags: {} };
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [rawKey, ...rest] = arg.slice(2).split('=');
      const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      opts.flags[key] = rest.length ? rest.join('=') : true;
    } else if (TASKS.includes(arg)) {
      opts.task = arg;
    } else {
      err(`不明な指定です: ${arg}`);
      err(`使えるタスク: ${TASKS.join(', ')}`);
      process.exit(1);
    }
  }
  return opts;
}

const { task: requestedTask, flags } = parseArgs(process.argv.slice(2));
let execute = Boolean(flags.execute);

// ---------------------------------------------------------------------
// 子プロセス
// ---------------------------------------------------------------------
let lastExit = 0;

/**
 * node で JS を実行する。引数にユーザー入力（URL・地名）が入るため
 * shell は使わない（そのまま node.exe へ渡す）。
 */
function runNode(args, cwd = ScriptDir) {
  console.log('');
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  lastExit = result.status === null ? 1 : result.status;
}

/**
 * npm を実行する。Windows では npm が npm.cmd のため shell:true が必要。
 * 渡す引数は固定文字列のみで、ユーザー入力は通さない。
 */
function runNpm(args, cwd = ScriptDir) {
  const result = spawnSync(IsWindows ? 'npm.cmd' : 'npm', args, {
    cwd,
    stdio: 'inherit',
    shell: IsWindows,
  });
  if (result.error && result.error.code === 'ENOENT') {
    err('npm が見つかりません。Node.js を再インストールしてください。');
    lastExit = 1;
    return;
  }
  lastExit = result.status === null ? 1 : result.status;
}

function openUrl(url) {
  if (IsWindows) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

// ---------------------------------------------------------------------
// Node.js のバージョン確認
// ---------------------------------------------------------------------
function assertNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    err(`Node.js 20 以上が必要です（現在: v${process.versions.node}）。LTS 版へ更新してください。`);
    console.log('');
    console.log('  winget install OpenJS.NodeJS.LTS');
    console.log('  インストール後、この画面を一度閉じてから起動し直してください。');
    return false;
  }
  step(`Node.js v${process.versions.node} を使用します`);
  return true;
}

// ---------------------------------------------------------------------
// .env の COMDESK_EXECUTE（環境変数が優先）
// ---------------------------------------------------------------------
function getComdeskExecuteValue() {
  if (process.env.COMDESK_EXECUTE) return process.env.COMDESK_EXECUTE;
  const envFile = path.join(ScriptDir, '.env');
  if (!fs.existsSync(envFile)) return '';
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  const hit = lines.filter((l) => /^\s*COMDESK_EXECUTE\s*=/.test(l)).pop();
  if (!hit) return '';
  return hit.replace(/^[^=]*=\s*/, '').trim().replace(/^["']|["']$/g, '');
}

// 本番投入は --execute と COMDESK_EXECUTE=true の両方が必要。
async function confirmComdeskExecute() {
  const current = getComdeskExecuteValue();
  if (current === 'true') return true;

  warn(`.env の COMDESK_EXECUTE が true ではありません（現在: ${current || '未設定'}）。`);
  warn('コムデスクへの書き込みは、この設定が true の場合だけ行われます。');
  if (await confirm('この1回だけ COMDESK_EXECUTE=true にして続行しますか？')) {
    process.env.COMDESK_EXECUTE = 'true';
    return true;
  }
  step('中止しました。恒久的に有効にする場合は .env の COMDESK_EXECUTE=true を編集してください。');
  return false;
}

// ---------------------------------------------------------------------
// 各タスク
// ---------------------------------------------------------------------
function invokeSetup() {
  step('初回セットアップを開始します（数分かかることがあります）');

  const envFile = path.join(ScriptDir, '.env');
  const envExample = path.join(ScriptDir, '.env.example');
  if (!fs.existsSync(envFile) && fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, envFile);
    warn(`.env を .env.example から作成しました。実行前に中身（GASのURL・シークレット等）を編集してください: ${envFile}`);
  }

  // コムデスク投入に必要なものを先に入れる。
  // ルート側は better-sqlite3 のビルドで失敗することがあるため、後回しにして
  // 失敗しても投入機能だけは使える状態で終われるようにする。
  step('コムデスク投入ツールの依存パッケージを取得します（npm install）...');
  runNpm(['install'], ImporterDir);
  if (lastExit !== 0) {
    err('npm install に失敗しました（comdesk-playwright-importer）。');
    console.log('  社内プロキシ環境では npm config set proxy / https-proxy の設定が必要なことがあります。');
    return;
  }

  step('Playwright用のChromiumを取得します（500MBほどダウンロードします）...');
  runNpm(['run', 'install-browser'], ImporterDir);
  if (lastExit !== 0) { err('ブラウザの取得に失敗しました。'); return; }

  step('本体の依存パッケージを取得します（npm install）...');
  runNpm(['install'], ScriptDir);
  if (lastExit !== 0) {
    warn('本体側の npm install に失敗しました。');
    console.log('  ただし「コムデスクへの投入」（メニュー 5〜8）はこのままでも使えます。');
    console.log('  リスト取得やSlack常駐アプリも使う場合は、次のどちらかを試してください。');
    console.log('    ・Node.js を LTS（20 または 22）に合わせる');
    console.log('    ・winget install Microsoft.VisualStudio.2022.BuildTools でビルドツールを入れる');
    lastExit = 0;
  }

  step('セットアップが完了しました。次は「2) コムデスクにログイン」を実行してください。');
}

function invokeLogin() {
  step('コムデスクのログイン画面を開きます。ログイン後、プロジェクト管理画面まで進んでから、この画面で Enter を押してください。');
  // login.js が標準入力の Enter を待つため、こちらの readline は閉じておく
  if (rl) { rl.close(); rl = null; }
  runNode(['src/login.js'], ImporterDir);
}

async function invokePipeline(mode) {
  const pref = await askRequired('都道府県を入力してください（例: 茨城県）', flags.prefecture);
  const area = await askRequired('市区町村を入力してください（例: 土浦市）', flags.area);
  const cat = await askRequired('ジャンルを入力してください（例: 飲食店）', flags.category);

  if (!pref || !area || !cat) {
    err('都道府県・市区町村・ジャンルはすべて必要です。');
    lastExit = 1;
    return;
  }

  if (mode === 'run') {
    warn('本番実行です。Googleマップ／食べログの取得と、設定によってはコムデスクへの登録を行います。');
    if (!(await confirm('実行してよろしいですか？'))) { step('中止しました。'); return; }
  }

  runNode(['src/orchestrator/cli.js', mode, `--prefecture=${pref}`, `--area=${area}`, `--category=${cat}`]);
}

async function invokeComdesk() {
  const url = await askRequired('GoogleスプレッドシートのURLを貼り付けてください', flags.spreadsheetUrl);
  if (!url) {
    err('スプレッドシートのURLが必要です。');
    lastExit = 1;
    return;
  }

  const args = ['comdesk-playwright-importer/src/flow.js', `--spreadsheet-url=${url}`];
  if (flags.projectName) args.push(`--project-name=${flags.projectName}`);

  if (execute) {
    warn('本番投入です。コムデスクへ実際に登録されます。');
    if (!(await confirm('実行してよろしいですか？'))) { step('中止しました。'); return; }
    if (!(await confirmComdeskExecute())) return;
    args.push('--execute');
  } else {
    step('書き込みなしの確認実行（--dry-run）で実行します。');
    args.push('--dry-run');
  }

  runNode(args);
}

async function invokeBatch() {
  const listFile = await askRequired('リストファイルのパスを入力してください（例: config\\comdesk-batch.txt）', flags.list);
  if (!listFile) {
    err('リストファイルが必要です。');
    lastExit = 1;
    return;
  }
  if (!fs.existsSync(path.resolve(ScriptDir, listFile))) {
    err(`リストファイルが見つかりません: ${listFile}`);
    lastExit = 1;
    return;
  }

  const args = ['comdesk-playwright-importer/src/batch.js', `--list=${listFile}`];
  if (flags.stopOnError) args.push('--stop-on-error');

  if (execute) {
    warn('本番投入です。リスト内のすべてのシートがコムデスクへ順番に登録されます。');
    if (!(await confirm('実行してよろしいですか？'))) { step('中止しました。'); return; }
    if (!(await confirmComdeskExecute())) return;
    args.push('--execute');
  } else {
    step('書き込みなしの確認実行（--dry-run）で実行します。');
    args.push('--dry-run');
  }

  runNode(args);
}

async function invokeMerge() {
  const projectName = await askRequired('プロジェクト名を入力してください（例: 茨城県_稲敷市・美浦村）', flags.projectName);
  if (!projectName) {
    err('プロジェクト名が必要です。');
    lastExit = 1;
    return;
  }

  const args = ['src/merge/cli.js', '--areas=美浦村,稲敷市', '--category=飲食店', `--project-name=${projectName}`];
  if (execute) {
    warn('本番投入です。コムデスクへ実際に登録されます。');
    if (!(await confirm('実行してよろしいですか？'))) { step('中止しました。'); return; }
    if (!(await confirmComdeskExecute())) return;
    args.push('--execute');
  } else {
    args.push('--dry-run');
  }

  runNode(args);
}

async function isAssistantAlive() {
  try {
    const res = await fetch(`${AssistantUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function invokeAssistant() {
  if (await isAssistantAlive()) {
    step(`HD AIアシスタントは起動済みです。ブラウザで開きます: ${AssistantUrl}`);
  } else {
    step('HD AIアシスタントを起動します...');
    fs.mkdirSync(path.join(ScriptDir, 'state'), { recursive: true });
    spawn(process.execPath, ['desktop/server.js'], {
      cwd: ScriptDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();

    let alive = false;
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      if (await isAssistantAlive()) { alive = true; break; }
    }

    if (!alive) {
      err('起動を確認できませんでした。state/desktop-assistant-error.log を確認してください。');
      lastExit = 1;
      return;
    }
    step(`起動しました: ${AssistantUrl}`);
  }

  openUrl(AssistantUrl);
}

function invokeSlackApp() {
  step('Slack常駐アプリを起動します（終了するには Ctrl+C）。');
  if (rl) { rl.close(); rl = null; }
  runNode(['src/slack-app.js']);
}

function invokeCheck() {
  runNpm(['run', 'check'], ScriptDir);
}

// ---------------------------------------------------------------------
// メニュー
// ---------------------------------------------------------------------
function showMenu() {
  console.log('');
  console.log(color('36', '============================================='));
  console.log(' HD Scraper Automation');
  console.log(color('36', '============================================='));
  console.log(' 1) 初回セットアップ（最初の1回だけ）');
  console.log(' 2) コムデスクにログイン（初回・ログイン切れ時）');
  console.log(' 3) 確認実行（書き込みなし / dry-run）');
  console.log(' 4) 本番実行');
  console.log(' 5) スプレッドシートからコムデスクへ投入（確認）');
  console.log(' 6) スプレッドシートからコムデスクへ投入（本番）');
  console.log(' 7) 複数スプレッドシートを一括投入（確認）');
  console.log(' 8) 複数スプレッドシートを一括投入（本番）');
  console.log(' 9) HD AIアシスタントを開く');
  console.log('10) Slack常駐アプリを起動');
  console.log('11) 設定・構文チェック');
  console.log(' 0) 終了');
  console.log('');
}

async function runMenu() {
  showMenu();
  const choice = await ask('番号を入力してください');
  switch (choice) {
    case '1': invokeSetup(); break;
    case '2': invokeLogin(); break;
    case '3': await invokePipeline('dry'); break;
    case '4': await invokePipeline('run'); break;
    case '5': execute = false; await invokeComdesk(); break;
    case '6': execute = true; await invokeComdesk(); break;
    case '7': execute = false; await invokeBatch(); break;
    case '8': execute = true; await invokeBatch(); break;
    case '9': await invokeAssistant(); break;
    case '10': invokeSlackApp(); break;
    case '11': invokeCheck(); break;
    case '0': step('終了します。'); break;
    default: err('0〜11 の番号を入力してください。'); lastExit = 1;
  }
}

async function runTask(task) {
  switch (task) {
    case 'setup': invokeSetup(); break;
    case 'login': invokeLogin(); break;
    case 'dry': await invokePipeline('dry'); break;
    case 'run': await invokePipeline('run'); break;
    case 'comdesk': await invokeComdesk(); break;
    case 'batch': await invokeBatch(); break;
    case 'merge': await invokeMerge(); break;
    case 'assistant': await invokeAssistant(); break;
    case 'slack': invokeSlackApp(); break;
    case 'check': invokeCheck(); break;
    default: err(`不明なタスクです: ${task}`); lastExit = 1;
  }
}

async function main() {
  process.chdir(ScriptDir);

  if (!assertNode()) {
    lastExit = 1;
  } else if (requestedTask === 'menu') {
    await runMenu();
  } else {
    await runTask(requestedTask);
  }

  console.log('');
  if (lastExit !== 0) {
    err(`処理が失敗しました（終了コード ${lastExit}）。上のメッセージを確認してください。`);
  } else {
    step('処理が完了しました。');
  }

  if (!flags.noPause) {
    console.log('');
    await ask('終了するには Enter キーを押してください');
  }
  if (rl) rl.close();
  process.exit(lastExit);
}

main().catch((error) => {
  err(`予期しないエラーが発生しました: ${error && error.message ? error.message : error}`);
  if (rl) rl.close();
  process.exit(1);
});
