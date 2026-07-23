#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createOrResume, jobDir } from './pipeline.js';

const command = process.argv[2] || 'dry';
const values = Object.fromEntries(process.argv.slice(3).filter((v) => v.startsWith('--')).map((v) => { const [key, ...rest] = v.slice(2).split('='); return [key, rest.length ? rest.join('=') : true]; }));
if (!['dry', 'run', 'resume', 'finalize'].includes(command)) fail('コマンドは dry / run / resume / finalize のいずれかです');
let input = values;
if (command === 'resume' || command === 'finalize') {
  if (!values['job-id']) fail('--job-idを指定してください');
  const file = path.join(jobDir(values['job-id']), 'state.json'); if (!fs.existsSync(file)) fail(`ジョブが見つかりません: ${values['job-id']}`);
  const previous = JSON.parse(fs.readFileSync(file, 'utf8')); input = { ...previous.input, ...values };
}
for (const name of ['prefecture', 'area', 'category']) if (!input[name]) fail(`--${name}を指定してください`);
try {
  const result = await createOrResume({ jobId: values['job-id'], prefecture: input.prefecture, area: input.area, category: input.category, dryRun: command === 'dry', stopBefore: values['stop-before'], headed: values.headed === true, executeComdesk: process.env.COMDESK_EXECUTE === 'true', finalizeOnly: command === 'finalize', maxItems: Number(values['max-items']) || undefined, maxPages: Number(values['max-pages']) || undefined });
  console.log(JSON.stringify({ ok: true, jobId: result.state.jobId, status: result.state.status, stateFile: path.join(result.dir, 'state.json'), counts: result.state.counts, plan: result.state.plan }, null, 2));
  if (result.state.status === 'failed') process.exitCode = 1;
} catch (error) { console.error(JSON.stringify({ ok: false, jobId: error.jobId, error: error.message, stateFile: error.dir && path.join(error.dir, 'state.json') }, null, 2)); process.exitCode = 1; }
function fail(message) { console.error(message); process.exit(2); }
