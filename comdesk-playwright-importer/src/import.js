import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import XLSX from 'xlsx';
import { comdeskUrl, ensureDirs, launch, loadConfig, paths, screenshot } from './common.js';
import { isExpectedImportStartedAlert, isExpectedSubmitConfirmation } from './confirmation.js';
import { isReviewCountConsistent, parseReviewCounts } from './review.js';
import { assertAssignUsersBeforeSubmit, setAssignUsers } from './assign-users.js';

const COMDESK_HEADERS = ['UUID','種別','名前','カナ','郵便番号','都道府県','住所１','住所２','住所カナ','Tel1','Tel2','Tel3','Tel4','FAX','URL','備考','旧社名','リードソース','旧進捗','履歴','オーナー名','HPある？','BP検索','アポ済商材','最新履歴','営業曜日','休業曜日','午前始','午前終','午後始','午後終'];

const dryRun = process.argv.includes('--dry-run');
const finalizeOnly = process.argv.includes('--finalize-only');
const completionOnly = process.argv.includes('--completion-only');
const skipWorkgroups = parseListArgument('--skip-workgroups=');
const onlyWorkgroups = parseListArgument('--only-workgroups=');
const inputArgument = valueArgument('--input=');
const projectNameOverride = valueArgument('--project-name=');
const resultFileOverride = valueArgument('--result-file=');
const config = loadConfig();
const timeout = Number(process.env.TIMEOUT_MS || 30000);
ensureDirs();

const inputFiles = (inputArgument ? [path.resolve(inputArgument)] : fs.readdirSync(paths.inbox).map((name) => path.join(paths.inbox, name)))
  .filter((name) => /\.(csv|xlsx)$/i.test(name) && !name.startsWith('~$'))
  .sort();

if (!inputFiles.length) {
  console.log(`CSVまたはExcelがありません: ${paths.inbox}`);
  process.exit(0);
}

const context = dryRun ? null : await launch();
const page = context ? (context.pages()[0] || await context.newPage()) : null;
if (page) {
  page.setDefaultTimeout(timeout);
  await gotoProjectPage(page);
}

const results = [];
const pendingFinalizations = [];
for (const source of inputFiles) {
  const inputName = path.basename(source);
  let jobs = [];
  try {
    jobs = buildJobs(source, inputName);
    if (!jobs.length) throw new Error('登録対象のジャンルシートがありません');
  } catch (error) {
    results.push({ inputName, status: 'failed', error: error.message });
    console.error(`失敗: ${inputName}: ${error.message}`);
    if (!dryRun && !inputArgument) fs.renameSync(source, uniqueTarget(paths.failed, inputName));
    continue;
  }

  let inputSucceeded = true;
  for (const job of jobs) {
    if (skipWorkgroups.has(job.workgroup)) {
      console.log(`スキップ: ${job.sheetName || inputName}（${job.workgroup}は実行時の除外指定）`);
      results.push({ inputName, sheetName: job.sheetName, projectName: job.projectName, workgroup: job.workgroup, status: 'skipped', reason: 'skip-workgroups' });
      continue;
    }
    if (onlyWorkgroups.size && !onlyWorkgroups.has(job.workgroup)) {
      console.log(`スキップ: ${job.sheetName || inputName}（${job.workgroup}は実行対象外）`);
      results.push({ inputName, sheetName: job.sheetName, projectName: job.projectName, workgroup: job.workgroup, status: 'skipped', reason: 'only-workgroups' });
      continue;
    }
    try {
      console.log(`\n処理開始: ${job.projectName} (${job.rows}件 / ${job.workgroup})`);
      if (dryRun) {
        results.push({ inputName, sheetName: job.sheetName, projectName: job.projectName, workgroup: job.workgroup, status: 'dry-run', rows: job.rows });
        continue;
      }
      if (finalizeOnly || completionOnly) {
        const result = { inputName, sheetName: job.sheetName, projectName: job.projectName, workgroup: job.workgroup, status: 'existing', rows: job.rows };
        results.push(result); pendingFinalizations.push({ job, result });
        console.log(`${completionOnly ? '完了通知確認のみ再開' : '承認処理のみ再開'}: ${job.projectName} / ${job.workgroup}`);
        continue;
      }

      await assertProjectWorkgroupDoesNotExist(page, job.projectName, job.workgroup);
      await openProjectModal(page);
      await page.locator('input[name="project_name"]').fill(job.projectName);
      await page.locator('select[name="client_id"]').selectOption({ label: job.workgroup });
      await page.locator('input[name="data_file"]').setInputFiles(job.csvPath);

      const remarks = page.locator('[name="remarks"]');
      if (config.remarks && await remarks.count()) await remarks.fill(config.remarks);
      await setDuplicateCheck(page, config.duplicateCheck);
      // Duplicate-check controls can re-render parts of the modal. Select users
      // last so Comdesk receives the complete multi-select state on submit.
      const assignedUsers = await setAssignUsers(page, config.assignUsers);
      await assertAssignUsersBeforeSubmit(page, assignedUsers, config.assignUsers);
      console.log(`重複チェック: ${config.duplicateCheck?.type || '電話番号'} / ${config.duplicateCheck?.scope || 'テナント全体'}`);

      const projectInput = page.locator('input[name="project_name"]');
      await page.locator('button').filter({ hasText: /^プロジェクト登録$/ }).last().click();
      await projectInput.waitFor({ state: 'hidden', timeout });
      await verifySavedAssignUsers(page, job.projectName, job.workgroup, assignedUsers);

      const result = { inputName, sheetName: job.sheetName, projectName: job.projectName, workgroup: job.workgroup, assignedUsers, status: 'success', rows: job.rows, completedAt: new Date().toISOString() };
      results.push(result);
      if (config.finalizeImport?.enabled !== false) pendingFinalizations.push({ job, result });
      console.log(`プロジェクト登録成功: ${job.projectName} / ${job.workgroup} (${job.rows}件)`);
      await page.waitForTimeout(800);
    } catch (error) {
      inputSucceeded = false;
      const image = page ? await screenshot(page, `failed_${safeName(job.projectName)}`).catch(() => null) : null;
      results.push({ inputName, sheetName: job.sheetName, projectName: job.projectName, status: 'failed', error: error.message, screenshot: image, failedAt: new Date().toISOString() });
      console.error(`失敗: ${job.projectName}: ${error.message}`);
      if (page) await resetPage(page);
    }
  }

  if (!dryRun && !finalizeOnly && !completionOnly && !inputArgument && fs.existsSync(source)) {
    fs.renameSync(source, uniqueTarget(inputSucceeded ? paths.success : paths.failed, inputName));
  }
}

if (!dryRun && pendingFinalizations.length) {
  console.log(`\nインポート実行待ち: ${pendingFinalizations.length}件`);
  for (const item of pendingFinalizations) {
    try {
      const finalized = completionOnly
        ? await confirmCompletionOnly(page, item.job, config.finalizeImport)
        : await finalizeImport(page, item.job, config.finalizeImport);
      Object.assign(item.result, finalized, { importStatus: 'completed' });
      console.log(`インポート完了: ${item.job.projectName} / ${item.job.workgroup}`);
    } catch (error) {
      item.result.importStatus = 'failed';
      item.result.importError = error.message;
      item.result.importScreenshot = await screenshot(page, `finalize_failed_${safeName(item.job.projectName)}_${safeName(item.job.workgroup)}`).catch(() => null);
      console.error(`インポート実行失敗: ${item.job.projectName} / ${item.job.workgroup}: ${error.message}`);
      await resetPage(page);
      break;
    }
  }
}

const report = resultFileOverride ? path.resolve(resultFileOverride) : path.join(paths.results, `result_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.mkdirSync(path.dirname(report), { recursive: true });
fs.writeFileSync(report, JSON.stringify(results, null, 2));
console.log(`\n処理結果: ${report}`);
if (context) await context.close();
if (results.some((result) => result.status === 'failed' || result.importStatus === 'failed')) process.exitCode = 1;

function buildJobs(source, inputName) {
  if (/\.csv$/i.test(inputName)) {
    const csv = fs.readFileSync(source, 'utf8').replace(/^\uFEFF/, '');
    validateCsv(csv);
    const rows = countRows(csv);
    const originalName = path.basename(inputName, path.extname(inputName));
    const workgroup = detectWorkgroup(originalName, config.workgroupAliases);
    if (!workgroup) throw new Error(`ファイル名からワークグループを判定できません: ${originalName}`);
    const area = extractArea(originalName, workgroup, config.workgroupAliases);
    const projectName = buildProjectName(area);
    return [{ sheetName: null, projectName, workgroup, rows, csvPath: source }];
  }

  const workbook = XLSX.readFile(source, { cellDates: true });
  const area = path.basename(inputName, path.extname(inputName)).replace(/\s*\(\d+\)$/, '').trim();
  const jobs = [];
  for (const sheetName of workbook.SheetNames) {
    const workgroup = detectWorkgroup(sheetName, config.workgroupAliases);
    if (!workgroup) {
      console.log(`スキップ: ${sheetName}（ジャンル対象外）`);
      continue;
    }
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
    const rows = countRows(csv);
    if (!rows) {
      console.log(`スキップ: ${sheetName}（データ0件）`);
      continue;
    }
    const projectName = buildProjectName(area);
    const csvPath = path.join(paths.work, `${safeName(projectName)}_${jobs.length}.csv`);
    fs.writeFileSync(csvPath, `\uFEFF${csv}`, 'utf8');
    jobs.push({ sheetName, projectName, workgroup, rows, csvPath });
  }
  return jobs;
}

function buildProjectName(area) {
  if (projectNameOverride) return projectNameOverride;
  const template = config.projectNameTemplate || '{area}';
  return `${config.listNamePrefix || ''}${template.replaceAll('{area}', area)}`;
}

function extractArea(fileName, workgroup, aliases) {
  let area = fileName.replace(/^04_SALES_/i, '');
  const matchedAliases = (aliases[workgroup] || [])
    .filter((word) => area.toLowerCase().includes(word.toLowerCase()))
    .sort((a, b) => b.length - a.length);
  for (const word of matchedAliases) {
    area = area.replace(new RegExp(escapeRegExp(word), 'ig'), '');
  }
  area = area.replace(/^[_\-\s]+|[_\-\s]+$/g, '').replace(/[_\-\s]{2,}/g, '_');
  if (!area) throw new Error(`ファイル名からエリアを判定できません: ${fileName}`);
  return area;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countRows(csv) {
  const rows = parse(csv.replace(/^\uFEFF/, ''), { columns: true, skip_empty_lines: true, relax_column_count: true });
  if (!rows.length) throw new Error('データ行がありません');
  return rows.length;
}

function validateCsv(csv) {
  const parsed = parse(csv.replace(/^\uFEFF/, ''), { skip_empty_lines: true, relax_column_count: false });
  const header = parsed[0] || [];
  if (header.length !== COMDESK_HEADERS.length || header.some((value, index) => value !== COMDESK_HEADERS[index])) {
    throw new Error(`CSVヘッダーがコムデスク31列仕様と一致しません（実際${header.length}列）`);
  }
  const telIndex = COMDESK_HEADERS.indexOf('Tel1'); const seen = new Set();
  for (const [index, row] of parsed.slice(1).entries()) {
    const phone = String(row[telIndex] || '');
    if (!/^0\d{9,10}$/.test(phone)) throw new Error(`${index + 2}行目の電話番号形式が不正です`);
    if (seen.has(phone)) throw new Error(`${index + 2}行目の電話番号がCSV内で重複しています`);
    seen.add(phone);
  }
}

async function openProjectModal(page) {
  const input = page.locator('input[name="project_name"]');
  if (await input.isVisible().catch(() => false)) return;
  const openButton = page.locator('button:visible').filter({ hasText: /プロジェクト登録/ }).first();
  await openButton.waitFor({ state: 'visible', timeout: 90000 });
  await openButton.click();
  await input.waitFor({ state: 'visible' });
}

async function assertProjectWorkgroupDoesNotExist(page, projectName, workgroup) {
  const search = page.locator('input[type="search"]:visible, input[placeholder*="検索"]:visible').first();
  if (await search.count() && await search.isVisible().catch(() => false)) {
    await search.fill(projectName); await page.waitForTimeout(800);
  }
  const rows = page.locator('tr');
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const text = (await rows.nth(index).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (text.includes(projectName) && text.includes(workgroup)) {
      throw new Error(`同じプロジェクト・ワークグループが既に存在するため停止しました: ${projectName} / ${workgroup}`);
    }
  }
  if (await search.count() && await search.isVisible().catch(() => false)) {
    await search.fill(''); await page.waitForTimeout(500);
  }
}

async function gotoProjectPage(page) {
  await page.goto('https://crestix-inc.comdesk.com/manage/project', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitForPageReady(page, 90_000);
  const safetyText = `${await page.title().catch(() => '')} ${await page.locator('body').innerText().catch(() => '')}`;
  if (/captcha|robot|アクセス制限|sign\s*in/i.test(safetyText) || (/ログイン/.test(safetyText) && !/プロジェクト登録/.test(safetyText))) {
    throw new Error('CAPTCHA、アクセス制限、またはログイン切れを検知したため停止しました');
  }
  await page.locator('button:visible').filter({ hasText: /プロジェクト登録/ }).first()
    .waitFor({ state: 'visible', timeout: 90000 });
}

async function setDuplicateCheck(page, settings = {}) {
  const enabled = page.locator('input[name="enable_dupli_check"]');
  if (settings.enabled === false) {
    await enabled.uncheck();
    return;
  }
  await enabled.check();
  const typeNames = { '名前': 'dupli_type_1', '電話番号': 'dupli_type_2', '名前または電話番号': 'dupli_type_3' };
  const scopeNames = { 'テナント全体': 'dupli_scope_1', '同一のワークグループのみ': 'dupli_scope_0' };
  const type = typeNames[settings.type || '電話番号'];
  const scope = scopeNames[settings.scope || 'テナント全体'];
  if (!type) throw new Error(`重複チェック対象の設定が不正です: ${settings.type}`);
  if (!scope) throw new Error(`重複チェック範囲の設定が不正です: ${settings.scope}`);
  await page.locator(`input[name="${type}"]`).check();
  await page.locator(`input[name="${scope}"]`).check();
}

async function verifySavedAssignUsers(page, projectName, workgroup, expectedUsers) {
  await gotoProjectPage(page);
  const label = page.locator('label:visible').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(workgroup)}\\s*$`) }).first();
  await label.waitFor({ state: 'visible', timeout: 30_000 });
  const checkboxId = await label.getAttribute('for');
  if (!checkboxId || !/^[A-Za-z0-9_-]+$/.test(checkboxId)) throw new Error(`ワークグループ選択欄を安全に特定できません: ${workgroup}`);
  const checkbox = page.locator(`[id="${checkboxId}"]`);
  await checkbox.check();
  await page.waitForTimeout(2_000);
  await waitForPageReady(page, 30_000);
  const matches = page.getByText(projectName, { exact: true });
  if (await matches.count() !== 1) throw new Error(`登録後のプロジェクトを一意に確認できません: ${projectName} / ${workgroup}`);
  const rowText = await matches.first().locator('xpath=ancestor::tr[1]').innerText();
  const normalize = (value) => String(value || '').replace(/\s+/g, '');
  const normalizedRow = normalize(rowText);
  const missing = expectedUsers.filter((name) => !normalizedRow.includes(normalize(name)));
  await checkbox.uncheck().catch(() => {});
  if (missing.length) throw new Error(`登録後にアクセス可能ユーザーが保存されていません: ${missing.join('、')}`);
  console.log(`登録後ユーザー確認: ${expectedUsers.length}人`);
}

function detectWorkgroup(name, aliases) {
  const candidates = Object.entries(aliases)
    .flatMap(([workgroup, words]) => words.map((word) => ({ workgroup, word })))
    .sort((a, b) => b.word.length - a.word.length);
  return candidates.find(({ word }) => name.toLowerCase().includes(word.toLowerCase()))?.workgroup || null;
}

async function resetPage(page) {
  await gotoProjectPage(page).catch(() => {});
}

function uniqueTarget(directory, fileName) {
  const initial = path.join(directory, fileName);
  if (!fs.existsSync(initial)) return initial;
  const ext = path.extname(fileName);
  return path.join(directory, `${path.basename(fileName, ext)}_${Date.now()}${ext}`);
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9ぁ-んァ-ヶ一-龠_-]/g, '_').slice(0, 100);
}

function parseListArgument(prefix) {
  const argument = process.argv.find((value) => value.startsWith(prefix));
  if (!argument) return new Set();
  return new Set(argument.slice(prefix.length).split(',').map((value) => value.trim()).filter(Boolean));
}

function valueArgument(prefix) {
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
}

async function finalizeImport(page, job, settings = {}) {
  const maxWaitMs = Number(settings.maxWaitMinutes || 15) * 60_000;
  const pollMs = Number(settings.pollSeconds || 20) * 1_000;
  const listedProjectId = await resolveListedProjectId(page, job.projectName, job.workgroup);
  const precheck = await waitForNotification(page, {
    projectName: job.projectName,
    workgroup: job.workgroup,
    phrase: '顧客インポート前の重複チェック処理を完了しました',
    maxWaitMs,
    pollMs
  });
  const notificationText = await precheck.innerText();
  const projectId = notificationText.match(/プロジェクト:\s*\[?(\d+)\]?/)?.[1] || null;
  if (!projectId || projectId !== listedProjectId) throw new Error(`通知とプロジェクト一覧のIDが一致しません: 通知=${projectId || '不明'} 一覧=${listedProjectId}`);
  await precheck.click();
  await waitForPageReady(page, 90_000);
  try {
    await waitForImportReview(page, job, projectId);
  } catch (error) {
    // Comdeskの通知リンクは、一度開いた後にプロジェクト一覧へ戻ることがある。
    // 一覧と通知のIDが一致済みの場合だけ、同じIDの確認画面へ直接戻る。
    if (!String(error.message).startsWith('通知を開きましたが重複確認画面を確認できません:')) throw error;
    console.log(`既読通知から確認画面へ直接再開: ${job.projectName} / ${job.workgroup} / ID=${projectId}`);
    await page.goto(`${comdeskUrl()}/manage/project/${projectId}/check_import`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await waitForPageReady(page, 90_000);
    await waitForImportReview(page, job, projectId);
  }
  const { newRows, duplicates, blocked } = await waitForReviewCounts(page, job.rows);
  await applyDuplicateDecisions(page, { newRows, duplicates, blocked });
  const submit = page.locator('input[type="submit"]:visible').first();
  await submit.waitFor({ state: 'visible', timeout: 30_000 });
  const confirmation = { accepted: false, messages: [], message: '', startedAlertAccepted: false, startedAlertMessage: '' };
  await Promise.all([
    page.waitForEvent('dialog', { timeout: 30_000 }).then(async (dialog) => {
      let current = dialog;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const message = current.message().replace(/\s+/g, ' ').trim();
        if (isExpectedImportStartedAlert(current.type(), message)) {
          confirmation.startedAlertMessage = message;
          await current.accept();
          confirmation.startedAlertAccepted = true;
          return;
        }
        if (!isExpectedSubmitConfirmation(current.type(), message) || confirmation.messages.length >= 3) {
          await current.dismiss();
          const label = confirmation.accepted ? 'インポート開始' : '確認';
          throw new Error(`想定外の${label}ダイアログのため停止しました: ${message || current.type()}`);
        }
        confirmation.messages.push(message);
        confirmation.message = message;
        const nextDialog = page.waitForEvent('dialog', { timeout: 30_000 });
        await current.accept();
        confirmation.accepted = true;
        current = await nextDialog;
      }
      throw new Error('インポート開始ダイアログを確認できなかったため停止しました');
    }),
    submit.click()
  ]);
  if (!confirmation.accepted) throw new Error('送信確認ダイアログのOKを確認できなかったため停止しました');
  if (!confirmation.startedAlertAccepted) throw new Error('インポート開始ダイアログのOKを確認できなかったため停止しました');
  await page.waitForURL(/\/manage\/project(?:$|\?)/, { timeout: 90_000 }).catch(() => {});
  const initialProcessingWaitMs = Number(settings.initialProcessingWaitSeconds ?? 90) * 1_000;
  if (initialProcessingWaitMs > 0) {
    console.log(`インポート処理開始後の待機: ${Math.round(initialProcessingWaitMs / 1_000)}秒`);
    await page.waitForTimeout(initialProcessingWaitMs);
  }

  const completion = await waitForNotification(page, {
    projectName: job.projectName,
    workgroup: job.workgroup,
    projectId,
    phrase: '顧客インポート処理を完了しました',
    maxWaitMs,
    pollMs
  });
  return { projectId, newRows, duplicates, blocked, confirmationMessage: confirmation.message, confirmationMessages: confirmation.messages, startedAlertMessage: confirmation.startedAlertMessage, importCompletedAt: new Date().toISOString(), completionNotification: (await completion.innerText()).trim() };
}

async function confirmCompletionOnly(page, job, settings = {}) {
  const maxWaitMs = Number(settings.maxWaitMinutes || 15) * 60_000;
  const pollMs = Number(settings.pollSeconds || 20) * 1_000;
  const projectId = await resolveListedProjectId(page, job.projectName, job.workgroup);
  const completion = await waitForNotification(page, {
    projectName: job.projectName, workgroup: job.workgroup, projectId,
    phrase: '顧客インポート処理を完了しました', maxWaitMs, pollMs
  });
  return { projectId, importCompletedAt: new Date().toISOString(), completionNotification: (await completion.innerText()).trim() };
}

async function waitForReviewCounts(page, expectedRows) {
  const deadline = Date.now() + 90_000; let last = { newRows:0, duplicates:0, blocked:0 };
  while (Date.now() < deadline) {
    await waitForPageReady(page, 30_000).catch(() => {});
    const bodyText = await page.locator('body').innerText().catch(() => '');
    last = parseReviewCounts(bodyText);
    const total = last.newRows + last.duplicates + last.blocked;
    if (isReviewCountConsistent(expectedRows, last)) return last;
    if (total > 0) {
      await page.waitForTimeout(2_000);
      const confirmed = parseReviewCounts(await page.locator('body').innerText().catch(() => ''));
      if (!isReviewCountConsistent(expectedRows, confirmed)) {
        throw new Error(`件数不一致のため送信を停止しました: 投入=${expectedRows} 新規=${confirmed.newRows} 重複=${confirmed.duplicates} 禁止番号=${confirmed.blocked}`);
      }
      return confirmed;
    }
    await page.waitForTimeout(2_000);
  }
  throw new Error(`重複確認画面の件数を90秒以内に取得できません: 投入=${expectedRows} 新規=${last.newRows} 重複=${last.duplicates} 禁止番号=${last.blocked}`);
}

async function waitForImportReview(page, job, projectId) {
  const newCount = page.getByText(/新規件数\s*[:：]?\s*\d+件/).first();
  const submit = page.locator('input[type="submit"]:visible')
    .or(page.locator('button:visible').filter({ hasText: /送信/ })).first();
  await newCount.waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {
    throw new Error(`通知を開きましたが重複確認画面を確認できません: ${job.projectName} / ${job.workgroup} / ID=${projectId}`);
  });
  await submit.waitFor({ state: 'visible', timeout: 30_000 });
  const bodyText = await page.locator('body').innerText();
  const bodyIdentifiesTarget = bodyText.includes(job.projectName) && bodyText.includes(job.workgroup);
  const isImportReviewUrl = /\/manage\/project\/\d+\/check_import(?:$|\?)/.test(page.url());
  if (!bodyIdentifiesTarget && !isImportReviewUrl) {
    throw new Error(`重複確認画面の対象が一致しません: ${job.projectName} / ${job.workgroup} / ID=${projectId}`);
  }
}

async function resolveListedProjectId(page, projectName, workgroup) {
  await gotoProjectPage(page);
  const exactWorkgroup = new RegExp(`^\\s*${escapeRegExp(workgroup)}\\s*$`);
  const label = page.locator('label:visible').filter({ hasText: exactWorkgroup }).first();
  await label.waitFor({ state: 'visible', timeout: 30_000 });
  const checkboxId = await label.getAttribute('for');
  if (!checkboxId) throw new Error(`ワークグループ選択欄が見つかりません: ${workgroup}`);
  if (!/^[A-Za-z0-9_-]+$/.test(checkboxId)) throw new Error(`安全でないワークグループ選択欄IDを検知しました: ${checkboxId}`);
  const checkbox = page.locator(`[id="${checkboxId}"]`);
  await checkbox.check(); await page.waitForTimeout(2_000); await waitForPageReady(page, 30_000);
  const matches = page.getByText(projectName, { exact: true });
  if (await matches.count() !== 1) throw new Error(`プロジェクト一覧で対象を一意に特定できません: ${projectName} / ${workgroup}`);
  const row = matches.first().locator('xpath=ancestor::tr[1]');
  const projectId = await row.locator('input[name="project_id_item[]"]').getAttribute('value');
  if (!projectId) throw new Error(`プロジェクト一覧IDを取得できません: ${projectName} / ${workgroup}`);
  await checkbox.uncheck().catch(() => {});
  return projectId;
}

async function applyDuplicateDecisions(page, { newRows, duplicates, blocked }) {
  const outcome = await page.evaluate(({ newRows, duplicates, blocked }) => {
    const compact = (value) => String(value || '').replace(/\s+/g, '');
    const choose = (container, label) => {
      const select = container.querySelector('select');
      if (select) {
        const option = [...select.options].find((item) => compact(item.text).includes(label));
        if (!option) return false;
        select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); return true;
      }
      const target = [...container.querySelectorAll('label')].find((item) => compact(item.textContent).includes(label));
      const input = target?.querySelector('input') || (target?.htmlFor && document.getElementById(target.htmlFor));
      if (!input) return false; input.click(); return true;
    };
    let newApplied = true; let duplicateApplied = duplicates === 0; let blockedApplied = blocked === 0;
    for (const container of document.querySelectorAll('tr, fieldset, .row, [class*="item"]')) {
      const text = compact(container.textContent);
      if (!duplicateApplied && /重複/.test(text) && choose(container, '除外')) duplicateApplied = true;
      if (!blockedApplied && /禁止番号/.test(text) && choose(container, '除外')) blockedApplied = true;
    }
    const visibleDecisionControls = [...document.querySelectorAll('select, input[type="radio"], input[type="checkbox"]')].filter((element) => {
      const style = getComputedStyle(element); const box = element.getBoundingClientRect();
      return !element.disabled && style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    });
    const pageText = compact(document.body.innerText);
    const implicitMode = visibleDecisionControls.length === 0;
    if (implicitMode && duplicates > 0 && pageText.includes(`重複(${duplicates}件)`)) duplicateApplied = true;
    if (implicitMode && blocked > 0 && pageText.includes(`禁止番号(${blocked}件)`)) blockedApplied = true;
    return { newApplied, duplicateApplied, blockedApplied, implicitMode, visibleDecisionControls: visibleDecisionControls.length };
  }, { newRows, duplicates, blocked });
  if (!outcome.newApplied || !outcome.duplicateApplied || !outcome.blockedApplied) throw new Error('新規=追加／重複・禁止番号=除外を画面上で安全に確認できないため送信を停止しました');
  console.log(outcome.implicitMode
    ? `選択欄なしの固定処理を確認: 新規${newRows}件を追加 / 重複${duplicates}件・禁止番号${blocked}件を除外`
    : `選択状態を確認: 新規${newRows}件を追加 / 重複${duplicates}件・禁止番号${blocked}件を除外`);
}

async function waitForNotification(page, { projectName, workgroup, projectId, phrase, maxWaitMs, pollMs }) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await gotoProjectPage(page);
    await openNotifications(page).catch(() => {});
    const candidates = page.getByText(phrase, { exact: false });
    const count = await candidates.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (!await candidate.isVisible().catch(() => false)) continue;
      const text = await notificationItemText(candidate);
      if (!text.includes(phrase)) continue;
      if (!text.includes(projectName) || !text.includes(`ワークグループ:${workgroup}`)) continue;
      if (projectId && !text.includes(`[${projectId}]`)) continue;
      await waitForPageReady(page, 30_000);
      const row = candidate.locator('xpath=ancestor-or-self::*[self::li or @role="listitem" or contains(concat(" ", normalize-space(@class), " "), " q-item ")][1]');
      return await row.count() ? row.first() : candidate;
    }
    console.log(`通知待機中: ${projectName} / ${workgroup}（${phrase}）`);
    await page.waitForTimeout(pollMs);
  }
  throw new Error(`通知が制限時間内に見つかりません: ${phrase}`);
}

async function openNotifications(page) {
  const phrase = page.getByText('顧客インポート', { exact: false }).first();
  if (await phrase.isVisible().catch(() => false)) return;
  await waitForPageReady(page, 30_000);
  const selectors = [
    '[aria-label*="通知"]', '[title*="通知"]',
    'i.material-icons:text-is("notifications_none")', 'i.material-icons:text-is("notifications")',
    '.q-icon:text-is("notifications_none")', '.q-icon:text-is("notifications")',
    '.fa-bell', '.fa-bell-o', '[class*="bell"]'
  ];
  for (const selector of selectors) {
    const icon = page.locator(`${selector}:visible`).last();
    if (await icon.count() && await icon.isVisible().catch(() => false)) {
      await icon.click({ timeout: 10_000 });
      await page.waitForTimeout(500);
      if (await page.getByText('顧客インポート', { exact: false }).first().isVisible().catch(() => false)) return;
    }
  }
  const viewport = page.viewportSize();
  if (viewport) await page.mouse.click(viewport.width - 28, 32);
  await page.getByText('顧客インポート', { exact: false }).first().waitFor({ state: 'visible', timeout: 5_000 });
}

async function waitForPageReady(page, timeout) {
  const loader = page.locator('#loader:visible, .q-inner-loading:visible, .q-spinner:visible');
  await loader.first().waitFor({ state: 'hidden', timeout }).catch(async () => {
    if (await loader.count()) throw new Error('画面の読み込みが完了しないため自動送信を停止しました');
  });
}

async function notificationItemText(candidate) {
  return candidate.evaluate((element) => {
    const item = element.closest('li, [role="listitem"], .q-item, [class*="notification-item"]') || element;
    return (item.innerText || element.innerText || '').replace(/\s+/g, ' ').trim();
  }).catch(() => '');
}
