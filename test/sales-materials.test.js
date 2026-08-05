import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalSqliteSalesMaterialRepository } from '../src/repositories/sqlite-sales-material-repository.js';
import { SalesMaterialRepository } from '../src/repositories/sales-material-repository.js';
import { safeMaterialUrl, normalizeMaterial, selectPhaseMaterials, productMatches, visibleTo, phaseTagsFor, groupMaterials } from '../src/sales-materials.js';

const PHASE_TAGS = JSON.parse(fs.readFileSync(new URL('../config/sales-assist/fs-material-phase-tags.json', import.meta.url), 'utf8')).talkScripts.default;
const SAMPLE = [
  { id:'fs-main-proposal-deck', title:'トーク内使用｜新規事業ご提案資料', category:'talk', product:'common', sourceType:'powerpoint', url:'https://example.com/deck', phaseTags:['company_intro','hp_value','free_scheme','proposal'], visibility:'customer_shareable', sortOrder:10, active:true },
  { id:'amex-application-flow', title:'AMEX｜お申し込みフロー', category:'card_application', product:'amex', sourceType:'google_slides', url:'https://example.com/amex', phaseTags:['card_amex','application'], visibility:'customer_shareable', sortOrder:20, active:true },
  { id:'smbc-business-owners-manual', title:'三井住友ビジネスオーナーズ｜カード発行マニュアル', category:'card_application', product:'smbc_business_owners', sourceType:'powerpoint', url:'https://example.com/smbc', phaseTags:['card_smbc','application'], visibility:'customer_shareable', sortOrder:30, active:true },
  { id:'ac-mastercard-application-guide', title:'ACマスターカード｜申込フォーム入力方法', category:'card_application', product:'ac_mastercard', sourceType:'google_slides', url:'https://example.com/ac', phaseTags:['card_ac','application'], visibility:'customer_shareable', sortOrder:40, active:true },
  { id:'affiliate-links-master', title:'アフィリエイトリンク管理表', category:'affiliate', product:'common', sourceType:'google_sheets', url:'https://example.com/affiliate', phaseTags:['card_amex','card_smbc','card_ac','application'], visibility:'fs_internal', customerShareable:false, sortOrder:50, active:true },
  { id:'enepal-official-site', title:'エネパル｜公式サイト', category:'electricity', product:'enepal', sourceType:'website', url:'https://example.com/enepal', phaseTags:['free_scheme','electricity_intro'], visibility:'customer_shareable', sortOrder:60, active:true },
  { id:'enepal-palpower-price-list', title:'エネパル｜料金表【パルパワー】', category:'electricity', product:'enepal', sourceType:'pdf', url:'https://example.com/price.pdf', phaseTags:['electricity_intro','electricity_comparison','application'], visibility:'customer_shareable', sortOrder:70, active:true },
  { id:'enepal-kanto-area-fees', title:'エネパル｜関東エリア・違約金・事務手数料', category:'electricity', product:'enepal', sourceType:'website', url:'https://example.com/kanto', phaseTags:['electricity_intro','contract_conditions','application'], visibility:'customer_shareable', sortOrder:80, active:true },
  { id:'enepal-application-template', title:'エネパル｜HP制作・電力供給契約 申込書テンプレート', category:'contract', product:'enepal', sourceType:'google_docs', url:'https://example.com/form', phaseTags:['application_form','contract_readthrough','cloudsign'], visibility:'fs_internal', sortOrder:90, active:true }
];

function withRepository(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-sales-materials-'));
  const repository = new LocalSqliteSalesMaterialRepository(path.join(directory, 'materials.sqlite'));
  try { run(repository); } finally { repository.close(); fs.rmSync(directory, { recursive:true, force:true }); }
}

test('初期9資料を取り込み、停止・再開できる', () => withRepository(repository => {
  const result = repository.importAll(SAMPLE, { actor:'import-cli' });
  assert.equal(result.imported, 9);
  assert.deepEqual(result.errors, []);
  assert.equal(repository.list({ viewer:'admin' }).length, 9);
  assert.equal(repository.list({ category:'electricity', viewer:'fs' }).length, 3);
  assert.equal(repository.list({ product:'amex', viewer:'fs' }).length, 1);
  assert.equal(repository.list({ keyword:'料金表', viewer:'fs' }).length, 1);

  // 削除ではなく停止で運用する
  const stopped = repository.setActive('enepal-official-site', false, '管理者');
  assert.equal(stopped.active, false);
  assert.equal(repository.list({ viewer:'fs', active:true }).length, 8);
  assert.equal(repository.setActive('enepal-official-site', true).active, true);
  assert.equal(repository.setActive('存在しないID', false), null);

  // 再取り込みしても重複せず、URL変更だけが反映される
  repository.importAll([{ ...SAMPLE[0], url:'https://example.com/deck-v2' }]);
  assert.equal(repository.list({ viewer:'admin' }).length, 9);
  assert.equal(repository.get('fs-main-proposal-deck').url, 'https://example.com/deck-v2');
  assert.ok(repository.get('fs-main-proposal-deck').version > 1);
}));

test('現在フェーズと対象商材に合う資料だけを最大4件返す', () => withRepository(repository => {
  repository.importAll(SAMPLE);
  const phase = (phaseId, products) => repository.phaseMaterials({ phaseId, phaseTagMap:PHASE_TAGS, products }).materials.map(item => item.id);

  // 会社紹介・HP説明ではご提案資料
  assert.deepEqual(phase('company', 'ホームページ無料制作、エネパル'), ['fs-main-proposal-deck']);
  assert.deepEqual(phase('examples', 'ホームページ無料制作、エネパル'), ['fs-main-proposal-deck']);
  // 無料の仕組み・電気説明ではエネパル資料
  assert.deepEqual(phase('free_conditions', 'ホームページ無料制作、エネパル'),
    ['fs-main-proposal-deck','enepal-official-site','enepal-palpower-price-list','enepal-kanto-area-fees']);
  // 申込書読み合わせでは申込書テンプレート
  assert.ok(phase('application', 'ホームページ無料制作、エネパル').includes('enepal-application-template'));
  // カードフェーズでは対象商材のカード資料とアフィリ管理表（電気対象外ならエネパル資料は出さない）
  assert.deepEqual(phase('enepal_card', 'AMEX'), ['amex-application-flow','affiliate-links-master']);
  assert.deepEqual(phase('enepal_card', '三井住友ビジネスオーナーズ'), ['smbc-business-owners-manual','affiliate-links-master']);
  assert.deepEqual(phase('enepal_card', 'ACマスターカード'), ['ac-mastercard-application-guide','affiliate-links-master']);
  assert.deepEqual(phase('enepal_card', 'エネパル、AMEX'), ['amex-application-flow','affiliate-links-master','enepal-official-site','enepal-palpower-price-list']);
  // 対象外商材の資料は自動表示しない
  assert.equal(phase('enepal_card', 'AMEX').includes('smbc-business-owners-manual'), false);
  // タグのないフェーズでは資料を出さない
  assert.deepEqual(phase('agenda', 'エネパル'), []);
  // 最大4件
  assert.ok(repository.phaseMaterials({ phaseId:'free_conditions', phaseTagMap:PHASE_TAGS, products:'エネパル' }).materials.length <= 4);
  // 停止した資料は出さない
  repository.setActive('fs-main-proposal-deck', false);
  assert.equal(phase('company', 'エネパル').length, 0);
}));

test('公開範囲に応じて資料を出し分ける', () => withRepository(repository => {
  repository.importAll(SAMPLE);
  const ids = viewer => repository.list({ viewer }).map(item => item.id);
  // 顧客向け表示にアフィリエイト管理表と申込書テンプレートを含めない
  assert.equal(ids('customer').includes('affiliate-links-master'), false);
  assert.equal(ids('customer').includes('enepal-application-template'), false);
  assert.equal(ids('fs').includes('affiliate-links-master'), true);
  assert.equal(repository.get('affiliate-links-master', { viewer:'customer' }), null, '権限のない閲覧者にはURLごと返さない');
  assert.ok(repository.get('affiliate-links-master', { viewer:'fs' }).url);

  repository.save({ ...SAMPLE[0], id:'admin-only-doc', visibility:'admin_only' });
  assert.equal(ids('fs').includes('admin-only-doc'), false);
  assert.equal(ids('admin').includes('admin-only-doc'), true);

  assert.equal(visibleTo({ visibility:'fs_internal' }, 'customer'), false);
  assert.equal(visibleTo({ visibility:'customer_shareable' }, 'fs'), true);
}));

test('危険なURLと不正なIDを保存できない', () => withRepository(repository => {
  const base = { ...SAMPLE[0], id:'sample' };
  assert.throws(() => repository.save({ ...base, url:'javascript:alert(1)' }), /https/);
  assert.throws(() => repository.save({ ...base, url:'data:text/html,<script>alert(1)</script>' }), /https/);
  assert.throws(() => repository.save({ ...base, url:'file:///etc/passwd' }), /https/);
  assert.throws(() => repository.save({ ...base, url:'http://example.com/insecure' }), /https/);
  assert.throws(() => repository.save({ ...base, url:'' }), /https/);
  assert.throws(() => repository.save({ ...base, id:'../../etc/passwd' }), /資料ID/);
  assert.throws(() => repository.save({ ...base, id:'' }), /資料ID/);
  assert.throws(() => repository.save({ ...base, title:'' }), /資料名/);
  assert.equal(repository.list({ viewer:'admin' }).length, 0);

  // HTMLを含むタイトルは加工せず保存し、描画側でtextContentとして扱う
  const saved = repository.save({ ...base, title:'<img src=x onerror=alert(1)>資料' });
  assert.equal(saved.title, '<img src=x onerror=alert(1)>資料');

  assert.equal(safeMaterialUrl('https://example.com/a?b=1#c'), 'https://example.com/a?b=1#c');
  assert.equal(safeMaterialUrl('JavaScript:alert(1)'), '');
  assert.equal(safeMaterialUrl(''), '');
}));

test('取り込み時に不正な資料だけを弾き、他は登録する', () => withRepository(repository => {
  const result = repository.importAll([SAMPLE[0], { ...SAMPLE[1], url:'javascript:alert(1)' }, SAMPLE[2]]);
  assert.equal(result.imported, 2);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /amex-application-flow/);
  assert.equal(repository.list({ viewer:'admin' }).length, 2);
}));

test('分類と絞り込みの基本ルール', () => {
  assert.equal(productMatches('common', ''), true);
  assert.equal(productMatches('amex', 'AMEX・エネパル'), true);
  assert.equal(productMatches('amex', 'エネパルのみ'), false);
  assert.equal(productMatches('enepal', 'ホームページ無料制作、電気'), true);
  assert.equal(productMatches('amex', ''), true, '対象商材が未登録なら絞り込まない');
  assert.deepEqual(phaseTagsFor('company', PHASE_TAGS), ['company_intro','hp_value']);
  assert.deepEqual(phaseTagsFor('存在しないフェーズ', PHASE_TAGS), []);
  assert.deepEqual(selectPhaseMaterials(SAMPLE.map(item => normalizeMaterial(item)), { tags:[] }), []);
  const normalized = normalizeMaterial({ id:'x', title:'t', url:'https://example.com', phaseTags:'a, b b', category:'不正値', product:'不正値', visibility:'不正値' });
  assert.deepEqual(normalized.phaseTags, ['a','b'], '重複タグは除去する');
  assert.equal(normalized.category, 'other');
  assert.equal(normalized.product, 'common');
  assert.equal(normalized.visibility, 'fs_internal');
  assert.equal(normalized.customerShareable, false);
});

test('資料ライブラリを使う場面ごとに分けて並べる', () => withRepository(repository => {
  repository.importAll(SAMPLE);
  const groups = groupMaterials(repository.list({ viewer:'fs' }));
  assert.deepEqual(groups.map(group => group.label), ['商談中に使用する資料','電気・エネパルの説明資料','申込時に使用する資料']);

  const byId = Object.fromEntries(groups.map(group => [group.id, group.materials.map(item => item.id)]));
  assert.deepEqual(byId.talk, ['fs-main-proposal-deck']);
  assert.deepEqual(byId.electricity, ['enepal-official-site','enepal-palpower-price-list','enepal-kanto-area-fees']);
  // 申込時に使う資料（カード申込・申込書・最新の申込リンク）を1つのまとまりにする
  assert.deepEqual(byId.application, ['amex-application-flow','smbc-business-owners-manual','ac-mastercard-application-guide','affiliate-links-master','enepal-application-template']);
  assert.equal(groups.every(group => group.materials.length), true, '空のグループは出さない');

  // カテゴリがotherでも、制作事例タグが付いていれば商談中の資料へ寄せる
  const withCase = groupMaterials([...repository.list({ viewer:'fs' }), { ...SAMPLE[0], id:'case-site', category:'other', phaseTags:['case_study','hp_quality'], sortOrder:15 }]);
  assert.deepEqual(withCase.find(group => group.id === 'talk').materials.map(item => item.id), ['fs-main-proposal-deck','case-site']);
  assert.equal(withCase.some(group => group.id === 'other'), false);

  // 手掛かりのない資料は「その他」へ落とす
  const withOther = groupMaterials([...repository.list({ viewer:'fs' }), { ...SAMPLE[0], id:'unknown-doc', category:'other', phaseTags:[], sortOrder:1 }]);
  assert.deepEqual(withOther.at(-1).materials.map(item => item.id), ['unknown-doc']);
  assert.equal(withOther.at(-1).label, 'その他');

  // 顧客向けにはアフィリエイト管理表を含めない
  assert.equal(groupMaterials(repository.list({ viewer:'customer' })).find(group => group.id === 'application').materials.includes('affiliate-links-master'), false);
  assert.deepEqual(groupMaterials([]), []);
}));

test('保存先を差し替えられるRepository構造になっている', () => {
  assert.ok(new LocalSqliteSalesMaterialRepository(':memory:') instanceof SalesMaterialRepository);
  assert.throws(() => new SalesMaterialRepository().list(), /実装されていません/);
  assert.throws(() => new SalesMaterialRepository().save(), /実装されていません/);
});

test('公開テンプレートに実URLが含まれていない', () => {
  const example = JSON.parse(fs.readFileSync(new URL('../config/sales-assist/fs-sales-materials.example.json', import.meta.url), 'utf8'));
  assert.equal(example.materials.length, 9);
  for (const item of example.materials) assert.equal(item.url, '', `${item.id} のURLはテンプレートでは空にする`);
});
