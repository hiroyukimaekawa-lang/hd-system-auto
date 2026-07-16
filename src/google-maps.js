const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function splitAddress(address) {
  const pref = address.match(/(北海道|東京都|京都府|大阪府|.{2,3}県)/)?.[1] || '';
  const rest = pref ? address.slice(address.indexOf(pref) + pref.length) : address;
  const city = rest.match(/^(.+?(?:市|区|町|村))/)?.[1] || '';
  return { pref, city };
}

async function textOrEmpty(locator) {
  try { return (await locator.first().innerText({ timeout: 1500 })).trim(); } catch { return ''; }
}

async function attrOrEmpty(locator, name) {
  try { return (await locator.first().getAttribute(name, { timeout: 1500 })) || ''; } catch { return ''; }
}

async function collectLinks(page, maxItems, log) {
  const feed = page.locator('div[role="feed"]');
  await feed.waitFor({ timeout: 30000 });
  const found = new Map(); let unchanged = 0;
  while (found.size < maxItems && unchanged < 8) {
    const before = found.size;
    const links = await page.locator('a[href*="/maps/place/"]').evaluateAll(nodes => nodes.map(a => ({ url: a.href, name: a.getAttribute('aria-label') || a.textContent || '' })));
    for (const item of links) if (item.url && !found.has(item.url)) found.set(item.url, item.name.trim());
    unchanged = found.size === before ? unchanged + 1 : 0;
    log(`一覧取得 ${Math.min(found.size, maxItems)}/${maxItems}`);
    await feed.evaluate(el => el.scrollBy(0, Math.max(700, el.clientHeight * 0.9)));
    await sleep(900 + Math.random() * 500);
  }
  return [...found].slice(0, maxItems).map(([url, name]) => ({ url, name }));
}

async function scrapePlace(page, item, job) {
  await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('[role="main"] h1').first().waitFor({ timeout: 12000 }).catch(() => {});
  const name = await textOrEmpty(page.locator('[role="main"] h1')) || item.name;
  const addressRaw = await attrOrEmpty(page.locator('button[data-item-id="address"]'), 'aria-label');
  const address = addressRaw.replace(/^住所[：:]\s*/, '').trim();
  const phoneId = await attrOrEmpty(page.locator('button[data-item-id^="phone:tel:"]'), 'data-item-id');
  const phone = phoneId.replace(/^phone:tel:/, '').trim();
  const website = await attrOrEmpty(page.locator('a[data-item-id="authority"]'), 'href');
  const genre = await textOrEmpty(page.locator('button[jsaction*="category"]'));
  const portal = /tabelog\.com|hotpepper\.jp|gnavi\.co\.jp|retty\.me|facebook\.com|instagram\.com|x\.com|ameblo\.jp/i.test(website);
  const hoursButton = page.locator('button[data-item-id="oh"]');
  if (await hoursButton.count()) await hoursButton.first().click().catch(() => {});
  await sleep(250);
  const hours = await page.locator('tr').evaluateAll(rows => rows.map(r => (r.textContent || '').trim()).filter(t => /^[月火水木金土日]曜日/.test(t))).catch(() => []);
  const { pref, city } = splitAddress(address);
  return {
    '店名': name, 'ジャンル': job.outputGenre, '検索ジャンル': job.keyword, '取得元ジャンル': genre,
    '都道府県': pref, '市区町村': city, '住所': address, '電話番号': phone,
    '定休日': '', '営業日': '', '営業開始A': '', '営業終了A': '', '営業開始B': '', '営業終了B': '',
    '営業時間原文': hours.join('\n'), 'URL': item.url, 'HP有無': website && !portal ? '有' : '無',
    '媒体': 'Googleマップ', '取得元URL': item.url, '取得日時': new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
  };
}

export async function runGoogleMapsJob(browser, job, existingUrls, onRecord, log) {
  const context = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const query = `${job.area} ${job.keyword}`;
  await page.goto(`https://www.google.co.jp/maps/search/${encodeURIComponent(query)}?hl=ja`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const consent = page.getByRole('button', { name: /すべて同意|Accept all/i });
  if (await consent.count()) await consent.first().click().catch(() => {});
  const links = await collectLinks(page, job.maxItems, log);
  let saved = 0;
  for (const [index, item] of links.entries()) {
    if (existingUrls.has(item.url)) { log(`再開: ${index + 1}/${links.length} 取得済みをスキップ`); continue; }
    try {
      const record = await scrapePlace(page, item, job);
      if (!record['住所'] || (job.area.includes('市') && !record['住所'].includes(job.area.match(/[^\s]+市/)?.[0] || job.area))) {
        log(`除外: ${record['店名'] || item.name}（住所不一致または未取得）`); continue;
      }
      onRecord(record); existingUrls.add(item.url); saved++;
      log(`保存: ${index + 1}/${links.length} ${record['店名']}`);
    } catch (error) { log(`失敗: ${item.name || item.url} ${error.message}`); }
    await sleep(700 + Math.random() * 600);
  }
  await context.close();
  return saved;
}
