// http/https以外（javascript:, data: など）を弾く共通URL検証。sales-assist.js と script-structure-parser.js の両方から使う。
export const safeUrl = value => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const candidate = /^[a-z][\w+.-]*:/i.test(raw) ? raw : /^[\w-]+(\.[\w-]+)+(\/|$)/.test(raw) ? `https://${raw}` : raw;
  try { const url = new URL(candidate); return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
};
