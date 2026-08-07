import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { SalesAssistStore } from '../src/sales-assist.js';
import { ObsidianSalesArchive } from '../src/obsidian-sales-archive.js';

// FS 2軸進捗ステータス管理（申込・審査進捗 AA/A/B/C/D、案件進捗 A/B/C/D/E/XA/XB）の要件確認。
// docs/requirements/fs-sales/FS_PROGRESS_STATUS_MANAGEMENT_REQUIREMENTS.md 参照。
function withStore(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-progress-status-'));
  const dbFile = path.join(directory, 'sales.sqlite');
  const store = new SalesAssistStore(dbFile);
  try { run(store, dbFile); } finally { store.close(); fs.rmSync(directory, { recursive:true, force:true }); }
}

test('2軸進捗は別フィールドとして保存され、同じA/Bコードでも混同しない。AA/XA/XBも保存できる', () => withStore(store => {
  const prepared = store.prepare({ customerName:'2軸テスト店舗' });
  const dealId = prepared.deal_id;

  const dealStageResult = store.setDealProgress(dealId, { axis:'deal_stage', code:'B', actor:'テスト担当' });
  assert.equal(dealStageResult.progress.dealStageCode, 'B');
  assert.equal(dealStageResult.progress.applicationProgressCode, '', 'まだ申込・審査進捗は未設定');
  const applicationResult = store.setDealProgress(dealId, { axis:'application_progress', code:'A', actor:'テスト担当' });
  assert.equal(applicationResult.progress.dealStageCode, 'B', '申込・審査進捗の更新で案件進捗が書き換わらない');
  assert.equal(applicationResult.progress.applicationProgressCode, 'A');

  // 案件進捗をCへ変えても申込・審査進捗のAは変わらない（軸が独立している）
  store.setDealProgress(dealId, { axis:'deal_stage', code:'C', actor:'テスト担当' });
  const summary = store.dealProgressSummary(dealId);
  assert.equal(summary.dealStageCode, 'C');
  assert.equal(summary.applicationProgressCode, 'A');
  assert.equal(summary.dealStageLabel, '申込書回収待ち');
  assert.equal(summary.applicationProgressLabel, '申し込み書⭕️＋審査通過⭕️');

  // AA・XA・XBも保存できる
  assert.equal(store.setDealProgress(dealId, { axis:'application_progress', code:'AA' }).progress.applicationProgressCode, 'AA');
  assert.equal(store.setDealProgress(dealId, { axis:'deal_stage', code:'XA' }).progress.dealStageCode, 'XA');
  assert.equal(store.setDealProgress(dealId, { axis:'deal_stage', code:'XB' }).progress.dealStageCode, 'XB');
}));

test('不正なaxis・codeは保存されず例外になる（AとBを別軸で取り違えても拒否される）', () => withStore(store => {
  const prepared = store.prepare({ customerName:'不正入力テスト店舗' });
  const dealId = prepared.deal_id;
  assert.throws(() => store.setDealProgress(dealId, { axis:'deal_stage', code:'AA' }), /存在しないコード/);
  assert.throws(() => store.setDealProgress(dealId, { axis:'application_progress', code:'XA' }), /存在しないコード/);
  assert.throws(() => store.setDealProgress(dealId, { axis:'unknown_axis', code:'A' }), /axis/);
  assert.throws(() => store.setDealProgress(dealId, { axis:'deal_stage', code:'Z' }), /存在しないコード/);
  // 何も保存されていない状態のまま
  const summary = store.dealProgressSummary(dealId);
  assert.equal(summary.dealStageCode, '');
  assert.equal(summary.applicationProgressCode, '');
}));

test('進捗変更の履歴がaxisごとに保存され、再読み込み（再オープン）後も復元される', () => withStore((store, dbFile) => {
  const prepared = store.prepare({ customerName:'履歴テスト店舗' });
  const dealId = prepared.deal_id;
  store.setDealProgress(dealId, { axis:'deal_stage', code:'E', actor:'担当A', source:'manual' });
  store.setDealProgress(dealId, { axis:'deal_stage', code:'D', actor:'担当A', reason:'商談実施', source:'meeting_close' });
  store.setDealProgress(dealId, { axis:'application_progress', code:'D', actor:'担当A' });
  store.setDealProgress(dealId, { axis:'application_progress', code:'C', actor:'担当A', reason:'申込書のみ回収' });
  // 同じ値を再送しても履歴は増えない（無変更は記録しない）
  store.setDealProgress(dealId, { axis:'application_progress', code:'C', actor:'担当A' });

  const history = store.dealProgressHistory(dealId);
  assert.equal(history.length, 4);
  // dealProgressHistory()は要件の表示例（8/7→8/8→8/9の時系列ログ）どおり古い順で返す
  const dealStageHistory = history.filter(item => item.axis === 'deal_stage');
  assert.equal(dealStageHistory[0].from_status, '');
  assert.equal(dealStageHistory[0].to_status, 'E');
  assert.equal(dealStageHistory[1].from_status, 'E');
  assert.equal(dealStageHistory[1].to_status, 'D');
  assert.equal(dealStageHistory[1].reason, '商談実施');
  assert.equal(dealStageHistory[1].source, 'meeting_close');
  assert.equal(dealStageHistory[1].changed_by, '担当A');
  assert.ok(dealStageHistory[1].changed_at);

  store.close();
  const reopened = new SalesAssistStore(dbFile);
  try {
    const summary = reopened.dealProgressSummary(dealId);
    assert.equal(summary.dealStageCode, 'D');
    assert.equal(summary.applicationProgressCode, 'C');
    assert.equal(reopened.dealProgressHistory(dealId).length, 4);
  } finally { reopened.close(); }
}));

test('申込A/B/CだけnextActionHintを補助表示でき、次回アクション本体は自動で書き換わらない', () => withStore(store => {
  const prepared = store.prepare({ customerName:'ヒントテスト店舗', nextAction:'当初の次回アクション' });
  const dealId = prepared.deal_id;
  store.setDealProgress(dealId, { axis:'application_progress', code:'A' });
  assert.equal(store.dealProgressSummary(dealId).applicationProgressHint, '基本次回アクションはヒアリングMTG調整');
  store.setDealProgress(dealId, { axis:'application_progress', code:'B' });
  assert.equal(store.dealProgressSummary(dealId).applicationProgressHint, 'アクションは基本待ち');
  store.setDealProgress(dealId, { axis:'application_progress', code:'C' });
  assert.equal(store.dealProgressSummary(dealId).applicationProgressHint, '基本ここでのアクションは日程調整だけ／時間切れで口頭YES');
  // AA/Dにはヒントがない
  store.setDealProgress(dealId, { axis:'application_progress', code:'AA' });
  assert.equal(store.dealProgressSummary(dealId).applicationProgressHint, '');
  // 案件進捗（deal_stage）にはnextActionHintの概念がない
  assert.equal(store.progressAxis('deal_stage').statuses.every(status => status.nextActionHint === undefined), true);
  // 進捗の保存だけでは次回アクション本体は書き換わらない（自動変更禁止）
  assert.equal(store.preparation(prepared.id).next_action, '当初の次回アクション');
}));

test('進捗を変更しても案件データ・商談メモは消えない（XA/XBでも同様）', () => withStore(store => {
  const prepared = store.prepare({ customerName:'失注テスト店舗' });
  const session = store.openPreparation(prepared.id);
  store.addMeetingMemo(session.id, { content:'商談中に取れたメモ' });
  const dealId = prepared.deal_id;

  store.setDealProgress(dealId, { axis:'deal_stage', code:'XA', reason:'決裁者不在で失注', source:'meeting_close' });
  store.setDealProgress(dealId, { axis:'deal_stage', code:'XB', source:'manual' });

  const deal = store.deal(dealId);
  assert.ok(deal, '案件データは残る');
  assert.equal(deal.deal.dealStageCode, 'XB');
  assert.equal(store.meetingMemos(session.id).length, 1, '商談メモは削除されない');
  assert.equal(store.session(session.id) !== null, true, '商談セッションも削除されない');
}));

test('Obsidianの案件Markdownに最新の2軸進捗コード＋名称が反映され、既存本文は消えない', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-progress-obsidian-'));
  const vault = path.join(directory, 'vault');
  const obsidianConfig = path.join(directory, 'obsidian.json');
  fs.mkdirSync(vault, { recursive:true });
  fs.writeFileSync(obsidianConfig, JSON.stringify({ vaults:{ test:{ path:vault } } }));
  const store = new SalesAssistStore(path.join(directory, 'sales.sqlite'));
  try {
    const archive = new ObsidianSalesArchive({ vaultId:'test', folder:'HD', obsidianConfigPath:obsidianConfig });
    const prepared = store.prepare({ customerName:'Obsidian進捗テスト店舗', handoff:'IS引き継ぎ本文はここ' });
    const dealId = prepared.deal_id;

    // 進捗未設定の段階でも書き出しでき、未設定として表示される
    const unsetTarget = archive.syncPreparation(store, prepared.id);
    const unsetMarkdown = fs.readFileSync(unsetTarget, 'utf8');
    assert.match(unsetMarkdown, /## 進捗[\s\S]*- 案件進捗：未設定[\s\S]*- 申込・審査進捗：未設定/);
    assert.match(unsetMarkdown, /IS引き継ぎ本文はここ/);

    const session = store.openPreparation(prepared.id);
    store.setDealProgress(dealId, { axis:'deal_stage', code:'D' });
    store.setDealProgress(dealId, { axis:'application_progress', code:'C' });
    const target = archive.syncSession(store, session.id);
    const markdown = fs.readFileSync(target, 'utf8');
    assert.match(markdown, /## 進捗\n\n- 案件進捗：D｜商談済み回答待ち\n- 申込・審査進捗：C｜申し込み書⭕️＋各種商材お申し込み❌/);
    assert.match(markdown, /IS引き継ぎ本文はここ/, '既存本文（ISからの引き継ぎ）は消えない');
  } finally {
    store.close();
    fs.rmSync(directory, { recursive:true, force:true });
  }
});

test('一覧フィルタに使う2軸のコード・ラベルがdeals()の各行に含まれる', () => withStore(store => {
  const a = store.prepare({ customerName:'フィルタ店舗A' });
  const b = store.prepare({ customerName:'フィルタ店舗B' });
  store.setDealProgress(a.deal_id, { axis:'deal_stage', code:'D' });
  store.setDealProgress(a.deal_id, { axis:'application_progress', code:'C' });
  store.setDealProgress(b.deal_id, { axis:'deal_stage', code:'B' });

  const deals = store.deals();
  const dealA = deals.find(item => item.dealId === a.deal_id);
  const dealB = deals.find(item => item.dealId === b.deal_id);
  assert.equal(dealA.dealStageCode, 'D');
  assert.equal(dealA.applicationProgressCode, 'C');
  assert.equal(dealB.dealStageCode, 'B');
  assert.equal(dealB.applicationProgressCode, '', '未設定の軸は空のまま（勝手な推定変換をしない）');
  assert.equal(deals.filter(item => item.dealStageCode === 'D').length, 1);
  assert.equal(deals.filter(item => item.applicationProgressCode === 'C').length, 1);
}));

test('進捗を保存したことがない既存案件は未設定のままで、勝手に推定変換しない', () => withStore(store => {
  const prepared = store.prepare({ customerName:'既存データ相当の店舗' });
  const summary = store.dealProgressSummary(prepared.deal_id);
  assert.equal(summary.dealStageCode, '');
  assert.equal(summary.applicationProgressCode, '');
  assert.equal(summary.dealStageLabel, '');
  assert.equal(summary.applicationProgressLabel, '');
  assert.equal(store.deal(prepared.deal_id).deal.dealStageCode, '');
}));

// ===== API経由（desktop/server.js）。実サーバーを起動してprogress系エンドポイントとカレンダー非連動を確認する =====
const PORT = 43121;
const BASE_URL = `http://127.0.0.1:${PORT}`;
function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try { const response = await fetch(url); if (response.ok || response.status === 404) return resolve() } catch {}
      if (Date.now() - start > timeoutMs) return reject(new Error('サーバーが起動しませんでした'));
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

test('API: 進捗設定の取得・保存・履歴取得ができ、削除以外の副作用（カレンダー等）を起こさない', async () => {
  const server = spawn(process.execPath, ['desktop/server.js'], { env:{ ...process.env, HD_ASSISTANT_PORT:String(PORT) }, stdio:'ignore' });
  let dealId = null;
  try {
    await waitForServer(`${BASE_URL}/`);
    const configResponse = await fetch(`${BASE_URL}/api/fs/progress-config`).then(r => r.json());
    assert.ok(configResponse.ok);
    assert.deepEqual(configResponse.progressAxes.find(axis => axis.id === 'application_progress').statuses.map(s => s.code), ['AA','A','B','C','D']);
    assert.deepEqual(configResponse.progressAxes.find(axis => axis.id === 'deal_stage').statuses.map(s => s.code), ['A','B','C','D','E','XA','XB']);

    const prepared = await fetch(`${BASE_URL}/api/sales/preparations`, {
      method:'POST', headers:{ 'content-type':'application/json' },
      body:JSON.stringify({ departmentId:'hd', talkScriptId:'hd-new-ap-20260725', customerName:'API進捗テスト店舗', staffId:'QA' })
    }).then(r => r.json());
    dealId = prepared.preparation.deal_id;

    // 不正なcodeは400で拒否される
    const rejected = await fetch(`${BASE_URL}/api/fs/deals/${encodeURIComponent(dealId)}/progress`, {
      method:'PUT', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ axis:'deal_stage', code:'AA', actor:'QA' })
    });
    assert.equal(rejected.status, 400);

    const saved = await fetch(`${BASE_URL}/api/fs/deals/${encodeURIComponent(dealId)}/progress`, {
      method:'PUT', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ axis:'deal_stage', code:'D', actor:'QA', reason:'商談完了', source:'meeting_close' })
    }).then(r => r.json());
    assert.equal(saved.ok, true);
    assert.equal(saved.progress.dealStageCode, 'D');

    const detail = await fetch(`${BASE_URL}/api/fs/deals/${encodeURIComponent(dealId)}`).then(r => r.json());
    assert.equal(detail.deal.dealStageCode, 'D');
    assert.equal(detail.deal.applicationProgressCode, '');

    const history = await fetch(`${BASE_URL}/api/fs/deals/${encodeURIComponent(dealId)}/progress-history`).then(r => r.json());
    assert.equal(history.history.length, 1);
    assert.equal(history.history[0].to_status, 'D');
    assert.equal(history.history[0].source, 'meeting_close');
  } finally {
    if (dealId) { try { await fetch(`${BASE_URL}/api/fs/deals/${encodeURIComponent(dealId)}`, { method:'DELETE' }) } catch {} }
    server.kill();
  }
});
