import { launch, loadConfig } from './common.js';
import { assertAssignUsersBeforeSubmit, setAssignUsers } from './assign-users.js';

const projectName = process.argv.find((value) => value.startsWith('--project-name='))?.slice(15);
const workgroups = (process.argv.find((value) => value.startsWith('--workgroups='))?.slice(13) || '')
  .split(',').map((value) => value.trim()).filter(Boolean);
if (!projectName || !workgroups.length) throw new Error('--project-name と --workgroups が必要です');

const config = loadConfig();
const context = await launch();
const page = context.pages()[0] || await context.newPage();
for (const workgroup of workgroups) {
  await gotoProjectPage();
  const label = page.locator('label:visible').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(workgroup)}\\s*$`) }).first();
  await label.waitFor({ state: 'visible', timeout: 30_000 });
  const checkboxId = await label.getAttribute('for');
  await page.locator(`[id="${checkboxId}"]`).check();
  await page.waitForTimeout(2_000);
  const matches = page.getByText(projectName, { exact: true });
  if (await matches.count() === 0) {
    console.log(`未作成のためスキップ: ${projectName} / ${workgroup}`);
    continue;
  }
  if (await matches.count() !== 1) throw new Error(`プロジェクトを一意に特定できません: ${projectName} / ${workgroup}`);
  const row = matches.first().locator('xpath=ancestor::tr[1]');
  await row.locator('input[name="project_id_item[]"]').check();
  await page.locator('button:visible').filter({ hasText: /編集/ }).first().click();
  const projectInput = page.locator('input[name="project_name"]');
  await projectInput.waitFor({ state: 'visible', timeout: 30_000 });
  const users = await setAssignUsers(page, config.assignUsers);
  await assertAssignUsersBeforeSubmit(page, users, config.assignUsers);
  await page.locator('button:visible').filter({ hasText: /プロジェクト編集/ }).last().click();
  await projectInput.waitFor({ state: 'hidden', timeout: 30_000 });
  await gotoProjectPage();
  const verifyLabel = page.locator('label:visible').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(workgroup)}\\s*$`) }).first();
  const verifyId = await verifyLabel.getAttribute('for');
  await page.locator(`[id="${verifyId}"]`).check();
  await page.waitForTimeout(2_000);
  const savedRow = page.getByText(projectName, { exact: true }).first().locator('xpath=ancestor::tr[1]');
  const savedText = (await savedRow.innerText()).replace(/\s+/g, '');
  const missing = users.filter((user) => !savedText.includes(user.replace(/\s+/g, '')));
  if (missing.length) throw new Error(`修復後も保存されていません: ${projectName} / ${workgroup} / ${missing.join('、')}`);
  console.log(`修復完了: ${projectName} / ${workgroup} / ${users.length}人`);
}
await context.close();

async function gotoProjectPage() {
  await page.goto('https://crestix-inc.comdesk.com/manage/project', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.locator('button:visible').filter({ hasText: /プロジェクト登録/ }).first().waitFor({ state: 'visible', timeout: 90_000 });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
