import { launch, screenshot } from './common.js';

const context = await launch();
const page = context.pages()[0] || await context.newPage();
await page.goto('https://crestix-inc.comdesk.com/manage/project', { waitUntil: 'domcontentloaded', timeout: 90_000 });
await page.locator('button:visible').filter({ hasText: /プロジェクト登録/ }).first().waitFor({ state: 'visible', timeout: 90_000 });
await page.locator('button:visible').filter({ hasText: /プロジェクト登録/ }).first().click();
const accessible = page.locator('select[name="staff_id_accessible[]"]');
await accessible.waitFor({ state: 'visible', timeout: 30_000 });
const structure = await accessible.evaluate((node) => {
  const container = node.closest('tr') || node.parentElement?.parentElement || node.parentElement;
  return {
    select: node.outerHTML,
    container: container?.outerHTML,
    form: node.closest('form')?.outerHTML
  };
});
console.log(JSON.stringify(structure, null, 2).slice(0, 30000));
console.log(`screenshot=${await screenshot(page, 'inspect_assign_users')}`);
await context.close();
