import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const googleAuthDir = path.join(root, '.auth', 'google');

export function spreadsheetIdFromGoogleUrl(value) {
  const match = String(value || '').match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('GoogleスプレッドシートのURLを確認できません');
  return match[1];
}

export async function launchGoogleContext({ headless = false } = {}) {
  fs.mkdirSync(googleAuthDir, { recursive: true });
  const options = {
    headless,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true
  };

  const channel = String(process.env.GOOGLE_BROWSER_CHANNEL || 'chrome').trim();
  if (channel) {
    try {
      return await chromium.launchPersistentContext(googleAuthDir, { ...options, channel });
    } catch (error) {
      if (process.env.GOOGLE_BROWSER_CHANNEL) throw error;
      console.warn('[google-auth] Chrome起動に失敗したためPlaywright Chromiumへフォールバックします。');
    }
  }
  return chromium.launchPersistentContext(googleAuthDir, options);
}

export async function downloadGoogleSpreadsheetAuthenticated(url, destination) {
  const id = spreadsheetIdFromGoogleUrl(url);
  const exportUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
  const context = await launchGoogleContext({ headless: true });
  try {
    const response = await context.request.get(exportUrl, { maxRedirects: 10, timeout: 90_000 });
    const contentType = response.headers()['content-type'] || '';
    const bytes = Buffer.from(await response.body());
    const looksLikeXlsx = bytes.length >= 100 && bytes.subarray(0, 2).toString() === 'PK';
    if (!response.ok() || /text\/html/i.test(contentType) || !looksLikeXlsx) {
      throw new Error('Google認証済みセッションでもスプレッドシートを取得できません。npm run google:login を実行してGoogleへログインしてください');
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
    return { id, bytes: bytes.length, authenticated: true };
  } finally {
    await context.close();
  }
}
