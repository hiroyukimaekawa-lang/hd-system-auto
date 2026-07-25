import { launch } from './common.js';

const projectName = process.argv.find((value) => value.startsWith('--project-name='))?.slice(15);
const workgroup = process.argv.find((value) => value.startsWith('--workgroup='))?.slice(12);
if (!projectName || !workgroup) throw new Error('--project-name と --workgroup が必要です');
const context = await launch();
const page = context.pages()[0] || await context.newPage();
await page.goto('https://crestix-inc.comdesk.com/manage/project', { waitUntil: 'domcontentloaded', timeout: 90_000 });
const label = page.locator('label:visible').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(workgroup)}\\s*$`) }).first();
await label.waitFor({ state: 'visible', timeout: 90_000 });
const checkboxId = await label.getAttribute('for');
await page.locator(`[id="${checkboxId}"]`).check();
await page.waitForTimeout(2_000);
const cell = page.getByText(projectName, { exact: true }).first();
await cell.waitFor({ state: 'visible', timeout: 30_000 });
const row = cell.locator('xpath=ancestor::tr[1]');
const projectId = await row.locator('input[name="project_id_item[]"]').getAttribute('value');
await row.locator('input[name="project_id_item[]"]').check();
await page.getByText('インポート状況', { exact: true }).first().click();
await page.waitForTimeout(2_000);
const bodyText = await page.locator('body').innerText();
const statusStart = bodyText.lastIndexOf('インポート状況');
console.log(JSON.stringify({ projectId, statusText: bodyText.slice(statusStart >= 0 ? statusStart : 0).slice(0, 5000) }, null, 2));
await context.close();

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
