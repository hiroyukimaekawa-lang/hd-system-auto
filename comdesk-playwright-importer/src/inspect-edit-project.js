import { launch, screenshot } from './common.js';

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
await row.locator('input[name="project_id_item[]"]').check();
await page.locator('button:visible').filter({ hasText: /編集/ }).first().click();
const accessible = page.locator('select[name="staff_id_accessible[]"]');
await accessible.waitFor({ state: 'visible', timeout: 30_000 });
console.log(JSON.stringify({
  accessible: await accessible.locator('option').evaluateAll((options) => options.map((option) => ({ value:option.value, text:option.text.trim() }))),
  unaccessible: await page.locator('select[name="staff_id_unaccessible[]"] option').evaluateAll((options) => options.map((option) => ({ value:option.value, text:option.text.trim() }))),
  buttons: await page.locator('button:visible').evaluateAll((buttons) => buttons.map((button) => button.innerText.trim()).filter(Boolean))
}, null, 2));
console.log(`screenshot=${await screenshot(page, `inspect_edit_${workgroup}`)}`);
await context.close();

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
