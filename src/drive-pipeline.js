import fs from 'node:fs';
import { resolveLocation } from './drive.js';
import { sanitize } from './output.js';
import { splitAddress } from './scraper-utils.js';

function timestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}${get('month')}${get('day')}_${get('hour')}${get('minute')}`;
}

export function driveCsvName(source, job, date = new Date()) {
  const { pref, city } = splitAddress(job.area);
  return `${source}_${sanitize(pref)}_${sanitize(city)}_${sanitize(job.outputGenre || job.keyword)}_${timestamp(date)}.csv`;
}

export async function uploadJobCsvs(client, job, jobId, files, options = {}) {
  const { pref, city } = splitAddress(job.area);
  const location = await resolveLocation(client, { rootId: options.rootId || process.env.GOOGLE_DRIVE_RESTAURANT_ROOT_FOLDER_ID, prefecture: pref, city, cacheFile: options.cacheFile, refresh: options.refresh });
  const uploaded = [];
  for (const [source, filePath] of Object.entries(files)) {
    if (!fs.existsSync(filePath)) throw new Error(`アップロード対象CSVがありません: ${filePath}`);
    uploaded.push(await client.uploadCsv(filePath, location, jobId, driveCsvName(source, job)));
  }
  return { location, uploaded };
}
