import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const EXAMPLE_FILE = path.join(ROOT, 'config', 'is', 'list-generation', 'scraping-automation.local.example.json');
const LOCAL_FILE = path.join(ROOT, 'config', 'is', 'list-generation', 'scraping-automation.local.json');

function readJson(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}; }

// PoC専用設定。config値やenvがどうであっても、autoUploadToComdeskは常にfalse固定にする
// （Comdesk本番投入を絶対に実行しないという要件のための安全弁）。
export function loadIsListGenerationConfig(env = process.env) {
  const base = readJson(EXAMPLE_FILE);
  const local = readJson(LOCAL_FILE);
  const drive = { ...(base.drive || {}), ...(local.drive || {}) };
  const poc = { ...(base.poc || {}), ...(local.poc || {}) };
  return {
    driveRootFolderId: drive.rootFolderId || '',
    autoUploadToComdesk: false,
    sources: poc.sources && poc.sources.length ? poc.sources : ['google_maps', 'tabelog'],
    maxResultsPerSource: Number(poc.maxResultsPerSource) || 50,
    stopOnCaptcha: poc.stopOnCaptcha !== false,
    phone: {
      serpApiKey: env.SERPAPI_API_KEY || '',
      dryRun: env.PHONE_ENRICHMENT_DRY_RUN !== 'false',
      maxCalls: Number(env.MAX_SERPAPI_CALLS_PER_RUN || 500),
      minAutoAcceptScore: Number(env.MIN_AUTO_ACCEPT_SCORE || 85)
    }
  };
}
