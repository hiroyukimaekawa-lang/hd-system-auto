import { launch, screenshot } from './common.js';

const projectName = process.argv.find((v) => v.startsWith('--project-name='))?.slice(15);
const workgroup = process.argv.find((v) => v.startsWith('--workgroup='))?.slice(12);
if (!projectName || !workgroup) throw new Error('--project-name と --workgroup が必要です');

const context = await launch();
const page = context.pages()[0] || await context.newPage();
await page.goto('https://crestix-inc.comdesk.com/manage/project', { waitUntil: 'domcontentloaded', timeout: 90_000 });
await page.waitForLoadState('networkidle').catch(() => {});

const label = page.locator('label:visible').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(workgroup)}\\s*$`) }).first();
await label.waitFor({ state: 'visible', timeout: 30_000 });
const checkboxId = await label.getAttribute('for');
await page.locator(`[id="${checkboxId}"]`).check();
await page.waitForTimeout(2_000);
const projectCell = page.getByText(projectName, { exact: true }).first();
await projectCell.waitFor({ state: 'visible', timeout: 30_000 });
const row = projectCell.locator('xpath=ancestor::tr[1]');
const rowCheckbox = row.locator('input[type="checkbox"]').first();
if (await rowCheckbox.count()) await rowCheckbox.check();

const statusButton = page.getByText('インポート状況', { exact: true }).first();
await statusButton.waitFor({ state: 'visible', timeout: 30_000 });
await statusButton.click();
await page.waitForTimeout(2_000);
const bodyText = await page.locator('body').innerText();
const statusStart = bodyText.lastIndexOf('インポート状況');
console.log(JSON.stringify({
  url: page.url(),
  projectId: await rowCheckbox.getAttribute('value'),
  statusText: bodyText.slice(statusStart >= 0 ? statusStart : 0).slice(0, 4000)
}, null, 2));
console.log(`screenshot=${await screenshot(page, `import_status_${workgroup}`)}`);
await context.close();

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
