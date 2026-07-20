import fs from 'node:fs';
import path from 'node:path';
import { launch, paths, screenshot } from './common.js';

const context = await launch();
const page = context.pages()[0] || await context.newPage();
console.log('CSVインポート画面を開き、Enterを押してください。画面要素を記録します。');
await new Promise((resolve) => process.stdin.once('data', resolve));
const elements = await page.locator('button, input, select, [role=button], [role=combobox], label').evaluateAll((nodes) =>
  nodes.map((node) => ({
    tag: node.tagName,
    type: node.getAttribute('type'),
    role: node.getAttribute('role'),
    name: node.getAttribute('name'),
    placeholder: node.getAttribute('placeholder'),
    ariaLabel: node.getAttribute('aria-label'),
    text: (node.innerText || node.textContent || '').trim().slice(0, 200)
  })).filter((item) => Object.values(item).some(Boolean))
);
const target = path.join(paths.results, 'screen-elements.json');
fs.writeFileSync(target, JSON.stringify({ url: page.url(), elements }, null, 2));
await screenshot(page, 'inspect');
console.log(`記録完了: ${target}`);
await context.close();
