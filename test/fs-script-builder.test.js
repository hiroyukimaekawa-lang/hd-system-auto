import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { SalesAssistStore } from '../src/sales-assist.js';

function withStore(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-script-builder-'));
  const store = new SalesAssistStore(path.join(directory, 'sales.sqlite'));
  try { run(store); } finally { store.close(); fs.rmSync(directory, { recursive:true, force:true }); }
}

test('2026/08/06版が最新公開・既定版としてseedされ、2026/07/30は物理削除されずarchiveされる', () => withStore(store => {
  const catalog = store.catalog();
  const latest = catalog.scripts.find(item => item.id === 'hd-interview-appointment-20260806');
  assert.ok(latest, '2026/08/06版がカタログに存在する');
  assert.equal(latest.status, 'published');
  assert.equal(latest.default_for_preparation, 1);
  assert.ok(latest.phase_count >= 10 && latest.phase_count <= 12, `10フェーズ前後（実際:${latest.phase_count}）`);
  assert.equal(store.phases('hd-interview-appointment-20260806').length, latest.phase_count);

  const legacy = catalog.scripts.find(item => item.id === 'hp-free-interview-talk');
  assert.ok(legacy, '2026/07/30版はカタログから消えていない（物理削除しない）');
  assert.equal(legacy.status, 'archived');
  assert.equal(store.phases('hp-free-interview-talk').length, 10, 'archive後もフェーズ本文は読める');

  const hpFree = catalog.scripts.find(item => item.id === 'hd-new-ap-20260725');
  assert.equal(hpFree.status, 'published', 'HP無料制作支援金トーク（2026/07/25）は維持される');

  // 新規商談準備の既定は2026/08/06版になる（talkScriptId省略時）
  assert.equal(store.defaultTalkScriptId(), 'hd-interview-appointment-20260806');
  const prepared = store.prepare({ customerName: '既定版テスト店舗' });
  assert.equal(prepared.talk_script_id, 'hd-interview-appointment-20260806');
}));

test('アウト即時相談：自由入力から自動分類し、承認済み/自動候補のバッジを返す', () => withStore(store => {
  const session = store.start({ customerName: 'アウト即時テスト' });
  const matched = store.suggest({ sessionId: session.id, phaseId: 'free_conditions', statement: '無料なのが怪しいと言われた' });
  assert.equal(matched.objection.id, 'free_distrust');
  assert.ok(matched.candidates.length <= 3 && matched.candidates.length > 0);
  assert.ok(matched.candidates.every(item => item.badge === '承認済み'));
  assert.equal(matched.aiUsed, false, '実LLMを使っていないのでAI候補にはならない');

  const unmatched = store.suggest({ sessionId: session.id, phaseId: 'free_conditions', statement: 'あーそうなんですね、なるほど' });
  assert.equal(unmatched.objection.id, 'other');
  assert.ok(unmatched.candidates.every(item => item.badge === '自動候補'));
}));

test('長文貼り付け由来の新規作成はdraftになり、公開するまで一覧の公開扱いにならない（公開済みの破壊上書き防止）', () => withStore(store => {
  const before = store.catalog().scripts.filter(item => item.status === 'published').length;
  const created = store.createTalkScript({
    name: '貼り付けテストトーク', products: 'ホームページ無料制作', version: '2026/08/07',
    status: 'draft', sourceType: 'rule_import', sourceText: 'draftテスト原稿の本文です。'
  });
  assert.equal(created.status, 'draft');
  assert.equal(store.catalog().scripts.filter(item => item.status === 'published').length, before, 'draftは公開一覧を増やさない');
  assert.throws(() => store.start({ talkScriptId: created.id, customerName: 'draft起動テスト' }), /公開中/, 'draftのまま新規商談は開始できない');

  const published = store.publishTalkScript(created.id, 'FS');
  assert.equal(published.status, 'published');
  assert.equal(store.catalog().scripts.filter(item => item.status === 'published').length, before + 1);
  const session = store.start({ talkScriptId: created.id, customerName: '公開後起動テスト' });
  assert.equal(session.talk_script_id, created.id);
}));

test('同じ原稿から重複してスクリプトを作らない（content_hashで検知）', () => withStore(store => {
  const sourceText = '重複テストの原稿本文。'.repeat(3);
  const first = store.createTalkScript({ name: '重複元', products: 'HP無料制作', sourceType: 'rule_import', sourceText });
  assert.throws(
    () => store.createTalkScript({ name: '重複元2回目', products: 'HP無料制作', sourceType: 'rule_import', sourceText }),
    /同じ内容のトークスクリプトが既に登録されています/
  );
  // DBに万一重複が出来ても、一覧（catalog）には新しい方だけを出す
  store.db.prepare('UPDATE talk_scripts SET id=? WHERE id=?').run('hd-dup-manual-insert', first.id);
  store.db.prepare(`INSERT INTO talk_scripts(id,department_id,name,products,customer_type,version,status,updated_at,phase_count,content_hash) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run('hd-dup-newer', 'hd', '重複元(新しい方)', '["HP無料制作"]', '店舗オーナー', '2026/08/07', 'published', '2099-01-01T00:00:00.000Z', 0, crypto.createHash('sha256').update(sourceText).digest('hex'));
  const names = store.catalog().scripts.filter(item => item.name.startsWith('重複元')).map(item => item.id);
  assert.deepEqual(names, ['hd-dup-newer'], '同一content_hashは新しい方だけが一覧に出る');
}));
