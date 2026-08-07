import { backoff, selectPhone, sleep } from '../../scraper-utils.js';

// 電話番号なしのレコードだけをSerpAPIで補完する（要件15章）。
// phoneありは絶対に触らない。低信頼度は自動採用しない。
// PHONE_ENRICHMENT_DRY_RUN=true（既定）のときは外部呼び出しを一切行わない安全なモード。

function normalizeForCompare(value) {
  return String(value || '').normalize('NFKC').replace(/[\s　・･\-ー―‐]/g, '').toLowerCase();
}

export function scoreMatch(record, candidate) {
  const name = normalizeForCompare(record.name);
  const candidateName = normalizeForCompare(candidate?.title || candidate?.name || '');
  const nameMatch = Boolean(name) && Boolean(candidateName) && (candidateName.includes(name) || name.includes(candidateName));
  const cityMatch = Boolean(record.area) && normalizeForCompare(candidate?.address || '').includes(normalizeForCompare(record.area));
  return (nameMatch ? 60 : 0) + (cityMatch ? 40 : 0);
}

async function lookupPhone(record, { serpApiKey, fetchImpl }) {
  const query = `${record.name} ${record.address}`.trim();
  const url = `https://serpapi.com/search.json?engine=google_maps&type=search&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(serpApiKey)}`;
  const response = await fetchImpl(url);
  if (response.status === 429) { const error = new Error('SerpAPIのアクセス制限を検知しました (HTTP 429)'); error.status = 429; throw error; }
  if (!response.ok) throw new Error(`SerpAPI呼び出しに失敗しました (HTTP ${response.status})`);
  const data = await response.json();
  const candidate = data?.place_results || data?.local_results?.[0];
  const phone = selectPhone(candidate?.phone || '');
  if (!phone) return null;
  return { phone, score: scoreMatch(record, candidate) };
}

export async function enrichMissingPhones(records, { config, fetchImpl = fetch, log = () => {} } = {}) {
  const { serpApiKey, dryRun, maxCalls, minAutoAcceptScore } = config;
  let calls = 0;
  const stats = { attempted: 0, enriched: 0, skippedDryRun: 0, skippedNoKey: 0, skippedLowConfidence: 0, skippedLimit: 0, notFound: 0, errored: 0 };
  const output = [];
  for (const record of records) {
    if (record.phone) { output.push(record); continue; }
    stats.attempted += 1;
    if (dryRun) { stats.skippedDryRun += 1; output.push({ ...record, phoneEnrichment: 'dry_run' }); continue; }
    if (!serpApiKey) { stats.skippedNoKey += 1; output.push({ ...record, phoneEnrichment: 'no_api_key' }); continue; }
    if (calls >= maxCalls) { stats.skippedLimit += 1; output.push({ ...record, phoneEnrichment: 'call_limit_reached' }); continue; }
    calls += 1;
    try {
      const result = await lookupPhone(record, { serpApiKey, fetchImpl });
      if (result?.phone && result.score >= minAutoAcceptScore) {
        stats.enriched += 1;
        output.push({ ...record, phone: result.phone, phoneEnrichment: 'enriched', phoneEnrichmentScore: result.score });
        log(`補完: ${record.name} → ${result.phone} (score=${result.score})`);
      } else if (result?.phone) {
        stats.skippedLowConfidence += 1;
        output.push({ ...record, phoneEnrichment: 'low_confidence', phoneEnrichmentScore: result.score });
        log(`低信頼度のため不採用: ${record.name} (score=${result.score})`);
      } else {
        stats.notFound += 1;
        output.push({ ...record, phoneEnrichment: 'not_found' });
      }
    } catch (error) {
      if (error.status === 429) { log('SerpAPI 429のためbackoffします'); await sleep(backoff(0)); }
      stats.errored += 1;
      output.push({ ...record, phoneEnrichment: 'error', phoneEnrichmentError: error.message });
    }
  }
  return { records: output, stats };
}
