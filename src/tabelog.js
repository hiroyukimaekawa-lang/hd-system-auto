import { backoff, canonicalUrl, isTargetAddress, selectPhone, sleep, splitAddress } from './scraper-utils.js';
import { normalizeGenre } from './genres.js';

export class RateLimitError extends Error { constructor(status, url) { super(`食べログのアクセス制限を検知しました (HTTP ${status})`); this.name = 'RateLimitError'; this.status = status; this.url = url; this.jobStatus = 'paused_rate_limit'; } }

async function goto(page, url) {
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const status = response?.status() || 0;
      if (status === 403 || status === 429) throw new RateLimitError(status, url);
      if (status >= 500) throw new Error(`HTTP ${status}`);
      const title = await page.title();
      if (/アクセス.*(?:制限|拒否)|Robot Check|Security Check|Cloudflare/i.test(title + ' ' + await page.locator('body').innerText().catch(() => ''))) throw new RateLimitError(status || 403, url);
      return;
    } catch (caught) {
      if (caught instanceof RateLimitError) throw caught;
      error = caught;
      if (attempt < 2) await sleep(backoff(attempt, 1500));
    }
  }
  throw error;
}

function searchUrl(job) {
  if (job.tabelogUrl) return job.tabelogUrl;
  const keyword = `${job.area} ${job.keyword}`;
  return `https://tabelog.com/rstLst/?sk=${encodeURIComponent(keyword)}&SrtT=trend`;
}

async function collectStoreUrls(page, job, existingUrls, log) {
  const found = new Map(); let current = searchUrl(job); let pageNo = 1;
  while (current && found.size + existingUrls.size < job.maxItems && pageNo <= (job.maxPages || 50)) {
    await goto(page, current);
    const links = await page.locator('.list-rst__rst-name-target, .js-rst-cassette-wrap .list-rst__name a, a.list-rst__name-main').evaluateAll(nodes => nodes.map(a => ({ url: a.href, name: (a.textContent || '').trim() })));
    for (const item of links) { const url = canonicalUrl(item.url); if (/tabelog\.com\/[a-z]+\/A\d+\/A\d+\/\d+\/$/.test(url)) found.set(url, { ...item, url }); }
    log(`食べログ一覧 ${pageNo}ページ: ${found.size}件`);
    const next = await page.locator('a.c-pagination__arrow--next, a[rel="next"]').first().getAttribute('href').catch(() => null);
    current = next ? new URL(next, current).href : null; pageNo++;
    if (current) await sleep(1200 + Math.random() * 800);
  }
  return [...found.values()].filter(item => !existingUrls.has(item.url)).slice(0, Math.max(0, job.maxItems - existingUrls.size));
}

async function scrapeStore(page, item, job) {
  await goto(page, item.url);
  const data = await page.evaluate(() => {
    const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    let genre = '', address = '', phoneText = '', hours = '', holiday = '';
    document.querySelectorAll('.rstinfo-table__table tr, table tr').forEach(row => {
      const th = text(row.querySelector('th')); const td = row.querySelector('td'); const value = text(td);
      if (th.includes('ジャンル') && !genre) genre = value;
      if (th.includes('住所') && !address) address = value;
      if (/(?:電話番号|お問い合せ専用番号|お問い合わせ専用)/.test(th)) phoneText += ` ${value}`;
      if (th.includes('営業時間') && !hours) hours = value;
      if (th.includes('定休日') && !holiday) holiday = value;
    });
    const name = text(document.querySelector('.display-name')) || document.title.split(/[（(]| \- /)[0].trim();
    address ||= text(document.querySelector('p.rstinfo-table__address'));
    phoneText += ` ${text(document.querySelector('.rstinfo-table__tel-num'))}`;
    const homepage = document.querySelector('.homepage a, a[href*="rst_site_url"], .rstinfo-table__link');
    return { name, genre, address, phoneText, hours, holiday, homepage: homepage?.href || '' };
  });
  data.address = data.address.replace(/大きな地図を見る|周辺のお店を探す/g, '').trim();
  if (!data.name || !data.address || !isTargetAddress(data.address, job.area)) return null;
  const { pref, city } = splitAddress(data.address);
  const portal = /tabelog\.com|hotpepper\.jp|gnavi\.co\.jp|retty\.me|facebook\.com|instagram\.com|x\.com|ameblo\.jp/i.test(data.homepage);
  return {
    '店名': data.name, 'ジャンル': normalizeGenre(data.genre, data.name, job.outputGenre), '取得元ジャンル': data.genre,
    '都道府県': pref, '市区町村': city, '住所': data.address, '電話番号': selectPhone(data.phoneText),
    '定休日': data.holiday, '営業日': '', '営業開始A': '', '営業終了A': '', '営業開始B': '', '営業終了B': '',
    '営業時間原文': [data.hours && `【営業時間】\n${data.hours}`, data.holiday && `【定休日】\n${data.holiday}`].filter(Boolean).join('\n'),
    'URL': item.url, 'HP有無': data.homepage && !portal ? '有' : '無', '媒体': '食べログ', '取得元URL': item.url,
    '取得日時': new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
  };
}

export async function runTabelogJob(browser, job, existingUrls, onRecord, log) {
  const context = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const page = await context.newPage();
  try {
    const items = await collectStoreUrls(page, job, existingUrls, log); let saved = 0;
    for (const [index, item] of items.entries()) {
      const record = await scrapeStore(page, item, job);
      if (record) { onRecord(record); existingUrls.add(item.url); saved++; log(`食べログ保存: ${index + 1}/${items.length} ${record['店名']}`); }
      else log(`食べログ除外: ${item.name || item.url}`);
      await sleep(1800 + Math.random() * 1200);
    }
    return saved;
  } finally { await context.close(); }
}
