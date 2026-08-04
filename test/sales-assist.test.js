import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SalesAssistStore, safeUrl, buildContext, dealStatus } from '../src/sales-assist.js';
import { ObsidianSalesArchive } from '../src/obsidian-sales-archive.js';

function withStore(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-sales-assist-'));
  const store = new SalesAssistStore(path.join(directory, 'sales.sqlite'));
  try { run(store); } finally { store.close(); fs.rmSync(directory, { recursive:true, force:true }); }
}

test('承認済みフェーズとアウト返し3件をAIなしで利用できる', () => withStore(store => {
  assert.equal(store.phases().length, 15);
  assert.equal(store.catalog().applicationGuide.sections.length,8);
  const session = store.start({ staffId:'テスト担当', customerName:'テスト店舗' });
  const suggestion = store.suggest({
    sessionId:session.id,
    phaseId:'free_conditions',
    objectionId:'free_distrust',
    statement:'無料なのが怪しい'
  });
  assert.equal(suggestion.aiUsed, false);
  assert.equal(suggestion.candidates.length, 3);
  assert.ok(suggestion.candidates.every(item => item.source_id.startsWith('approved:')));
  assert.equal(store.useSuggestion(suggestion.id, 1).used, 1);
}));

test('禁止表現を検知し商談結果を保存できる', () => withStore(store => {
  const session = store.start({ customerName:'テスト店舗' });
  const suggestion = store.suggest({
    sessionId:session.id,
    phaseId:'free_conditions',
    objectionId:'electricity_satisfied',
    statement:'絶対に安くなると説明した'
  });
  assert.deepEqual(suggestion.warnings, ['絶対に安くなる']);
  const finished = store.finish(session.id, { result:'再商談', nextAction:'来週確認', notes:'明細待ち' });
  assert.equal(finished.result, '再商談');
  assert.ok(finished.finished_at);
}));

test('管理者の変更でバージョンと監査履歴が更新される', () => withStore(store => {
  const before = store.phases().find(item => item.id === 'agenda');
  const after = store.updatePhase('agenda', {
    actor:'管理者', goal:'更新後の目的', baseScript:before.base_script,
    requiredQuestions:before.required_questions,
    transitionConditions:before.transition_conditions,
    prohibitedPhrases:before.prohibited_phrases
  });
  assert.equal(after.version, before.version + 1);
  assert.equal(after.goal, '更新後の目的');
  assert.equal(store.db.prepare('SELECT COUNT(*) count FROM audit_logs').get().count, 1);
}));

test('トークスクリプト名を変更すると再読込後も変更名を保持する', () => withStore(store => {
  const renamed=store.updateTalkScript('hd-new-ap-20260725',{name:'前川専用・新AP商談トーク',actor:'管理者'});
  assert.equal(renamed.name,'前川専用・新AP商談トーク');
  assert.equal(renamed.title_customized,1);
  store.seed();
  assert.equal(store.catalog().scripts.find(item=>item.id==='hd-new-ap-20260725').name,'前川専用・新AP商談トーク');
  const audit=store.db.prepare("SELECT * FROM audit_logs WHERE action='rename' AND entity_type='talk_script'").get();
  assert.ok(audit);
}));

test('ローカルで追加したトークスクリプトを再読込後も準備と商談に使用できる', () => withStore(store => {
  const created=store.createTalkScript({
    name:'IS新アポ向けトーク',products:'ホームページ無料制作、エネパル',
    customerType:'飲食店オーナー',version:'2026/07/30',actor:'管理者'
  });
  assert.match(created.id,/^hd-local-/);
  assert.deepEqual(created.products,['ホームページ無料制作','エネパル']);
  assert.equal(created.phase_count,15);
  assert.equal(created.local_created,1);
  store.seed();
  assert.equal(store.catalog().scripts.find(item=>item.id===created.id).name,'IS新アポ向けトーク');
  assert.equal(store.prepare({talkScriptId:created.id,customerName:'追加テスト'}).talk_script_id,created.id);
  assert.equal(store.start({talkScriptId:created.id,customerName:'追加テスト'}).talk_script_version,'2026/07/30');
}));

test('前のステップへ戻ってもHPの役割・確認状態・メモを保持する', () => withStore(store => {
  const session = store.start({ customerName:'保持テスト', ownerName:'山田' });
  store.updateProgress(session.id, {
    currentPhase:'hp_role',
    contextData:{ hpRole:'予約判断に必要な公式情報をまとめること' },
    stepState:{ agenda:[0,1,2,3], hp_role:[0,1] },
    notes:'決裁者は本人'
  });
  store.updateProgress(session.id, { currentPhase:'future' });
  const restored = store.session(session.id);
  assert.equal(restored.current_phase, 'future');
  assert.equal(restored.context_data.hpRole, '予約判断に必要な公式情報をまとめること');
  assert.deepEqual(restored.step_state.hp_role, [0,1]);
  assert.equal(restored.notes, '決裁者は本人');
}));

test('公開中スクリプトだけで商談を開始し使用バージョンを履歴へ固定する', () => withStore(store => {
  const catalog = store.catalog();
  assert.equal(catalog.departments.length, 3);
  assert.equal(catalog.scripts.filter(item => item.status === 'published').length, 1);
  const session = store.start({ departmentId:'hd', talkScriptId:'hd-new-ap-20260725', customerName:'版管理テスト' });
  assert.equal(session.department_id, 'hd');
  assert.equal(session.talk_script_id, 'hd-new-ap-20260725');
  assert.equal(session.talk_script_version, '2026/07/25');
  assert.throws(() => store.start({ talkScriptId:'hd-hp-delivery' }), /公開中/);
}));

test('質問ごとの回答・発言・補足・AI整理をフェーズ移動後も保持する', () => withStore(store => {
  const session=store.start({talkScriptId:'hd-new-ap-20260725',customerName:'取材メモ店舗'});
  const noteState={checked:[0],notes:{0:{answer:'取材アポと認識',verbatim:'聞いています',supplement:'反応良好',deepQuestion:'決裁者は誰か',later:false,proposal:true,aiSummary:'認識一致',aiHint:'決裁者確認が必要'}}};
  store.updateProgress(session.id,{currentPhase:'iv_company',stepState:{iv_agenda:noteState}});
  store.updateProgress(session.id,{currentPhase:'iv_agenda'});
  assert.deepEqual(store.session(session.id).step_state.iv_agenda,noteState);
}));

test('ローカルスクリプトへ専用フェーズを登録し内容編集できる', () => withStore(store => {
  const script=store.createTalkScript({name:'取材用トーク',products:'HP無料制作',version:'2026/07/30'});
  store.replaceTalkScriptPhases(script.id,[
    {id:`${script.id}-01`,order:1,group:'①',name:'挨拶・前提のすり合わせ',goal:'認識を合わせる',script:'読み上げ本文',questions:['認識のズレ'],transition:'認識が合えば次へ'},
    {id:`${script.id}-02`,order:2,group:'②',name:'本日のアジェンダ',goal:'流れを伝える',script:'アジェンダ本文',questions:['流れへの了承'],transition:'了承後に次へ'}
  ],{version:'2026/07/31'});
  assert.equal(store.phases(script.id).length,2);
  assert.equal(store.catalog().scripts.find(item=>item.id===script.id).version,'2026/07/31');
  const updated=store.updatePhase(`${script.id}-01`,{goal:'更新目的',baseScript:'更新本文',requiredQuestions:['確認'],transitionConditions:'次へ',prohibitedPhrases:[],actor:'管理者'});
  assert.equal(updated.goal,'更新目的');
  assert.equal(updated.version,2);
}));

test('商談準備案件を開くと保存時のスクリプトとISアポ内容で商談を開始する', () => withStore(store => {
  const prepared = store.prepare({
    talkScriptId:'hd-new-ap-20260725', staffId:'前川', customerName:'準備店舗',
    ownerName:'佐藤', appointmentPattern:'経費削減プログラムとして取得',
    handoff:'HP無料制作に興味あり', meetingAt:'2026-08-01T14:00',
    temperature:'中：無料なら興味あり・条件次第',
    issues:'Instagramから予約までの導線が弱い',
    hookPoints:'公式情報をまとめて予約判断を助ける'
  });
  assert.equal(store.preparations().length, 1);
  const session = store.openPreparation(prepared.id);
  assert.equal(session.customer_name, '準備店舗');
  assert.equal(session.talk_script_id, 'hd-new-ap-20260725');
  assert.equal(session.talk_script_version, '2026/07/25');
  assert.equal(session.context_data.appointmentPattern, '経費削減プログラムとして取得');
  assert.equal(session.context_data.temperature, '中：無料なら興味あり・条件次第');
  assert.match(session.context_data.issues, /予約/);
  assert.match(session.context_data.hookPoints, /公式情報/);
  assert.equal(store.openPreparation(prepared.id).id, session.id);
  const updated = store.updatePreparation(prepared.id, { nextAction:'ISへ追加確認', nextActionAt:'2026-07-30T10:00', actor:'前川' });
  assert.equal(updated.next_action, 'ISへ追加確認');
  assert.equal(updated.next_action_at, '2026-07-30T10:00');
}));

test('商談中の言質・HP目的・ログとアウト履歴をリアルタイム保存する', () => withStore(store => {
  const session=store.start({talkScriptId:'hd-new-ap-20260725',customerName:'記録店舗'});
  store.addFact(session.id,{category:'commitment',value:'条件に問題がなければ作りたい'});
  store.addFact(session.id,{category:'hp_purpose',value:'HPの刷新＋予約フォーム'});
  store.addFact(session.id,{category:'hp_details',value:'ウェブ上で予約を管理したい'});
  store.suggest({sessionId:session.id,phaseId:'free_conditions',objectionId:'free_distrust',statement:'本当に無料なの？'});
  const record=store.sessionRecord(session.id);
  assert.equal(record.facts.length,3);
  assert.equal(record.objections.length,1);
  assert.equal(record.objections[0].customer_statement,'本当に無料なの？');
}));

test('殴り書きメモから来そうなアウトを予測しトーク別に蓄積する', () => withStore(store => {
  const session=store.start({talkScriptId:'hd-new-ap-20260725',customerName:'アウト予測店舗'});
  const note=store.addObjectionNote('hd-new-ap-20260725',{sessionId:session.id,phaseId:'free_conditions',memo:'本当に無料なのか疑っている。HP自体は作りたい。今の電気会社から変えたくなく、奥様にも相談が必要。'});
  assert.deepEqual(note.predicted_objections.map(item=>item.id),['free_distrust','electricity_satisfied','decision_maker']);
  assert.ok(note.predicted_objections.every(item=>item.responseText&&item.nextQuestion));
  assert.match(note.reaction_summary,/慎重/);
  assert.deepEqual(note.commitments,['HP自体は作りたい']);
  assert.equal(note.objection_signals.length,2);
  const saved=store.objectionNotes('hd-new-ap-20260725');
  assert.equal(saved.length,1);
  assert.equal(saved[0].memo,note.memo);
}));

test('商談準備で店舗情報・リンク・IS備考を保存し各種案件用へ表示する', () => withStore(store => {
  const prepared = store.prepare({
    talkScriptId:'hd-new-ap-20260725', staffId:'前川', isPerson:'佐々木',
    customerName:'スナック MIRAI', ownerName:'サイトウ', meetingAt:'2026-08-05T14:00',
    targetProducts:'ホームページ無料制作、エネパル',
    isNotes:'電気切替に懸念あり。知り合いのガス会社へ相談予定。',
    websiteUrl:'example.com', instagramUrl:'https://www.instagram.com/mirai/',
    googleMapsUrl:'https://maps.app.goo.gl/abc', snsUrl:'https://x.com/mirai',
    referenceUrl:'javascript:alert(1)'
  });
  assert.match(prepared.deal_id, /^deal_/);
  assert.equal(prepared.context_data.isPerson, '佐々木');
  assert.equal(prepared.context_data.isNotes, '電気切替に懸念あり。知り合いのガス会社へ相談予定。');
  assert.equal(prepared.context_data.websiteUrl, 'https://example.com/');
  assert.equal(prepared.context_data.referenceUrl, '', 'http/https以外のURLは保存しない');
  assert.deepEqual(prepared.context_data.otherLinks, [{ label:'その他SNS', url:'https://x.com/mirai' }]);

  const [deal] = store.activeDeals();
  assert.equal(deal.storeName, 'スナック MIRAI');
  assert.equal(deal.status, '商談予定');
  assert.equal(deal.isPerson, '佐々木');
  assert.equal(deal.instagramUrl, 'https://www.instagram.com/mirai/');
  assert.equal(store.deal(deal.dealId).deal.dealId, deal.dealId);
  assert.equal(store.deal(prepared.id).deal.storeName, 'スナック MIRAI');
}));

test('商談メモを追加・復元し、他案件のメモへ混入しない', () => withStore(store => {
  const first = store.start({ talkScriptId:'hd-new-ap-20260725', customerName:'メモ店舗A' });
  const second = store.start({ talkScriptId:'hd-new-ap-20260725', customerName:'メモ店舗B' });
  const xss = '<img src=x onerror="alert(1)">HP自体は作りたい';
  const memo = store.addMeetingMemo(first.id, { phaseId:'hp_role', content:xss });
  assert.match(memo.id, /^memo_/);
  assert.equal(memo.meeting_id, first.id);
  assert.equal(memo.phase_id, 'hp_role');
  assert.equal(memo.content, xss, 'メモは加工せずそのまま保存する');
  store.addMeetingMemo(second.id, { phaseId:'agenda', content:'別案件のメモ' });
  assert.deepEqual(store.meetingMemos(first.id).map(item => item.content), [xss]);
  assert.equal(store.addMeetingMemo('存在しない商談', { content:'混入テスト' }), null);
  assert.equal(store.meetingMemos('存在しない商談'), null);
  assert.throws(() => store.addMeetingMemo(first.id, { content:'   ' }), /メモ/);

  store.saveMemoDraft(first.id, '入力途中のメモ');
  assert.equal(store.session(first.id).memo_draft, '入力途中のメモ');
  assert.equal(store.saveMemoDraft('存在しない商談', 'x'), null);
  // フェーズ移動後もメモは残る
  store.updateProgress(first.id, { currentPhase:'free_conditions' });
  assert.equal(store.meetingMemos(first.id).length, 1);
  assert.equal(store.deal(first.id).memoDraft, '入力途中のメモ');
}));

test('中断した商談を再開でき、終了後は結果一覧へ移る', () => withStore(store => {
  const prepared = store.prepare({ talkScriptId:'hd-new-ap-20260725', customerName:'中断テスト', meetingAt:'2026-08-05T14:00' });
  const session = store.openPreparation(prepared.id);
  assert.equal(store.activeDeals()[0].status, '商談中');
  store.interrupt(session.id, { currentPhase:'hearing' });
  assert.equal(store.activeDeals()[0].status, '商談中断');
  assert.equal(store.activeDeals()[0].currentPhaseName, '③-3 店舗ヒアリング');
  const resumed = store.openPreparation(prepared.id);
  assert.equal(resumed.id, session.id);
  assert.equal(store.activeDeals()[0].status, '商談中');
  store.finish(session.id, { result:'明細確認へ進む', forecast:'A：今月獲得見込み', reflection:'HPの役割づくりに時間をかけた', notes:'明細待ち' });
  assert.equal(store.activeDeals().length, 0);
  const [finished] = store.finishedDeals();
  assert.equal(finished.status, '商談完了');
  assert.equal(finished.forecast, 'A：今月獲得見込み');
  assert.equal(finished.reflection, 'HPの役割づくりに時間をかけた');
  assert.equal(store.interrupt(session.id), null, '終了済みの商談は中断できない');
}));

test('案件情報を編集すると進行中の商談へ反映し、終了後はスナップショットを残す', () => withStore(store => {
  const prepared = store.prepare({ talkScriptId:'hd-new-ap-20260725', customerName:'反映テスト', isNotes:'初回のIS備考' });
  const session = store.openPreparation(prepared.id);
  store.editPreparation(prepared.id, { isNotes:'修正後のIS備考', websiteUrl:'https://example.jp', actor:'前川' });
  assert.equal(store.deal(prepared.deal_id).deal.isNotes, '修正後のIS備考');
  assert.equal(store.deal(prepared.deal_id).deal.websiteUrl, 'https://example.jp/');
  store.finish(session.id, { result:'失注' });
  const finished = store.deal(prepared.deal_id).deal;
  assert.equal(finished.status, '失注');
  assert.equal(finished.isNotes, '初回のIS備考', '終了後は商談当時のスナップショットを表示する');
}));

test('間違えて保存した案件を商談記録ごと削除でき、他案件は残る', () => withStore(store => {
  const keep = store.prepare({ talkScriptId:'hd-new-ap-20260725', customerName:'残す店舗' });
  const wrong = store.prepare({ talkScriptId:'hd-new-ap-20260725', customerName:'重複保存した店舗' });
  const session = store.openPreparation(wrong.id);
  store.addMeetingMemo(session.id, { content:'誤って開始した商談のメモ' });
  store.addFact(session.id, { category:'commitment', value:'誤登録' });
  store.suggest({ sessionId:session.id, phaseId:'free_conditions', objectionId:'free_distrust', statement:'誤登録' });
  store.addObjectionNote(session.talk_script_id, { sessionId:session.id, memo:'誤登録のメモ' });
  assert.equal(store.deals().length, 2);

  const removed = store.deleteDeal(wrong.deal_id, { actor:'前川' });
  assert.equal(removed.storeName, '重複保存した店舗');
  assert.equal(removed.memos, 1);
  assert.equal(removed.facts, 1);
  assert.equal(removed.objections, 1);
  assert.equal(removed.notes, 1);

  const remaining = store.deals();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].storeName, '残す店舗');
  assert.equal(store.deal(wrong.deal_id), null);
  assert.equal(store.session(session.id), null);
  assert.equal(store.meetingMemos(session.id), null);
  assert.equal(store.sessionRecord(session.id).facts.length, 0);
  assert.equal(store.objectionNotes(session.talk_script_id).length, 0);
  assert.ok(store.deal(keep.deal_id), '他の案件は残る');
  assert.equal(store.deleteDeal('存在しないID'), null);
  assert.ok(store.db.prepare("SELECT * FROM audit_logs WHERE action='delete' AND entity_type='sales_deal'").get());
}));

test('商談を開始していない案件も削除できる', () => withStore(store => {
  const prepared = store.prepare({ talkScriptId:'hd-new-ap-20260725', customerName:'商談前の誤登録' });
  const removed = store.deleteDeal(prepared.id);
  assert.equal(removed.sessionId, '');
  assert.equal(removed.memos, 0);
  assert.equal(store.deals().length, 0);
  assert.equal(store.preparation(prepared.id), null);
}));

test('URL検証とステータス判定が要件どおり動く', () => {
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeUrl('example.com'), 'https://example.com/');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('data:text/html,<script>'), '');
  assert.equal(safeUrl(''), '');
  assert.deepEqual(buildContext({ otherLinks:['https://a.example', 'ftp://b.example'] }).otherLinks, [{ label:'参考リンク', url:'https://a.example/' }]);
  assert.equal(dealStatus({ session:null, meetingAt:'' }), '商談準備中');
  assert.equal(dealStatus({ session:null, meetingAt:'2026-08-05T14:00' }), '商談予定');
  assert.equal(dealStatus({ session:{ started_at:'x' } }), '商談中');
  assert.equal(dealStatus({ session:{ interrupted_at:'x' } }), '商談中断');
  assert.equal(dealStatus({ session:{ finished_at:'x', result:'再商談' } }), '次回対応待ち');
  assert.equal(dealStatus({ session:{ finished_at:'x', result:'失注' } }), '失注');
  assert.equal(dealStatus({ preparationStatus:'cancelled', session:null }), 'キャンセル');
});

test('商談準備と商談記録をObsidian Markdownへ保存できる', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hd-obsidian-sales-'));
  const vault=path.join(directory,'vault');
  const obsidianConfig=path.join(directory,'obsidian.json');
  fs.mkdirSync(vault,{recursive:true});
  fs.writeFileSync(obsidianConfig,JSON.stringify({vaults:{test:{path:vault}}}));
  const store=new SalesAssistStore(path.join(directory,'sales.sqlite'));
  try {
    const archive=new ObsidianSalesArchive({vaultId:'test',folder:'HD',obsidianConfigPath:obsidianConfig});
    const prepared=store.prepare({customerName:'保存テスト',handoff:'IS引き継ぎ本文'});
    assert.ok(fs.existsSync(archive.syncPreparation(store,prepared.id)));
    const session=store.openPreparation(prepared.id);
    store.addFact(session.id,{category:'commitment',value:'条件が合えば進めたい'});
    store.addObjectionNote(session.talk_script_id,{sessionId:session.id,memo:'無料なのか疑っている。条件が合えば進めたい。'});
    const target=archive.syncSession(store,session.id);
    const markdown=fs.readFileSync(target,'utf8');
    assert.match(markdown,/IS引き継ぎ本文/);
    assert.match(markdown,/条件が合えば進めたい/);
    assert.match(markdown,/無料なのか疑っている/);
    const libraryFiles=archive.syncLibraries(store);
    assert.ok(libraryFiles.some(file=>file.includes('各種スクリプト')));
    assert.ok(libraryFiles.some(file=>file.includes('アウト返し集')));
    assert.match(fs.readFileSync(libraryFiles.find(file=>file.includes('アウト返し集')),'utf8'),/無料なのか疑っている/);
  } finally {
    store.close();
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
