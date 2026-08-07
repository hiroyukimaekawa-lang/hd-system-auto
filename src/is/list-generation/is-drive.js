import fs from 'node:fs';
import path from 'node:path';

// IS リスト生成専用のDrive操作。既存FS/レガシー飲食店フローのroot/都道府県/市区町村構造とは異なり、
// ルート直下に市区町村フォルダが直接ぶら下がる構造（要件書 4章）を前提にする。
// GasWebAppClient（src/drive.js）はそのまま再利用し、IS専用のactionだけをここで呼び出す。

export async function listAreaFolders(client, rootId) {
  if (!rootId) throw new Error('IS Drive rootFolderIdが設定されていません（config/is/list-generation）');
  return client.request('listIsAreaFolders', { rootId });
}

export async function resolveArea(client, { rootId, areaFolderId }) {
  if (!rootId) throw new Error('IS Drive rootFolderIdが設定されていません（config/is/list-generation）');
  if (!areaFolderId) throw new Error('areaFolderIdが指定されていません');
  return client.request('resolveIsArea', { rootId, areaFolderId });
}

export async function uploadExportCsv(client, { exportFolderId, jobId, filePath, remoteName }) {
  if (!exportFolderId) throw new Error('exportFolderIdが指定されていません');
  if (!fs.existsSync(filePath)) throw new Error(`アップロード対象CSVがありません: ${filePath}`);
  return client.request('uploadIsExportCsv', {
    exportFolderId, jobId, name: remoteName || path.basename(filePath),
    contentBase64: fs.readFileSync(filePath).toString('base64')
  });
}
