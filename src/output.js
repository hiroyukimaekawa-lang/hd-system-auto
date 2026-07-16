import fs from 'node:fs';
import path from 'node:path';

export const HEADERS = [
  '店名','ジャンル','検索ジャンル','取得元ジャンル','都道府県','市区町村','住所','電話番号',
  '定休日','営業日','営業開始A','営業終了A','営業開始B','営業終了B','営業時間原文',
  'URL','HP有無','媒体','取得元URL','取得日時'
];

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

export function writeCsv(file, rows) {
  ensureDir(path.dirname(file));
  const unique = [...new Map(rows.map(r => [r['URL'] || `${r['店名']}|${r['住所']}`, r])).values()];
  const body = [HEADERS.map(csvCell).join(','), ...unique.map(row => HEADERS.map(h => csvCell(row[h])).join(','))].join('\r\n');
  fs.writeFileSync(file, '\uFEFF' + body, 'utf8');
  return unique.length;
}

export function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return [];
  const parse = line => {
    const out = []; let cur = ''; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = !quoted;
      else if (c === ',' && !quoted) { out.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    out.push(cur.trim()); return out;
  };
  const headers = parse(lines[0]);
  return lines.slice(1).map(line => Object.fromEntries(headers.map((h, i) => [h, parse(line)[i] || ''])));
}
