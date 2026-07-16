export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function normalizeAddress(value) {
  return String(value || '').normalize('NFKC').replace(/^日本、?/, '').replace(/〒?\d{3}-?\d{4}/g, '').replace(/\s+/g, ' ').trim();
}

export function splitAddress(value) {
  const address = normalizeAddress(value).replace(/\s/g, '');
  const match = address.match(/^((?:北海道|東京都|大阪府|京都府|.{2,3}県))?((?:.+?郡.+?[町村]|.+?市.+?区|.+?[市区町村]))?/);
  return { pref: match?.[1] || '', city: match?.[2] || '' };
}

export function targetCity(area) { return splitAddress(area).city; }

export function isTargetAddress(address, area) {
  const wanted = splitAddress(area);
  const actual = splitAddress(address);
  return (!wanted.pref || actual.pref === wanted.pref) && (!wanted.city || actual.city === wanted.city);
}

export function selectPhone(text) {
  const matches = String(text || '').match(/(?:\d{2,5}-\d{1,4}-\d{3,4}|\d{10,11})/g) || [];
  return (matches.find(number => !number.startsWith('050')) || matches[0] || '').replace(/[^\d-]/g, '');
}

export function canonicalUrl(value) {
  try { const url = new URL(value); url.search = ''; url.hash = ''; return url.href.replace(/\/$/, '') + '/'; } catch { return String(value || ''); }
}

export function backoff(attempt, base = 1000, cap = 15000) {
  return Math.min(cap, base * (2 ** attempt)) + Math.floor(Math.random() * 350);
}
