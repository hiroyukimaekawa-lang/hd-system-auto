#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GasWebAppClient } from '../src/drive.js';
import { loadEnv } from '../src/env.js';
import { listSheetJobs } from '../src/management-sheet.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(root, '.env'));
const publicDir = path.join(root, 'desktop', 'public');
const port = Number(process.env.HD_ASSISTANT_PORT) || 43117;

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 100_000) throw new Error('メッセージが長すぎます'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function help() {
  return { text: '次のように話しかけてください。', cards: [
    { title: '取得対象を確認', body: '茨城県の管理シートから、次に取得する市町村を確認します。', prompt: '茨城県の取得対象を確認して' },
    { title: 'Drive接続確認', body: '土浦市の入力・処理済み・完成CSVフォルダを確認します。', prompt: '土浦市のDrive接続を確認して' },
    { title: '設定状態', body: '秘密情報を表示せず、必要な接続設定だけ確認します。', prompt: '設定を確認して' }
  ] };
}

async function chat(message) {
  const text = String(message || '').trim();
  if (!text || /^(ヘルプ|help|できること)/i.test(text)) return help();
  if (/設定/.test(text)) {
    const checks = [['GAS Webアプリ', process.env.GAS_WEB_APP_URL], ['共有シークレット', process.env.GAS_WEB_APP_SECRET], ['飲食店ルート', process.env.GOOGLE_DRIVE_RESTAURANT_ROOT_FOLDER_ID]];
    return { text: checks.map(([name, value]) => `${value ? '✓' : '×'} ${name}`).join('\n') };
  }
  const client = new GasWebAppClient();
  if (/取得対象|管理シート|hd-list-sheet/.test(text)) {
    const jobs = await listSheetJobs(client, '茨城県', '飲食店');
    if (!jobs.length) return { text: '現在、自動取得対象がTRUEで未完了の市町村はありません。' };
    return { text: `取得対象は${jobs.length}件です。\n${jobs.map(job => `・${job.city}｜${job.genre}｜${job.sources}｜最低${job.minimumCount || 0}件`).join('\n')}`, badge: `${jobs.length}件` };
  }
  const cityMatch = text.match(/([一-龠ぁ-んァ-ヶー]+(?:市|町|村))/);
  if (/Drive|ドライブ|フォルダ/i.test(text) || cityMatch) {
    const city = cityMatch?.[1] || '土浦市';
    const location = await client.resolveLocation(process.env.GOOGLE_DRIVE_RESTAURANT_ROOT_FOLDER_ID, '茨城県', city, false);
    return { text: `${city}の接続は正常です。\n✓ CSV投入フォルダ\n✓ 処理済みフォルダ\n✓ 完成版CSVエクスポート\n✓ ${city}スプレッドシート`, links: [{ label: `${city}フォルダを開く`, url: `https://drive.google.com/drive/folders/${location.cityFolderId}` }] };
  }
  return { text: 'まだその依頼には対応していません。まずは「できること」と入力してください。' };
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/api/health') return json(response, 200, { ok: true });
    if (request.method === 'POST' && request.url === '/api/chat') { const body = await readBody(request); return json(response, 200, { ok: true, ...(await chat(body.message)) }); }
    const pathname = request.url === '/' ? '/index.html' : request.url;
    const file = path.resolve(publicDir, `.${pathname}`);
    if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); return response.end('Not found'); }
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(response);
  } catch (error) {
    const message = /未対応のaction/.test(error.message)
      ? 'GAS Webアプリが更新前の版です。最新の headless-automation.gs を反映して再デプロイすると、この機能を利用できます。'
      : `エラーが発生しました。\n${error.message}`;
    json(response, 500, { ok: false, text: message });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`HD AI Assistant: http://127.0.0.1:${port}`));
