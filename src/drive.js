import fs from 'node:fs';
import path from 'node:path';

export class DriveLocationError extends Error {
  constructor(code, message, candidates = []) { super(message); this.name = 'DriveLocationError'; this.code = code; this.candidates = candidates; }
  toSlackMessage() { return `${this.message}${this.candidates.length ? `\n候補:\n${this.candidates.map(item => `・${item.name} (${item.id})`).join('\n')}` : ''}`; }
}

export class GasWebAppClient {
  constructor({ url = process.env.GAS_WEB_APP_URL, secret = process.env.GAS_WEB_APP_SECRET, fetchImpl = fetch } = {}) {
    if (!url) throw new Error('GAS_WEB_APP_URL が設定されていません');
    if (!secret) throw new Error('GAS_WEB_APP_SECRET が設定されていません');
    this.url = url; this.secret = secret; this.fetch = fetchImpl;
  }
  async request(action, payload = {}) {
    const response = await this.fetch(this.url, { method: 'POST', redirect: 'follow', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, secret: this.secret, ...payload }) });
    if (!response.ok) throw new Error(`GAS Webアプリへの接続に失敗しました (HTTP ${response.status})`);
    const result = await response.json();
    if (!result.ok) {
      if (result.code?.startsWith('location_')) throw new DriveLocationError(result.code.replace('location_', ''), result.error || 'Drive探索に失敗しました', result.candidates || []);
      throw new Error(result.error || 'GAS Webアプリ処理に失敗しました');
    }
    return result.data;
  }
  async resolveLocation(rootId, prefecture, city, refresh = false) { return this.request('resolveLocation', { rootId, prefecture, city, refresh }); }
  async uploadCsv(filePath, location, jobId, remoteName) {
    return this.request('uploadCsv', { location, jobId, name: remoteName || path.basename(filePath), contentBase64: fs.readFileSync(filePath).toString('base64') });
  }
  async findExports(exportFolderId, jobId) { return this.request('findExports', { exportFolderId, jobId }); }
  async download(fileId) { const data = await this.request('downloadFile', { fileId }); return Buffer.from(data.contentBase64, 'base64'); }
}

export async function discoverLocation(client, rootId, prefecture, city) { return client.resolveLocation(rootId, prefecture, city, true); }

export async function resolveLocation(client, { rootId, prefecture, city, refresh = false }) {
  if (!rootId) throw new DriveLocationError('missing_root', '飲食店ルートフォルダIDが設定されていません。');
  if (!prefecture || !city) throw new DriveLocationError('invalid_area', '都道府県または市区町村を特定できないため処理を開始しません。');
  return client.resolveLocation(rootId, prefecture, city, refresh);
}
