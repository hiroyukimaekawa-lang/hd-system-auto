import { comdeskUrl, launch } from './common.js';

const context = await launch();
const page = context.pages()[0] || await context.newPage();
await page.goto(comdeskUrl(), { waitUntil: 'domcontentloaded' });
console.log('\nコムデスクへログインし、CSVを投入するプロジェクト画面を表示してください。');
console.log('準備ができたら、このターミナルで Enter を押してください。\n');
await new Promise((resolve) => process.stdin.once('data', resolve));
console.log(`保存した画面: ${page.url()}`);
await context.close();
