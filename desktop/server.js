#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GasWebAppClient } from '../src/drive.js';
import { loadEnv } from '../src/env.js';
import { listSheetJobs } from '../src/management-sheet.js';
import { createJobId, JobQueue } from '../src/queue.js';
import { SerialWorker } from '../src/worker.js';
import { SalesAssistStore } from '../src/sales-assist.js';
import { ObsidianSalesArchive } from '../src/obsidian-sales-archive.js';
import { LocalSqliteSalesMaterialRepository } from '../src/repositories/sqlite-sales-material-repository.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(root, '.env'));
const publicDir = path.join(root, 'desktop', 'public');
const port = Number(process.env.HD_ASSISTANT_PORT) || 43117;
const queue = new JobQueue(path.join(root, 'state', 'jobs.sqlite'));
const worker = new SerialWorker({ queue, root }); worker.start();
const sales = new SalesAssistStore(path.join(root, 'state', 'sales-assist.sqlite'));
const materials = new LocalSqliteSalesMaterialRepository(sales.db);
const phaseTagFile = path.join(root, 'config', 'sales-assist', 'fs-material-phase-tags.json');
const phaseTagMap = talkScriptId => {
  const config = JSON.parse(fs.readFileSync(phaseTagFile, 'utf8')).talkScripts || {};
  return config[talkScriptId] || config.default || {};
};
// 資料の権限。将来ログイン利用者のロールへ差し替える。
const viewerOf = url => ['customer','fs','admin'].includes(url.searchParams.get('viewer')) ? url.searchParams.get('viewer') : 'fs';
const obsidianConfig = JSON.parse(fs.readFileSync(path.join(root, 'config', 'sales-assist', 'obsidian.json'), 'utf8'));
const obsidian = obsidianConfig.enabled ? new ObsidianSalesArchive(obsidianConfig) : null;
const syncSession = id => { if (obsidian) obsidian.syncSession(sales,id); };
const syncPreparation = id => { if (obsidian) obsidian.syncPreparation(sales,id); };
const syncLibraries = () => { if (obsidian) obsidian.syncLibraries(sales); };
// 案件を削除したら、書き出し済みのObsidianノートも消す（失敗しても案件削除は完了扱い）
const removeArchive = summary => {
  if (!obsidian) return { obsidianRemoved:0 };
  try { return { obsidianRemoved:obsidian.removeDeal(summary).length }; }
  catch (error) { return { obsidianRemoved:0, obsidianError:error.message }; }
};

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 100_000) throw new Error('メッセージが長すぎます'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function help() {
  return { text: '次のように話しかけてください。', cards: [
    { title: '取得対象を確認', body: '茨城県の管理シートから、次に取得する市町村を確認します。', prompt: '茨城県の取得対象を確認して' },
    { title: 'Drive接続確認', body: '土浦市の入力・処理済み・完成CSVフォルダを確認します。', prompt: '土浦市のDrive接続を確認して' },
    { title: '設定状態', body: '秘密情報を表示せず、必要な接続設定だけ確認します。', prompt: '設定を確認して' }
  ] };
}

async function chat(message) {
  const text = String(message || '').trim();
  if (!text || /^(ヘルプ|help|できること)/i.test(text)) return help();
  if (/設定/.test(text)) {
    const checks = [['GAS Webアプリ', process.env.GAS_WEB_APP_URL], ['共有シークレット', process.env.GAS_WEB_APP_SECRET], ['飲食店ルート', process.env.GOOGLE_DRIVE_RESTAURANT_ROOT_FOLDER_ID]];
    return { text: checks.map(([name, value]) => `${value ? '✓' : '×'} ${name}`).join('\n') };
  }
  if (/状態|進捗|ジョブ/.test(text) && !/取得開始|取得して/.test(text)) {
    const jobs = queue.list(10);
    if (!jobs.length) return { text:'まだジョブはありません。' };
    return { text:jobs.map(job => `${job.id}｜${job.payload.city} ${job.payload.genre}｜${job.status}\n${job.progress || ''}`).join('\n\n') };
  }
  if (/取得開始|取得して|取得を開始/.test(text)) {
    const city = text.match(/([一-龠ぁ-んァ-ヶー]+(?:市|町|村))/)?.[1];
    if (!city) return { text:'市区町村を指定してください。例：「土浦市のカフェを取得開始して」' };
    const genres = ['カフェ','居酒屋','スナック','Bar','パン屋','焼き鳥','喫茶店','お好み焼き','焼肉','スイーツ','中華','ハンバーガー','蕎麦・うどん','寿司','和食','洋食','定食・食堂','韓国','テイクアウト専門店','ラーメン'];
    const genre = genres.find(value => text.toLowerCase().includes(value.toLowerCase()));
    if (!genre) return { text:'取得ジャンルを指定してください。例：「土浦市のカフェを取得開始して」' };
    const id = createJobId(); queue.add({ id, payload:{ industry:'飲食店', prefecture:'茨城県', city, genre, sources:['googlemaps','tabelog'], maxItems:100 } });
    return { text:`受け付けました。\nジョブID：${id}\n対象：茨城県 ${city}\nジャンル：${genre}\n取得元：Googleマップ、食べログ\n\n「ジョブの状態を見せて」で進捗を確認できます。`, badge:'受付済み' };
  }
  const client = new GasWebAppClient();
  if (/取得対象|管理シート|hd-list-sheet/.test(text)) {
    const jobs = await listSheetJobs(client, '茨城県', '飲食店');
    if (!jobs.length) return { text: '現在、自動取得対象がTRUEで未完了の市町村はありません。' };
    return { text: `取得対象は${jobs.length}件です。\n${jobs.map(job => `・${job.city}｜${job.genre}｜${job.sources}｜最低${job.minimumCount || 0}件`).join('\n')}`, badge: `${jobs.length}件` };
  }
  const cityMatch = text.match(/([一-龠ぁ-んァ-ヶー]+(?:市|町|村))/);
  if (/Drive|ドライブ|フォルダ/i.test(text) || cityMatch) {
    const city = cityMatch?.[1] || '土浦市';
    const location = await client.resolveLocation(process.env.GOOGLE_DRIVE_RESTAURANT_ROOT_FOLDER_ID, '茨城県', city, false);
    return { text: `${city}の接続は正常です。\n✓ CSV投入フォルダ\n✓ 処理済みフォルダ\n✓ 完成版CSVエクスポート\n✓ ${city}スプレッドシート`, links: [{ label: `${city}フォルダを開く`, url: `https://drive.google.com/drive/folders/${location.cityFolderId}` }] };
  }
  return { text: 'まだその依頼には対応していません。まずは「できること」と入力してください。' };
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/api/health') return json(response, 200, { ok: true });
    if (request.method === 'GET' && request.url.startsWith('/api/sales/config')) {
      const url=new URL(request.url,'http://127.0.0.1');
      return json(response, 200, { ok:true, phases:sales.phases(url.searchParams.get('talkScriptId')||undefined), objections:sales.objections() });
    }
    if (request.method === 'GET' && request.url === '/api/sales/catalog') return json(response, 200, { ok:true, ...sales.catalog() });
    if (request.method === 'GET' && request.url === '/api/sales/sessions') return json(response, 200, { ok:true, sessions:sales.recent() });
    if (request.method === 'GET' && request.url === '/api/sales/preparations') return json(response, 200, { ok:true, preparations:sales.preparations() });
    if (request.method === 'GET' && request.url === '/api/sales/objection-history') return json(response, 200, { ok:true, objections:sales.objectionHistory() });
    if (request.method === 'GET' && /^\/api\/sales\/talk-scripts\/[^/]+\/objection-notes$/.test(request.url)) { const id=decodeURIComponent(request.url.split('/')[4]); return json(response,200,{ok:true,notes:sales.objectionNotes(id)}); }
    if (request.method === 'POST' && /^\/api\/sales\/talk-scripts\/[^/]+\/objection-notes$/.test(request.url)) { const body=await readBody(request); const id=decodeURIComponent(request.url.split('/')[4]); const note=sales.addObjectionNote(id,body); if(note?.session_id)syncSession(note.session_id); syncLibraries(); return json(response,note?201:404,{ok:Boolean(note),note}); }
    if (request.method === 'POST' && request.url === '/api/sales/talk-scripts') { const body=await readBody(request); const script=sales.createTalkScript(body); syncLibraries(); return json(response,201,{ok:true,script}); }
    if (request.method === 'POST' && request.url === '/api/sales/sessions') { const body=await readBody(request); return json(response, 201, { ok:true, session:sales.start(body) }); }
    if (request.method === 'POST' && request.url === '/api/sales/preparations') { const body=await readBody(request); const preparation=sales.prepare(body); syncPreparation(preparation.id); return json(response, 201, { ok:true, preparation }); }
    if (request.method === 'POST' && /^\/api\/sales\/preparations\/[^/]+\/open$/.test(request.url)) { const id=decodeURIComponent(request.url.split('/')[4]); const session=sales.openPreparation(id); if(session)syncSession(session.id); return json(response,session?200:404,{ok:Boolean(session),session}); }
    if (request.method === 'GET' && /^\/api\/sales\/sessions\/[^/]+\/record$/.test(request.url)) { const id=decodeURIComponent(request.url.split('/')[4]); return json(response,200,{ok:true,...sales.sessionRecord(id)}); }
    if (request.method === 'POST' && /^\/api\/sales\/sessions\/[^/]+\/facts$/.test(request.url)) { const body=await readBody(request); const id=decodeURIComponent(request.url.split('/')[4]); const fact=sales.addFact(id,body); if(fact)syncSession(id); return json(response,fact?201:404,{ok:Boolean(fact),fact}); }
    if (request.method === 'PUT' && /^\/api\/sales\/preparations\/[^/]+$/.test(request.url)) { const body=await readBody(request); const id=decodeURIComponent(request.url.split('/')[4]); const preparation=sales.updatePreparation(id,body); if(preparation)syncPreparation(id); return json(response,preparation?200:404,{ok:Boolean(preparation),preparation}); }
    if (request.method === 'POST' && request.url === '/api/sales/suggestions') { const body=await readBody(request); const result=sales.suggest(body); syncSession(body.sessionId); syncLibraries(); return json(response, 200, { ok:true, ...result }); }
    if (request.method === 'POST' && /^\/api\/sales\/suggestions\/[^/]+\/use$/.test(request.url)) { const body=await readBody(request); const id=decodeURIComponent(request.url.split('/')[4]); const suggestion=sales.useSuggestion(id,body.selectedCandidate); syncLibraries(); return json(response,suggestion?200:404,{ ok:Boolean(suggestion), suggestion }); }
    if (request.method === 'POST' && /^\/api\/sales\/sessions\/[^/]+\/finish$/.test(request.url)) { const body=await readBody(request); const id=decodeURIComponent(request.url.split('/')[4]); const session=sales.finish(id,body); if(session)syncSession(id); return json(response,session?200:404,{ ok:Boolean(session), session }); }
    if (request.method === 'PUT' && /^\/api\/sales\/sessions\/[^/]+\/progress$/.test(request.url)) { const body=await readBody(request); const id=decodeURIComponent(request.url.split('/')[4]); const session=sales.updateProgress(id,body); return json(response,session?200:404,{ ok:Boolean(session), session }); }
    if (request.method === 'PUT' && /^\/api\/sales\/phases\/[^/]+$/.test(request.url)) { const body=await readBody(request); const id=decodeURIComponent(request.url.split('/')[4]); const phase=sales.updatePhase(id,body); if(phase)syncLibraries(); return json(response,phase?200:404,{ ok:Boolean(phase), phase }); }
    if (request.method === 'PUT' && /^\/api\/sales\/talk-scripts\/[^/]+$/.test(request.url)) { const body=await readBody(request); const id=decodeURIComponent(request.url.split('/')[4]); const script=sales.updateTalkScript(id,body); if(script)syncLibraries(); return json(response,script?200:404,{ok:Boolean(script),script}); }
    if (request.method === 'GET' && /^\/api\/fs\/deals(\?|$)/.test(request.url)) { const url=new URL(request.url,'http://127.0.0.1'); const scope=url.searchParams.get('scope')||'active'; return json(response,200,{ ok:true, deals:scope==='finished'?sales.finishedDeals():scope==='all'?sales.deals():sales.activeDeals() }); }
    if (request.method === 'GET' && /^\/api\/fs\/deals\/[^/?]+$/.test(request.url)) { const id=decodeURIComponent(request.url.split('/')[4]); const detail=sales.deal(id); return json(response,detail?200:404,{ ok:Boolean(detail), ...(detail||{ text:'案件が見つかりません' }) }); }
    if (request.method === 'PUT' && /^\/api\/fs\/deals\/[^/?]+$/.test(request.url)) { const body=await readBody(request); const id=decodeURIComponent(request.url.split('/')[4]); const target=sales.deal(id); const updated=target?.preparation?sales.editPreparation(target.preparation.id,body):null; if(updated)syncPreparation(updated.id); return json(response,updated?200:404,{ ok:Boolean(updated), preparation:updated }); }
    if (request.method === 'DELETE' && /^\/api\/fs\/deals\/[^/?]+$/.test(request.url)) { const id=decodeURIComponent(request.url.split('/')[4]); const removed=sales.deleteDeal(id,{ actor:'FS' }); return json(response,removed?200:404,{ ok:Boolean(removed), removed:removed&&{ ...removed, ...removeArchive(removed) }, ...(removed?{}:{ text:'案件が見つかりません' }) }); }
    if (request.method === 'GET' && /^\/api\/fs\/meetings\/[^/]+\/memos$/.test(request.url)) { const id=decodeURIComponent(request.url.split('/')[4]); const memos=sales.meetingMemos(id); return json(response,memos?200:404,{ ok:Boolean(memos), memos:memos||[], memoDraft:sales.session(id)?.memo_draft||'' }); }
    if (request.method === 'POST' && /^\/api\/fs\/meetings\/[^/]+\/memos$/.test(request.url)) { const body=await readBody(request); const id=decodeURIComponent(request.url.split('/')[4]); const memo=sales.addMeetingMemo(id,body); if(memo)syncSession(id); return json(response,memo?201:404,{ ok:Boolean(memo), memo }); }
    if (request.method === 'PUT' && /^\/api\/fs\/meetings\/[^/]+\/memo-draft$/.test(request.url)) { const body=await readBody(request); const id=decodeURIComponent(request.url.split('/')[4]); const saved=sales.saveMemoDraft(id,body.content); return json(response,saved?200:404,{ ok:Boolean(saved), ...(saved||{}) }); }
    if (request.method === 'POST' && /^\/api\/fs\/meetings\/[^/]+\/interrupt$/.test(request.url)) { const body=await readBody(request); const id=decodeURIComponent(request.url.split('/')[4]); const session=sales.interrupt(id,body); if(session)syncSession(id); return json(response,session?200:404,{ ok:Boolean(session), session }); }
    if (request.method === 'GET' && /^\/api\/fs\/materials(\?|$)/.test(request.url)) {
      const url = new URL(request.url, 'http://127.0.0.1');
      const active = url.searchParams.get('active');
      return json(response, 200, { ok:true, materials:materials.list({
        viewer:viewerOf(url), category:url.searchParams.get('category') || '', product:url.searchParams.get('product') || '',
        keyword:url.searchParams.get('keyword') || '', active:active === null ? undefined : active !== 'false'
      }) });
    }
    if (request.method === 'GET' && /^\/api\/fs\/meetings\/[^/]+\/materials(\?|$)/.test(request.url)) {
      const url = new URL(request.url, 'http://127.0.0.1');
      const id = decodeURIComponent(url.pathname.split('/')[4]);
      const session = sales.session(id);
      if (!session) return json(response, 404, { ok:false, text:'商談が見つかりません' });
      const result = materials.phaseMaterials({
        phaseId:url.searchParams.get('phaseId') || session.current_phase,
        phaseTagMap:phaseTagMap(session.talk_script_id),
        products:session.context_data?.targetProducts || '',
        viewer:viewerOf(url), limit:Number(url.searchParams.get('limit')) || 4
      });
      return json(response, 200, { ok:true, ...result });
    }
    if (request.method === 'POST' && request.url === '/api/fs/materials/import') { const body = await readBody(request); const result = materials.importAll(body.materials || [], { actor:body.actor || 'FS' }); return json(response, result.errors.length ? 400 : 200, { ok:!result.errors.length, ...result, text:result.errors.join('\n') }); }
    // 不正なURLやIDは400で返す（500にせず入力の誤りとして扱う）
    if (request.method === 'POST' && request.url === '/api/fs/materials') { const body = await readBody(request); try { return json(response, 201, { ok:true, material:materials.save(body) }); } catch (error) { return json(response, 400, { ok:false, text:error.message }); } }
    if (request.method === 'PUT' && /^\/api\/fs\/materials\/[^/?]+$/.test(request.url)) { const body = await readBody(request); const id = decodeURIComponent(request.url.split('/')[4]); const current = materials.get(id, { viewer:'admin' }); if (!current) return json(response, 404, { ok:false, text:'資料が見つかりません' }); try { return json(response, 200, { ok:true, material:materials.save({ ...current, ...body, id }) }); } catch (error) { return json(response, 400, { ok:false, text:error.message }); } }
    if (request.method === 'PATCH' && /^\/api\/fs\/materials\/[^/?]+\/status$/.test(request.url)) { const body = await readBody(request); const id = decodeURIComponent(request.url.split('/')[4]); const material = materials.setActive(id, body.active !== false, body.actor || 'FS'); return json(response, material ? 200 : 404, { ok:Boolean(material), material, ...(material ? {} : { text:'資料が見つかりません' }) }); }
    if (request.method === 'POST' && request.url === '/api/chat') { const body = await readBody(request); return json(response, 200, { ok: true, ...(await chat(body.message)) }); }
    const pathname = request.url === '/' ? '/index.html' : request.url;
    const file = path.resolve(publicDir, `.${pathname}`);
    if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); return response.end('Not found'); }
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(response);
  } catch (error) {
    const message = /未対応のaction/.test(error.message)
      ? 'GAS Webアプリが更新前の版です。最新の headless-automation.gs を反映して再デプロイすると、この機能を利用できます。'
      : `エラーが発生しました。\n${error.message}`;
    json(response, 500, { ok: false, text: message });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`HD AI Assistant: http://127.0.0.1:${port}`));
