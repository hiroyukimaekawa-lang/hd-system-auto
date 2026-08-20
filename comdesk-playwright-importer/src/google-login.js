import { launchGoogleContext } from './google-auth.js';

const context = await launchGoogleContext({ headless: false });
const page = context.pages()[0] || await context.newPage();
await page.goto('https://drive.google.com/drive/my-drive', { waitUntil: 'domcontentloaded', timeout: 90_000 });
console.log('\nGoogle Driveへログインしてください。');
console.log('ログイン後、Google Driveが開いた状態でこのターミナルに戻り、Enterを押してください。');
console.log('このログイン状態はCOMDESK用とは別に保存され、非公開スプレッドシート取得に使用されます。\n');
await new Promise((resolve) => process.stdin.once('data', resolve));
console.log(`Google認証状態を保存しました: ${page.url()}`);
await context.close();
