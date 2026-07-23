import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, sanitize, writeCsv } from '../output.js';
import { normalizeGenre } from '../genres.js';
import { normalizeAddress } from '../scraper-utils.js';

const FIXED_CHAIN_WORDS = /(?:株式会社|有限会社).*(?:本部|本社)|イオン|イトーヨーカドー|ドン・キホーテ|スターバックス|マクドナルド|すき家|吉野家|ガスト|サイゼリヤ|コメダ珈琲|セブン-?イレブン|ローソン|ファミリーマート/i;
const COMMON_EXCLUSIONS = [
  ['道の駅', /道の駅/], ['カラオケ', /カラオケ/], ['総合公園', /総合公園/], ['ゴルフ', /ゴルフ|カントリー倶楽部/],
  ['ホテル', /ホテル|旅館/], ['スーパー', /スーパー(?:マーケット)?/], ['大型商業施設', /イオンモール|ショッピング(?:センター|モール)|大型商業施設/]
];
const MANAGEMENT_WORDS = /(?:ビル|施設|不動産|建物|テナント).*(?:管理|運営)(?:会社|事務所)?|(?:管理会社|施設管理)/;
const BUILDING_NOTATION = /(?:ビル|マンション|テナント|\d+\s*[FＦ階])/;
const CLOSED_WORDS = /(閉業|閉店|廃業|営業終了|移転済み)/;
const MINOR_GENRE_PARENT = new Map([['焼き鳥', '居酒屋'], ['焼肉', '居酒屋'], ['蕎麦・うどん', '和食'], ['寿司', '和食']]);

export const COMDESK_HEADERS = [
  'UUID','種別','名前','カナ','郵便番号','都道府県','住所１','住所２','住所カナ','Tel1','Tel2','Tel3','Tel4','FAX','URL','備考',
  '旧社名','リードソース','旧進捗','履歴','オーナー名','HPある？','BP検索','アポ済商材','最新履歴','営業曜日','休業曜日','午前始','午前終','午後始','午後終'
];

export function normalizePhone(value) {
  let digits = String(value || '').normalize('NFKC').replace(/[^0-9+]/g, '');
  if (digits.startsWith('+81')) digits = `0${digits.slice(3)}`;
  digits = digits.replace(/\D/g, '');
  return /^0\d{9,10}$/.test(digits) ? digits : '';
}

export function normalizeRecords(sourceRows, fallbackGenre) {
  return sourceRows.map(({ source, row }) => {
    const phone = normalizePhone(row['電話番号']);
    const genre = normalizeGenre(row['取得元ジャンル'] || row['ジャンル'], row['店名'], row['ジャンル'] || fallbackGenre);
    return {
      name: String(row['店名'] || '').trim(), genre, originalGenre: genre, prefecture: String(row['都道府県'] || '').trim(),
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

export function classifyRecords(records, { profile = 'AFFILIATE', chainNames = [] } = {}) {
  const chains = chainNames.map((value) => String(value).normalize('NFKC').trim()).filter(Boolean);
  return records.map((record) => {
    const text = `${record.name} ${record.address} ${record.raw?.['取得元ジャンル'] || ''}`.normalize('NFKC');
    let bucket = 'target'; let reason = '';
    if (CLOSED_WORDS.test(text)) { bucket = 'excluded'; reason = '閉業・移転済み'; }
    else {
      const common = COMMON_EXCLUSIONS.find(([, pattern]) => pattern.test(text));
      if (common) { bucket = 'excluded'; reason = `共通除外: ${common[0]}`; }
      else if (FIXED_CHAIN_WORDS.test(text) || chains.some((chain) => text.includes(chain))) { bucket = 'excluded'; reason = 'チェーンマスタ一致'; }
      else if (MANAGEMENT_WORDS.test(text)) { bucket = 'excluded'; reason = '明確な施設・管理会社'; }
      else if (profile === 'ELECTRIC' && BUILDING_NOTATION.test(text)) { bucket = 'review'; reason = '建物・テナント表記'; }
      else if (!record.name || !record.address) { bucket = 'failed'; reason = '必須項目の取得失敗'; }
      else if (!record.area) { bucket = 'review'; reason = 'エリア不明'; }
      else if (!record.phone) { bucket = 'review'; reason = '電話番号なし'; }
    }
    return { ...record, bucket, reason };
  });
}

export function assignRegions(records, regionMaster = []) {
  return records.map((record) => {
    const matches = regionMaster.filter((region) => region.prefecture === record.prefecture && (region.municipalities || []).some((name) => record.address.includes(name)));
    if (matches.length !== 1) return { ...record, area: '', bucket: 'review', reason: matches.length ? '住所が複数エリアに一致' : 'エリア不明' };
    return { ...record, area: matches[0].outputArea };
  });
}

export function consolidateMinorGenres(records, threshold = 20) {
  const counts = new Map();
  for (const record of records.filter((item) => item.bucket === 'target')) {
    const key = `${record.area}\0${record.genre}`; counts.set(key, (counts.get(key) || 0) + 1);
  }
  const audit = [];
  const output = records.map((record) => {
    const parent = MINOR_GENRE_PARENT.get(record.genre); const count = counts.get(`${record.area}\0${record.genre}`) || 0;
    if (!parent || record.bucket !== 'target' || count >= threshold) return record;
    audit.push({ area: record.area, before: record.genre, after: parent, count, rule: `${threshold}件未満を${parent}へ統合` });
    return { ...record, originalGenre: record.originalGenre || record.genre, genre: parent };
  });
  return { records: output, audit: [...new Map(audit.map((item) => [`${item.area}\0${item.before}`, item])).values()] };
}

export function validateComdeskRecords(records) {
  const errors = []; const keys = new Set(); let duplicates = 0;
  for (const [index, record] of records.entries()) {
    if (!record.phone || !/^0\d{9,10}$/.test(record.phone)) errors.push(`${index + 1}行目: 電話番号形式不正`);
    if (!record.address || !record.area) errors.push(`${index + 1}行目: 住所またはエリア不明`);
    const key = record.phone || `${record.name}|${record.address}`; if (keys.has(key)) duplicates += 1; keys.add(key);
  }
  if (duplicates) errors.push(`重複${duplicates}件`);
  return { ok: errors.length === 0, errors, rows: records.length, columns: COMDESK_HEADERS.length, duplicates };
}

export function writeClassifiedOutputs(outputDir, inputRecords, { profile = 'AFFILIATE', genreThreshold = 20, operation = 'リアルアフィリエイト', date = new Date() } = {}) {
  ensureDir(outputDir);
  const consolidated = consolidateMinorGenres(inputRecords, genreThreshold); const records = consolidated.records;
  fs.writeFileSync(path.join(outputDir, 'normalized.json'), JSON.stringify(records, null, 2));
  fs.writeFileSync(path.join(outputDir, 'genre-consolidation.json'), JSON.stringify(consolidated.audit, null, 2));
  const summary = { total: records.length, target: 0, review: 0, excluded: 0, failed: 0, genres: {}, profile };
  for (const record of records) summary[record.bucket] += 1;
  for (const bucket of ['target', 'review', 'excluded', 'failed']) writeCsv(path.join(outputDir, `${bucket}.csv`), records.filter((r) => r.bucket === bucket).map(toAuditRow), ['店名','電話番号','住所','エリア','ジャンル','判定理由','媒体','取得元URL']);
  const grouped = new Map();
  for (const record of records.filter((r) => r.bucket === 'target')) {
    const key = `${record.area}\0${record.genre}`; grouped.set(key, [...(grouped.get(key) || []), record]);
  }
  const comdeskDir = path.join(outputDir, 'comdesk'); ensureDir(comdeskDir); const files = [];
  const ymd = date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).replaceAll('-', '');
  for (const [key, rows] of grouped) {
    const [area, genre] = key.split('\0'); const validation = validateComdeskRecords(rows);
    if (!validation.ok) throw new Error(`Comdesk CSV事前検証失敗 (${area}/${genre}): ${validation.errors.join('、')}`);
    const file = path.join(comdeskDir, `コムデスク_${sanitize(operation)}_${sanitize(rows[0].prefecture)}_${sanitize(area)}_${sanitize(genre)}_${ymd}.csv`);
    writeCsv(file, rows.map(toComdeskRow), COMDESK_HEADERS);
    summary.genres[`${area}/${genre}`] = rows.length; files.push({ area, genre, file, rows: rows.length, validation });
  }
  fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  return { summary, files, genreAudit: consolidated.audit };
}

function toAuditRow(record) { return { '店名':record.name,'電話番号':record.phone,'住所':record.address,'エリア':record.area,'ジャンル':record.genre,'判定理由':record.reason,'媒体':record.sources?.join(',') || record.source,'取得元URL':record.sourceUrls?.join(' ') || record.sourceUrl }; }
function toComdeskRow(record) {
  const raw = record.raw || {}; const url = record.sourceUrls?.[0] || record.sourceUrl || '';
  return { '名前':record.name,'郵便番号':raw['郵便番号'] || '','都道府県':record.prefecture,'住所１':record.address.replace(new RegExp(`^${record.prefecture}`), ''),'Tel1':record.phone,'URL':url,'リードソース':record.sources?.includes('tabelog') && !record.sources?.includes('googlemaps') ? '食べログ' : 'GoogleMap','HPある？':record.website ? '1' : '0','BP検索':`${record.prefecture}${record.area}tel${record.phone}`,'営業曜日':raw['営業日'] || '','休業曜日':raw['定休日'] || '','午前始':raw['営業開始A'] || '','午前終':raw['営業終了A'] || '','午後始':raw['営業開始B'] || '','午後終':raw['営業終了B'] || '' };
}
