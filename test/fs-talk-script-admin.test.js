import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SalesAssistStore } from '../src/sales-assist.js';

// FSトークスクリプト管理：下書き/公開の分離・バージョン履歴・進行中商談の版固定・複製・シード上書き防止を確認する。
function withStore(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-script-admin-'));
  const store = new SalesAssistStore(path.join(directory, 'sales.sqlite'));
  try { run(store); } finally { store.close(); fs.rmSync(directory, { recursive:true, force:true }); }
}

const samplePhases = () => ([
  { name:'導入', goal:'目的1', script:'本文1', questions:['質問1'], transition:'次へ1', prohibited:['NG1'] },
  { name:'提案', goal:'目的2', script:'本文2', questions:['質問2a','質問2b'], transition:'次へ2', prohibited:[] }
]);

test('下書き保存は公開中の内容にもFS商談にも影響しない', () => withStore(store => {
  const created = store.createTalkScript({ name:'下書きテスト', products:'HP無料制作', version:'v1' });
  const published = store.replaceTalkScriptPhases(created.id, samplePhases(), { version:'v1', actor:'管理者' });
  assert.equal(published.status, 'published');
  const publishedPhasesBefore = store.phases(created.id);
  assert.equal(publishedPhasesBefore.length, 2);

  const draftPhases = samplePhases();
  draftPhases[0].script = '編集後の本文（下書き）';
  draftPhases.push({ name:'追加フェーズ', goal:'', script:'新フェーズ本文', questions:[], transition:'', prohibited:[] });
  const workingCopy = store.saveDraft(created.id, { meta:{ name:'下書きテスト' }, phases:draftPhases, actor:'管理者' });
  assert.equal(workingCopy.hasDraft, true);
  assert.equal(workingCopy.phases.length, 3);

  // 公開テーブルはまだ2フェーズ・元の本文のまま
  const publishedPhasesAfterDraft = store.phases(created.id);
  assert.equal(publishedPhasesAfterDraft.length, 2);
  assert.equal(publishedPhasesAfterDraft[0].base_script, '本文1');

  const catalogScript = store.catalog().scripts.find(item => item.id === created.id);
  assert.equal(catalogScript.has_draft, true);
  assert.equal(catalogScript.phase_count, 2, 'カタログのフェーズ数は公開済みの件数のまま');
}));

test('公開すると新しい商談から反映され、バージョン履歴が残る', () => withStore(store => {
  const created = store.createTalkScript({ name: '公開テスト', products: 'HP無料制作', version: 'v1' });
  store.replaceTalkScriptPhases(created.id, samplePhases(), { version: 'v1', actor: '管理者' });

  const draftPhases = samplePhases();
  draftPhases[0].script = '公開後の新しい本文';
  store.saveDraft(created.id, { meta:{ name:'公開テスト（改題）' }, phases: draftPhases, changeNote:'導入の言い回しを変更', actor:'管理者' });

  const result = store.publishDraft(created.id, { actor:'管理者', changeNote:'導入の言い回しを変更' });
  assert.equal(result.versionNumber, 2, '既存公開スクリプトの2回目公開はversion_number+1');
  assert.equal(result.script.name, '公開テスト（改題）');
  assert.equal(result.script.has_draft, false, '公開後は下書きが消える');

  const publishedPhasesAfter = store.phases(created.id);
  assert.equal(publishedPhasesAfter[0].base_script, '公開後の新しい本文');

  const versions = store.talkScriptVersions(created.id);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].version_number, 2);
  assert.equal(versions[0].change_note, '導入の言い回しを変更');
  assert.equal(versions[0].action, 'publish');

  // 公開後に開始した新しい商談には新版が使われる
  const session = store.start({ talkScriptId: created.id, customerName: '公開後商談' });
  assert.equal(store.sessionPhases(session.id)[0].base_script, '公開後の新しい本文');
}));

test('進行中の商談は開始後に公開された新版の影響を受けない', () => withStore(store => {
  const created = store.createTalkScript({ name: '固定テスト', products: 'HP無料制作', version: 'v1' });
  store.replaceTalkScriptPhases(created.id, samplePhases(), { version: 'v1', actor: '管理者' });

  const session = store.start({ talkScriptId: created.id, customerName: 'Aさん' });
  assert.equal(store.sessionPhases(session.id)[0].base_script, '本文1');

  // 商談開始後に管理者が新版を公開する
  const newerPhases = samplePhases();
  newerPhases[0].script = '13:15に公開された新しい本文';
  store.saveDraft(created.id, { meta:{}, phases: newerPhases, actor:'管理者' });
  store.publishDraft(created.id, { actor:'管理者' });

  // 進行中の商談（Aさん）は元のまま
  assert.equal(store.sessionPhases(session.id)[0].base_script, '本文1', '進行中の商談は途中で変更されない');
  // 新しい公開内容は次の新規商談から
  const nextSession = store.start({ talkScriptId: created.id, customerName: 'Bさん' });
  assert.equal(store.sessionPhases(nextSession.id)[0].base_script, '13:15に公開された新しい本文');
}));

test('過去バージョンへ復元すると、履歴を保持したまま新しいバージョンとして公開される', () => withStore(store => {
  const created = store.createTalkScript({ name: '復元テスト', products: 'HP無料制作', version: 'v1' });
  store.replaceTalkScriptPhases(created.id, samplePhases(), { version: 'v1', actor: '管理者' });
  store.publishDraft(created.id, { actor:'管理者', changeNote:'初回相当の公開' }); // version_number -> 2 (status was already published)

  const v2Phases = samplePhases();
  v2Phases[0].script = 'v2の本文';
  store.saveDraft(created.id, { meta:{}, phases: v2Phases, actor:'管理者' });
  const v2 = store.publishDraft(created.id, { actor:'管理者', changeNote:'v2公開' });
  assert.equal(v2.versionNumber, 3);

  const versionsBefore = store.talkScriptVersions(created.id);
  assert.equal(versionsBefore.length, 2, '公開のたびに履歴が増える');

  const restored = store.restoreTalkScriptVersion(created.id, versionsBefore[versionsBefore.length - 1].version_number, '管理者');
  assert.equal(restored.versionNumber, 4, '復元は新しいバージョン番号として追加される（履歴は書き換えない）');
  assert.equal(store.phases(created.id)[0].base_script, '本文1', '復元した内容が公開される');

  const versionsAfter = store.talkScriptVersions(created.id);
  assert.equal(versionsAfter.length, 3, '復元も履歴として残る');
  assert.equal(versionsAfter[0].action, 'restore');
}));

test('複製は下書きとして作られ、元のスクリプトへ影響しない', () => withStore(store => {
  const created = store.createTalkScript({ name: '複製元', products: 'HP無料制作', version: 'v1' });
  store.replaceTalkScriptPhases(created.id, samplePhases(), { version: 'v1', actor: '管理者' });

  const duplicated = store.duplicateTalkScript(created.id, { actor:'管理者' });
  assert.equal(duplicated.status, 'draft');
  assert.equal(duplicated.name, '複製元 のコピー');
  assert.equal(duplicated.has_draft, true);
  assert.throws(() => store.start({ talkScriptId: duplicated.id, customerName: 'x' }), /公開中/);

  // 複製後に複製先を公開しても元のスクリプトは変わらない
  store.publishDraft(duplicated.id, { actor:'管理者' });
  assert.equal(store.phases(created.id)[0].base_script, '本文1');
  assert.equal(store.phases(duplicated.id)[0].base_script, '本文1');
  assert.equal(store.catalog().scripts.find(item => item.id === created.id).name, '複製元');
}));

test('デフォルト設定は公開中のスクリプトだけ可能で、他の既定は解除される', () => withStore(store => {
  const created = store.createTalkScript({ name: '既定テスト', products: 'HP無料制作', version: 'v1', status: 'draft' });
  assert.throws(() => store.setDefaultTalkScript(created.id), /公開中/);
  store.replaceTalkScriptPhases(created.id, samplePhases(), { version: 'v1', actor: '管理者' });
  store.publishTalkScript(created.id, '管理者');
  store.setDefaultTalkScript(created.id, '管理者');
  assert.equal(store.defaultTalkScriptId(), created.id);
  assert.equal(store.catalog().scripts.filter(item => item.department_id === 'hd' && item.default_for_preparation).length, 1);
}));

test('シード処理は編集済みの内容を再起動のたびに初期値へ戻さない（冪等性）', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-script-admin-seed-'));
  const file = path.join(directory, 'sales.sqlite');
  try {
    const first = new SalesAssistStore(file);
    const edited = first.replaceTalkScriptPhases('hd-new-ap-20260725', samplePhases(), { version:'編集済みバージョン表記', actor:'管理者' });
    assert.equal(edited.phase_count, 2);
    assert.equal(edited.version, '編集済みバージョン表記');
    first.close();

    const second = new SalesAssistStore(file); // 再起動を模倣
    const reloaded = second.catalog().scripts.find(item => item.id === 'hd-new-ap-20260725');
    assert.equal(reloaded.phase_count, 2, '再起動後もフェーズ件数が初期値へ戻らない');
    assert.equal(reloaded.version, '編集済みバージョン表記', '再起動後もバージョン表記が初期値へ戻らない');
    assert.equal(second.phases('hd-new-ap-20260725')[0].base_script, '本文1', '再起動後もフェーズ本文が初期値へ戻らない');
    second.close();
  } finally {
    fs.rmSync(directory, { recursive:true, force:true });
  }
});
