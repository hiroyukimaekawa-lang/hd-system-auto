#!/usr/bin/env node
// 商談資料の初期登録。実URLを含むJSONはGit管理外（config/private/）に置く。
// 使い方: npm run fs:materials:import -- --file=config/private/fs-sales-materials.local.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalSqliteSalesMaterialRepository } from '../src/repositories/sqlite-sales-material-repository.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argument = name => process.argv.slice(2).find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const file = path.resolve(root, argument('file') || 'config/private/fs-sales-materials.local.json');
const database = path.resolve(root, argument('db') || 'state/sales-assist.sqlite');

if (!fs.existsSync(file)) {
  console.error(`資料ファイルが見つかりません：${path.relative(root, file)}`);
  console.error('config/private/fs-sales-materials.local.json へ実データを置いてから実行してください。');
  process.exit(1);
}

const source = JSON.parse(fs.readFileSync(file, 'utf8'));
const materials = Array.isArray(source) ? source : source.materials || [];
const repository = new LocalSqliteSalesMaterialRepository(database);
try {
  const result = repository.importAll(materials, { actor:argument('actor') || 'import-cli' });
  // URLはログへ出さない（アフィリエイト情報の漏えい防止）
  console.log(`取り込み完了：${result.imported}件 / 対象${materials.length}件`);
  for (const item of repository.list({ viewer:'admin' })) console.log(`  ${item.active ? '有効' : '停止'}｜${item.id}｜${item.title}`);
  if (result.errors.length) {
    console.error(`取り込めなかった資料：${result.errors.length}件`);
    for (const message of result.errors) console.error(`  - ${message}`);
    process.exit(1);
  }
} finally {
  repository.close();
}
