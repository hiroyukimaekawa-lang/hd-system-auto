import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SalesAssistStore } from '../src/sales-assist.js';
import { ObsidianSalesArchive } from '../src/obsidian-sales-archive.js';
import { normalizeProducts, sourceHash, analyzeMeeting, analysisToText, MEETING_PRODUCTS, NO_PRODUCT_CODE } from '../src/meeting-analysis.js';

function withStore(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-meeting-notes-'));
  const store = new SalesAssistStore(path.join(directory, 'sales.sqlite'));
  try { run(store); } finally { store.close(); fs.rmSync(directory, { recursive:true, force:true }); }
}
const startMeeting = store => store.start({ talkScriptId:'hd-new-ap-20260725', customerName:'メモ改修テスト', staffId:'前川' });

test('商談結果なしで終了でき、過去の商談結果データは残る', () => withStore(store => {
  const past = startMeeting(store);
  store.finish(past.id, { result:'再商談', nextAction:'明細確認' });
  assert.equal(store.session(past.id).result, '再商談');

  const session = startMeeting(store);
  const finished = store.finish(session.id, { nextAction:'明細回収と奥様確認', reflection:'HPの役割づくりに時間をかけた' });
  assert.ok(finished.finished_at, '商談結果なしでも終了できる');
  assert.equal(finished.result, '');
  assert.equal(finished.next_action, '明細回収と奥様確認');
  // 過去データは消さない
  assert.equal(store.session(past.id).result, '再商談');
}));

test('4商材を複数選択して保存でき、提案なしは排他になる', () => withStore(store => {
  const session = startMeeting(store);
  assert.deepEqual(MEETING_PRODUCTS.map(item => item.code), ['enepal','amex','smbc_business_owners','acom_ac_mastercard']);

  assert.deepEqual(store.setMeetingProducts(session.id, ['amex','enepal']), ['enepal','amex']);
  assert.deepEqual(store.meetingProducts(session.id), ['enepal','amex']);
  // 選び直すと前回分は外れる
  assert.deepEqual(store.setMeetingProducts(session.id, ['smbc_business_owners','acom_ac_mastercard']), ['smbc_business_owners','acom_ac_mastercard']);
  assert.deepEqual(store.setMeetingProducts(session.id, [NO_PRODUCT_CODE]), [NO_PRODUCT_CODE]);

  assert.throws(() => store.setMeetingProducts(session.id, ['enepal', NO_PRODUCT_CODE]), /同時に選択できません/);
  assert.throws(() => store.setMeetingProducts(session.id, ['unknown_product']), /扱えない商材/);
  assert.equal(store.setMeetingProducts('存在しない商談', ['enepal']), null);

  // 商談終了時にも保存できる
  const other = startMeeting(store);
  store.finish(other.id, { products:['enepal','amex'], closingMemo:'終了時の追記' });
  assert.deepEqual(store.meetingProducts(other.id), ['enepal','amex']);
  assert.equal(store.notes(other.id).some(note => note.source === 'closing_form' && note.content === '終了時の追記'), true);
  assert.deepEqual(normalizeProducts(['amex','amex']), ['amex']);
}));

test('原文メモを終了後も追記・編集でき、履歴と論理削除が残る', () => withStore(store => {
  const session = startMeeting(store);
  const during = store.addMeetingMemo(session.id, { phaseId:'hp_role', content:'HP自体は作りたい。電気は奥様確認。' });
  assert.equal(during.source, 'during_meeting');
  store.finish(session.id, { nextAction:'明細回収' });

  const after = store.addNote(session.id, { content:'奥様確認済み。明細は本日夕方送付予定。', source:'post_meeting', author:'前川' });
  assert.equal(after.source, 'post_meeting');
  assert.equal(store.notes(session.id).length, 2, '終了後も追記できる');

  // 編集は履歴を残し、原文を消さない
  const edited = store.updateNote(session.id, during.id, { content:'HP自体は作りたい。電気は奥様と一緒に確認。', actor:'前川' });
  assert.match(edited.content, /奥様と一緒に/);
  const revisions = store.noteRevisions(session.id, during.id);
  assert.equal(revisions.length, 1);
  assert.match(revisions[0].content_before, /電気は奥様確認/);
  assert.match(revisions[0].content_after, /奥様と一緒に/);
  assert.equal(revisions[0].edited_by, '前川');
  assert.throws(() => store.updateNote(session.id, during.id, { content:'   ' }), /空にできません/);

  // 論理削除：一覧から消えるがデータは残る
  assert.equal(store.deleteNote(session.id, after.id, '前川').is_deleted, 1);
  assert.equal(store.notes(session.id).length, 1);
  assert.equal(store.notes(session.id, { includeDeleted:true }).length, 2);
  assert.equal(store.meetingMemos(session.id).length, 1, '商談中メモ一覧にも論理削除は出さない');
  assert.equal(store.deleteNote(session.id, after.id), null, '二重削除しない');

  // 他案件のメモは触れない
  const other = startMeeting(store);
  assert.equal(store.note(other.id, during.id), null);
  assert.equal(store.updateNote(other.id, during.id, { content:'横取り' }), null);
  assert.equal(store.deleteNote(other.id, during.id), null);
  assert.equal(store.noteRevisions(other.id, during.id), null);
  assert.match(store.note(session.id, during.id).content, /奥様と一緒に/);
}));

test('メモ更新でAI解析がstaleになり、再解析できる', () => withStore(store => {
  const session = startMeeting(store);
  store.addMeetingMemo(session.id, { phaseId:'hp_role', content:'HP自体は作りたい。電力会社は東北電力。' });
  assert.equal(store.currentAnalysis(session.id), null, '未解析');

  const result = analyzeMeeting({ notes:store.notes(session.id), products:['enepal'], nextAction:'明細回収' });
  const saved = store.saveAnalysis(session.id, { ...result, status:'completed' });
  assert.equal(saved.status, 'completed');
  assert.ok(saved.generated_text.includes('■商談要約'));
  assert.equal(store.currentAnalysis(session.id).status, 'completed');

  // メモを追記すると要再解析になる
  store.addNote(session.id, { content:'明細は後日LINEで送付予定。', source:'post_meeting' });
  assert.equal(store.currentAnalysis(session.id).status, 'stale');

  // 再解析すると最新へ戻る
  store.saveAnalysis(session.id, { ...analyzeMeeting({ notes:store.notes(session.id) }), status:'completed' });
  assert.equal(store.currentAnalysis(session.id).status, 'completed');

  // 商材の変更でもstaleになる
  store.setMeetingProducts(session.id, ['amex']);
  assert.equal(store.currentAnalysis(session.id).status, 'stale');
}));

test('AI解析を担当者が修正でき、再解析で無断上書きしない', () => withStore(store => {
  const session = startMeeting(store);
  store.addMeetingMemo(session.id, { content:'HP自体は作りたい。' });
  const first = store.saveAnalysis(session.id, { ...analyzeMeeting({ notes:store.notes(session.id) }), status:'completed' });

  const edited = store.editAnalysis(session.id, first.id, { text:'担当者が整理し直した内容', actor:'前川' });
  assert.equal(edited.edited_text, '担当者が整理し直した内容');
  assert.equal(edited.edited_by, '前川');
  assert.notEqual(edited.generated_text, edited.edited_text, 'AI生成文と修正版を別に保存する');
  assert.throws(() => store.editAnalysis(session.id, first.id, { text:'  ' }), /空にできません/);

  // 再解析は新しいバージョンとして保存し、前の修正版は履歴として残る
  const second = store.saveAnalysis(session.id, { ...analyzeMeeting({ notes:store.notes(session.id) }), status:'completed' });
  assert.notEqual(second.id, first.id);
  assert.equal(second.edited_text, null);
  const kept = store.db.prepare('SELECT edited_text,is_current FROM meeting_ai_analyses WHERE id=?').get(first.id);
  assert.equal(kept.edited_text, '担当者が整理し直した内容');
  assert.equal(kept.is_current, 0);
  // 他案件の解析は編集できない
  assert.equal(store.editAnalysis(startMeeting(store).id, first.id, { text:'横取り' }), null);
}));

test('AI解析が失敗しても商談記録は残り、商談を終了できる', () => withStore(store => {
  const session = startMeeting(store);
  store.addMeetingMemo(session.id, { content:'記録は残す' });
  const failed = store.saveAnalysis(session.id, { analysis:{}, text:'', status:'failed' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.source_hash, '', '失敗した解析は現在データと結び付けない');

  const finished = store.finish(session.id, { products:['enepal'], nextAction:'再解析後に確認' });
  assert.ok(finished.finished_at);
  assert.equal(store.notes(session.id).length, 1);
  assert.deepEqual(store.meetingProducts(session.id), ['enepal']);
  // AI解析はヨミ・商談結果として保存しない
  assert.equal(finished.forecast, '');
  assert.equal(finished.result, '');
}));

test('AI解析は原文を書き換えず、要件どおりの項目を出す', () => {
  const notes = [
    { id:'n1', content:'現在の電力会社は東北電力。明細は後日LINEで送付予定。' },
    { id:'n2', content:'「HP自体は作りたい」と発言。AMEXに興味あり。' },
    { id:'n3', content:'奥様の同意が必要で相談したいとのこと。' }
  ];
  const { analysis, text } = analyzeMeeting({ notes, products:['enepal','amex'], nextAction:'8月7日夕方に明細送付を確認する', isNotes:'高齢のためオンライン操作に不安あり' });
  assert.equal(notes[0].content, '現在の電力会社は東北電力。明細は後日LINEで送付予定。', '原文を書き換えない');
  for (const heading of ['■商談要約','■確認できた事実','■相手の発言・言質','■懸念・未確認事項','■決裁者・確認者','■商材別の状況','■次に行うこと','■不足している回収情報','■相手の温度感']) {
    assert.ok(text.includes(heading), `${heading} が含まれる`);
  }
  assert.ok(analysis.facts.some(line => /東北電力/.test(line)));
  assert.ok(analysis.commitments.some(line => /作りたい/.test(line)));
  assert.ok(analysis.concerns.some(line => /奥様/.test(line)));
  assert.ok(analysis.productStatus.some(line => /AMEX/.test(line)));
  assert.match(analysis.temperature, /高い|中|低/);
  assert.equal(analysisToText({}), '');

  // メモ・商材・次の行動が変わるとハッシュが変わる
  const base = { notes, products:['enepal'], nextAction:'明細確認' };
  assert.equal(sourceHash(base), sourceHash({ ...base, products:['enepal'] }));
  assert.notEqual(sourceHash(base), sourceHash({ ...base, products:['enepal','amex'] }));
  assert.notEqual(sourceHash(base), sourceHash({ ...base, nextAction:'別の行動' }));
  assert.notEqual(sourceHash(base), sourceHash({ ...base, notes:[...notes, { id:'n4', content:'追記' }] }));
});

test('商材・原文メモ・AI解析・振り返りをObsidianへ保存する', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-obsidian-close-'));
  const vault = path.join(directory, 'vault');
  const obsidianConfig = path.join(directory, 'obsidian.json');
  fs.mkdirSync(vault, { recursive:true });
  fs.writeFileSync(obsidianConfig, JSON.stringify({ vaults:{ test:{ path:vault } } }));
  const store = new SalesAssistStore(path.join(directory, 'sales.sqlite'));
  try {
    const archive = new ObsidianSalesArchive({ vaultId:'test', folder:'HD', obsidianConfigPath:obsidianConfig });
    const session = startMeeting(store);
    store.addMeetingMemo(session.id, { phaseId:'hp_role', content:'「HP自体は作りたい」と発言。' });
    store.finish(session.id, { products:['enepal','amex'], nextAction:'明細回収', closingMemo:'終了時に追記した内容', reflection:'役割づくりに時間をかけた' });
    store.addNote(session.id, { content:'商談後に確認した内容', source:'post_meeting', author:'前川' });
    store.saveAnalysis(session.id, { ...analyzeMeeting({ notes:store.notes(session.id) }), status:'completed' });

    const markdown = fs.readFileSync(archive.syncSession(store, session.id), 'utf8');
    assert.match(markdown, /## 今回扱った商材/);
    assert.match(markdown, /エネパル/);
    assert.match(markdown, /AMEX/);
    assert.match(markdown, /## 商談メモ（原文）/);
    assert.match(markdown, /終了時追記[\s\S]*終了時に追記した内容/);
    assert.match(markdown, /商談後追記[\s\S]*商談後に確認した内容/);
    assert.match(markdown, /## AIによる整理結果/);
    assert.match(markdown, /AI解析は原文メモをもとにした補助情報です/);
    assert.match(markdown, /## 担当者の振り返り[\s\S]*役割づくりに時間をかけた/);

    // 論理削除したメモはObsidianにも出さない
    const removed = store.addNote(session.id, { content:'消すメモ', source:'post_meeting' });
    store.deleteNote(session.id, removed.id, '前川');
    assert.equal(fs.readFileSync(archive.syncSession(store, session.id), 'utf8').includes('消すメモ'), false);

    // 担当者修正版があればそちらを保存する
    store.editAnalysis(session.id, store.currentAnalysis(session.id).id, { text:'担当者が直した整理結果', actor:'前川' });
    const edited = fs.readFileSync(archive.syncSession(store, session.id), 'utf8');
    assert.match(edited, /担当者修正済み/);
    assert.match(edited, /担当者が直した整理結果/);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive:true, force:true });
  }
});
