import fs from 'node:fs';
import path from 'node:path';

export const GOOGLE_MAPS_HEADERS = [
  '店名','ジャンル','検索ジャンル','取得元ジャンル','都道府県','市区町村','住所','電話番号',
  '定休日','営業日','営業開始A','営業終了A','営業開始B','営業終了B','営業時間原文',
  'URL','HP有無','媒体','取得元URL','取得日時'
];
export const TABELOG_HEADERS = GOOGLE_MAPS_HEADERS.filter(header => header !== '検索ジャンル');
export const HEADERS = GOOGLE_MAPS_HEADERS;

export function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

export function sanitize(value) {
  return String(value || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 80);
}

export function appendJsonl(file, record) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
}

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }

export function writeCsv(file, rows, headers = GOOGLE_MAPS_HEADERS) {
  ensureDir(path.dirname(file));
  const unique = [...new Map(rows.map(r => [r['URL'] || `${r['店名']}|${r['住所']}`, r])).values()];
  const body = [headers.map(csvCell).join(','), ...unique.map(row => headers.map(h => csvCell(row[h])).join(','))].join('\r\n');
  fs.writeFileSync(file, '\uFEFF' + body, 'utf8');
  return unique.length;
}

export function parseCsv(text) {
  const table = []; let row = []; let cur = ''; let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"' && quoted && input[i + 1] === '"') { cur += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cur); cur = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(cur); cur = ''; if (row.some(cell => cell.trim())) table.push(row); row = [];
    } else cur += char;
  }
  row.push(cur); if (row.some(cell => cell.trim())) table.push(row);
  const [headers = [], ...rows] = table;
  return rows.map(values => Object.fromEntries(headers.map((header, i) => [header.trim(), values[i] || ''])));
}
