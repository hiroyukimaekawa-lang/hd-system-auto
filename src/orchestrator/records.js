import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, sanitize, writeCsv } from '../output.js';
import { normalizeGenre } from '../genres.js';
import { normalizeAddress } from '../scraper-utils.js';

const CHAIN_WORDS = /(株式会社|有限会社).*(本部|本社)|イオン|イトーヨーカドー|ドン・キホーテ|スターバックス|マクドナルド|すき家|吉野家|ガスト|サイゼリヤ|コメダ珈琲|セブン-?イレブン|ローソン|ファミリーマート/i;
const BUILDING_WORDS = /(ビル|マンション|商業施設|ショッピング(?:センター|モール)|管理会社|不動産管理)/;
const CLOSED_WORDS = /(閉業|閉店|廃業|営業終了)/;

export function normalizePhone(value) {
  let digits = String(value || '').normalize('NFKC').replace(/[^0-9+]/g, '');
  if (digits.startsWith('+81')) digits = `0${digits.slice(3)}`;
  return digits.replace(/\D/g, '');
}

export function normalizeRecords(sourceRows, fallbackGenre) {
  return sourceRows.map(({ source, row }) => {
    const phone = normalizePhone(row['電話番号']);
    const genre = normalizeGenre(row['取得元ジャンル'] || row['ジャンル'], row['店名'], row['ジャンル'] || fallbackGenre);
    return {
      name: String(row['店名'] || '').trim(), genre, prefecture: String(row['都道府県'] || '').trim(),
      area: String(row['市区町村'] || '').trim(), address: normalizeAddress(row['住所']), phone,
      website: row['HP有無'] || '', source, sourceUrl: row['取得元URL'] || row['URL'] || '', raw: row
    };
  });
}

export function mergeDuplicates(records) {
  const merged = new Map();
  for (const record of records) {
    const key = record.phone || `${record.name.normalize('NFKC').replace(/\s+/g, '')}|${record.address.replace(/\s+/g, '')}`;
    const current = merged.get(key);
    if (!current) merged.set(key, { ...record, sources: [record.source], sourceUrls: [record.sourceUrl] });
    else {
      current.sources = [...new Set([...current.sources, record.source])];
      current.sourceUrls = [...new Set([...current.sourceUrls, record.sourceUrl].filter(Boolean))];
      for (const field of ['genre', 'prefecture', 'area', 'address', 'phone', 'website']) if (!current[field] && record[field]) current[field] = record[field];
    }
  }
  return [...merged.values()];
}

export function classifyRecords(records) {
  return records.map((record) => {
    const text = `${record.name} ${record.address} ${record.raw?.['取得元ジャンル'] || ''}`;
    let bucket = 'target'; let reason = '';
    if (CLOSED_WORDS.test(text)) { bucket = 'excluded'; reason = '閉業店舗'; }
    else if (CHAIN_WORDS.test(text)) { bucket = 'excluded'; reason = 'チェーン店または本部'; }
    else if (BUILDING_WORDS.test(text)) { bucket = 'excluded'; reason = 'ビル管理または大型商業施設'; }
    else if (!record.name || !record.address) { bucket = 'failed'; reason = '必須項目の取得失敗'; }
    else if (!record.phone) { bucket = 'review'; reason = '電話番号なし'; }
    return { ...record, bucket, reason };
  });
}

const COMDESK_HEADERS = ['店名', '電話番号', '住所', 'ジャンル', '媒体', '取得元URL'];
export function writeClassifiedOutputs(outputDir, records) {
  ensureDir(outputDir);
  fs.writeFileSync(path.join(outputDir, 'normalized.json'), JSON.stringify(records, null, 2));
  const summary = { total: records.length, target: 0, review: 0, excluded: 0, failed: 0, genres: {} };
  for (const record of records) summary[record.bucket] += 1;
  for (const bucket of ['target', 'review', 'excluded', 'failed']) {
    const rows = records.filter((r) => r.bucket === bucket).map(toCsvRow);
    writeCsv(path.join(outputDir, `${bucket}.csv`), rows, COMDESK_HEADERS);
  }
  const targetByGenre = new Map();
  for (const record of records.filter((r) => r.bucket === 'target')) {
    const genre = record.genre || '未分類'; targetByGenre.set(genre, [...(targetByGenre.get(genre) || []), record]);
  }
  const comdeskDir = path.join(outputDir, 'comdesk'); ensureDir(comdeskDir);
  const files = [];
  for (const [genre, rows] of targetByGenre) {
    const file = path.join(comdeskDir, `${sanitize(genre)}.csv`);
    writeCsv(file, rows.map(toCsvRow), COMDESK_HEADERS);
    summary.genres[genre] = rows.length; files.push({ genre, file, rows: rows.length });
  }
  fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  return { summary, files };
}

function toCsvRow(record) {
  return { '店名': record.name, '電話番号': record.phone, '住所': record.address, 'ジャンル': record.genre, '媒体': record.sources?.join(',') || record.source, '取得元URL': record.sourceUrls?.join(' ') || record.sourceUrl };
}
