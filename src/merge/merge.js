export const EXPECTED_COUNTS = { '美浦村': 35, '稲敷市': 114 };

export function normalizePhone(value) {
  let phone = String(value ?? '').normalize('NFKC').replace(/[^0-9+]/g, '');
  if (phone.startsWith('+81')) phone = `0${phone.slice(3)}`;
  return phone.replace(/\D/g, '');
}

export function normalizeIdentity(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s　・･\-ー―‐]/g, '');
}

export function cleanSheetRows(values, sheetName) {
  if (!Array.isArray(values) || !values.length) throw new Error(`${sheetName}: ヘッダーがありません`);
  const header = values[0].map((value) => String(value ?? '').trim());
  if (!header.some(Boolean)) throw new Error(`${sheetName}: ヘッダーが空です`);
  const rows = values.slice(1).filter((row) => {
    const padded = Array.from({ length: header.length }, (_, index) => row[index] ?? null);
    if (!padded.some((value) => String(value ?? '').trim())) return false;
    return !header.every((value, index) => String(padded[index] ?? '').trim() === value);
  }).map((row) => Array.from({ length: header.length }, (_, index) => row[index] ?? null));
  return { header, rows };
}

export function compareHeaders(left, right) {
  const max = Math.max(left.length, right.length); const differences = [];
  for (let index = 0; index < max; index += 1) {
    if ((left[index] ?? null) !== (right[index] ?? null)) differences.push({ column: index + 1, left: left[index] ?? null, right: right[index] ?? null });
  }
  return differences;
}

export function mergeSalesSources(snapshot, selectedAreas, expectedCounts = EXPECTED_COUNTS) {
  const selected = selectedAreas.map((area) => snapshot.sources.find((source) => source.area === area));
  const missing = selectedAreas.filter((area, index) => !selected[index]);
  if (missing.length) throw new Error(`取得済みデータがありません: ${missing.join('、')}`);
  const cleaned = new Map(); const areaTotals = Object.fromEntries(selectedAreas.map((area) => [area, 0]));
  for (const source of selected) {
    for (const [sheetName, values] of Object.entries(source.sheets)) {
      if (!sheetName.startsWith('04_SALES_')) continue;
      const result = cleanSheetRows(values, `${source.area}/${sheetName}`);
      cleaned.set(`${source.area}\0${sheetName}`, result); areaTotals[source.area] += result.rows.length;
    }
  }
  const allHeaders = [...cleaned.entries()];
  const canonicalHeader = allHeaders[0]?.[1].header || [];
  for (const [key, data] of allHeaders.slice(1)) {
    const differences = compareHeaders(canonicalHeader, data.header);
    if (differences.length) throw Object.assign(new Error(`${key.replace('\0', '/')}: 基準ヘッダーと一致しないため停止しました`), { sheetName: key, differences });
  }
  const countMismatches = selectedAreas.flatMap((area) => areaTotals[area] === expectedCounts[area] ? [] : [{ area, expected: expectedCounts[area], actual: areaTotals[area] }]);
  if (countMismatches.length) throw Object.assign(new Error(`想定件数と一致しません: ${countMismatches.map((item) => `${item.area} 想定${item.expected}件/実際${item.actual}件`).join('、')}`), { countMismatches });

  const sheetNames = [...new Set(selected.flatMap((source) => Object.keys(source.sheets).filter((name) => name.startsWith('04_SALES_'))))];
  const sheets = {}; const summary = [];
  for (const sheetName of sheetNames) {
    const available = selected.map((source) => ({ area: source.area, data: cleaned.get(`${source.area}\0${sheetName}`) })).filter((item) => item.data);
    const header = available[0].data.header;
    for (const item of available.slice(1)) {
      const differences = compareHeaders(header, item.data.header);
      if (differences.length) throw Object.assign(new Error(`${sheetName}: ヘッダーが一致しないため停止しました`), { sheetName, differences });
    }
    const telIndex = findHeader(header, ['Tel1', '電話番号']);
    const nameIndex = findHeader(header, ['名前', '店名']);
    const addressIndexes = [findHeader(header, ['都道府県']), findHeader(header, ['住所１', '住所']), findHeader(header, ['住所２'])].filter((index) => index >= 0);
    if (telIndex < 0 || nameIndex < 0 || !addressIndexes.length) throw new Error(`${sheetName}: 重複判定に必要な列がありません`);
    const seen = new Set(); const mergedRows = []; let duplicates = 0;
    const counts = Object.fromEntries(selectedAreas.map((area) => [area, available.find((item) => item.area === area)?.data.rows.length || 0]));
    for (const item of available) {
      for (const original of item.data.rows) {
        const row = [...original]; const phone = normalizePhone(row[telIndex]); row[telIndex] = phone;
        const fallback = `${normalizeIdentity(row[nameIndex])}|${normalizeIdentity(addressIndexes.map((index) => row[index]).join(''))}`;
        const key = phone ? `tel:${phone}` : `name-address:${fallback}`;
        if (seen.has(key)) { duplicates += 1; continue; }
        seen.add(key); mergedRows.push(row);
      }
    }
    sheets[sheetName] = { header, rows: mergedRows };
    summary.push({ sheetName, counts, before: Object.values(counts).reduce((sum, count) => sum + count, 0), duplicates, after: mergedRows.length });
  }
  return { sheets, summary, areaTotals, beforeTotal: Object.values(areaTotals).reduce((sum, count) => sum + count, 0), duplicateTotal: summary.reduce((sum, item) => sum + item.duplicates, 0), afterTotal: summary.reduce((sum, item) => sum + item.after, 0) };
}

function findHeader(header, candidates) { return header.findIndex((name) => candidates.includes(name)); }
