#!/usr/bin/env node
import { App } from '@slack/bolt';
import { loadEnv } from './env.js';
import { GasWebAppClient } from './drive.js';
import { listSheetJobs } from './management-sheet.js';
import { createJobId, JobQueue } from './queue.js';
import { SerialWorker } from './worker.js';

loadEnv();
for (const name of ['SLACK_BOT_TOKEN','SLACK_APP_TOKEN','SLACK_SIGNING_SECRET']) if (!process.env[name]) throw new Error(`${name} が設定されていません`);
const allowed = new Set(String(process.env.SLACK_ALLOWED_CHANNEL_IDS || '').split(',').map(value => value.trim()).filter(Boolean));
const app = new App({ token:process.env.SLACK_BOT_TOKEN, signingSecret:process.env.SLACK_SIGNING_SECRET, socketMode:true, appToken:process.env.SLACK_APP_TOKEN });
const queue = new JobQueue(); const gas = new GasWebAppClient(); const worker = new SerialWorker({ queue, slackClient:app.client });

function permitted(channelId) { return !allowed.size || allowed.has(channelId); }
function parseList(text) {
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean); let industry = '飲食店';
  if (tokens[0] === '飲食店') industry = tokens.shift();
  const prefecture = tokens.shift(), city = tokens.shift(), genre = tokens.shift();
  const options = Object.fromEntries(tokens.filter(value => value.startsWith('--')).map(value => { const [key, raw=''] = value.slice(2).split('='); return [key, raw]; }));
  if (!prefecture || !city || !genre) throw new Error('使い方: /hd-list 飲食店 茨城県 土浦市 カフェ --sources=googlemaps,tabelog --max=100');
  const sources = (options.sources || 'googlemaps,tabelog').split(',').filter(value => ['googlemaps','tabelog'].includes(value));
  if (!sources.length) throw new Error('取得元は googlemaps または tabelog を指定してください');
  return { industry, prefecture, city, genre, sources, maxItems:Math.min(500, Math.max(1, Number(options.max) || 100)) };
}
async function createThread(command, text) { return app.client.chat.postMessage({ channel:command.channel_id, text }); }

app.command('/hd-list', async ({ command, ack, respond }) => {
  await ack(); if (!permitted(command.channel_id)) return respond('このチャンネルからは実行できません。');
  try {
    const payload = parseList(command.text); const id = createJobId();
    const message = await createThread(command, `受付しました\nジョブID：${id}\n対象：${payload.prefecture} ${payload.city}\nジャンル：${payload.genre}\n取得元：${payload.sources.join('、')}`);
    queue.add({ id, payload, channelId:command.channel_id, threadTs:message.ts });
  } catch (error) { await respond(error.message); }
});

app.command('/hd-list-sheet', async ({ command, ack, respond }) => {
  await ack(); if (!permitted(command.channel_id)) return respond('このチャンネルからは実行できません。');
  try {
    const [prefecture, industry, ...extra] = command.text.trim().split(/\s+/); if (!prefecture || !industry || extra.length) throw new Error('使い方: /hd-list-sheet 茨城県 飲食店');
    const targets = await listSheetJobs(gas, prefecture, industry); if (!targets.length) return respond('自動取得対象がTRUEで未完了の市区町村はありません。');
    const parent = await createThread(command, `管理マスタから${targets.length}件を受け付けました。順番に実行します。`);
    for (const target of targets) { const id = createJobId(); queue.add({ id, channelId:command.channel_id, threadTs:parent.ts, payload:{ industry, prefecture, city:target.city, genre:target.genre || '飲食店', sources:(target.sources || 'googlemaps,tabelog').split(','), maxItems:100, managementRowNumber:target.rowNumber, minimumCount:target.minimumCount, route:target.route } }); }
  } catch (error) { await respond(error.message); }
});

app.command('/hd-list-status', async ({ command, ack, respond }) => {
  await ack(); const id = command.text.trim(); const job = queue.get(id); if (!job) return respond(`ジョブが見つかりません: ${id}`);
  await respond(`ジョブID：${job.id}\n状態：${job.status}\n進捗：${job.progress || '-'}${job.error ? `\nエラー：${job.error}` : ''}`);
});

app.command('/hd-list-cancel', async ({ command, ack, respond }) => {
  await ack(); const id = command.text.trim(); const job = queue.cancel(id); await respond(job ? `キャンセルを受け付けました: ${id}` : `ジョブが見つかりません: ${id}`);
});

await app.start(); worker.start(); console.log('Slack Socket Modeで起動しました');
