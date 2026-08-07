import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SalesAssistStore } from '../src/sales-assist.js';
import { ObsidianSalesArchive } from '../src/obsidian-sales-archive.js';
import { ObsidianHdArchitecture } from '../src/obsidian-hd-architecture.js';

function withVault(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-obsidian-architecture-'));
  const vault = path.join(directory, 'vault');
  const obsidianConfigPath = path.join(directory, 'obsidian.json');
  fs.mkdirSync(vault, { recursive:true });
  fs.writeFileSync(obsidianConfigPath, JSON.stringify({ vaults:{ test:{ path:vault } } }));
  try { run({ directory, vault, obsidianConfigPath }); }
  finally { fs.rmSync(directory, { recursive:true, force:true }); }
}

function seedExistingSalesSupportFiles(vault) {
  const dealFile = path.join(vault, 'HD事業部', '商談支援', '商談内容', '案件', '既存店舗 - aaaaaaaa.md');
  const prepFile = path.join(vault, 'HD事業部', '商談支援', '商談内容', '商談準備', '既存準備 - bbbbbbbb.md');
  const scriptFile = path.join(vault, 'HD事業部', '商談支援', '各種スクリプト', '既存スクリプト.md');
  for (const file of [dealFile, prepFile, scriptFile]) fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(dealFile, '# 既存店舗\n\n移動・削除されてはいけない既存の商談メモ。\n');
  fs.writeFileSync(prepFile, '# 既存準備\n\n移動・削除されてはいけない既存の商談準備メモ。\n');
  fs.writeFileSync(scriptFile, '# 既存スクリプト\n\n移動・削除されてはいけない既存スクリプト。\n');
  return { dealFile, prepFile, scriptFile };
}

test('既存Vaultファイルを移動・削除しない', () => withVault(({ vault, obsidianConfigPath }) => {
  const existing = seedExistingSalesSupportFiles(vault);
  const beforeDeal = fs.readFileSync(existing.dealFile, 'utf8');
  const beforePrep = fs.readFileSync(existing.prepFile, 'utf8');
  const beforeScript = fs.readFileSync(existing.scriptFile, 'utf8');

  const archive = new ObsidianSalesArchive({ vaultId:'test', folder:'HD事業部/商談支援', obsidianConfigPath });
  const architecture = new ObsidianHdArchitecture({ archive, store:null });
  architecture.ensureStructure();

  assert.ok(fs.existsSync(existing.dealFile), '既存の商談案件ファイルが残っている');
  assert.ok(fs.existsSync(existing.prepFile), '既存の商談準備ファイルが残っている');
  assert.ok(fs.existsSync(existing.scriptFile), '既存のスクリプトファイルが残っている');
  assert.equal(fs.readFileSync(existing.dealFile, 'utf8'), beforeDeal, '既存の商談案件本文が変わっていない');
  assert.equal(fs.readFileSync(existing.prepFile, 'utf8'), beforePrep, '既存の商談準備本文が変わっていない');
  assert.equal(fs.readFileSync(existing.scriptFile, 'utf8'), beforeScript, '既存のスクリプト本文が変わっていない');
}));

test('HDシステム.md / IS.md / FS.md / CS.mdが作成される', () => withVault(({ vault, obsidianConfigPath }) => {
  const archive = new ObsidianSalesArchive({ vaultId:'test', folder:'HD事業部/商談支援', obsidianConfigPath });
  const architecture = new ObsidianHdArchitecture({ archive, store:null });
  const result = architecture.ensureStructure();

  assert.ok(fs.existsSync(result.root));
  assert.ok(fs.existsSync(path.join(vault, 'HD事業部', 'HDシステム.md')));
  assert.ok(fs.existsSync(path.join(vault, 'HD事業部', 'IS', 'IS.md')));
  assert.ok(fs.existsSync(path.join(vault, 'HD事業部', 'FS', 'FS.md')));
  assert.ok(fs.existsSync(path.join(vault, 'HD事業部', 'CS', 'CS.md')));
}));

test('HDシステムからIS/FS/CSへWikiリンクがある', () => withVault(({ vault, obsidianConfigPath }) => {
  const archive = new ObsidianSalesArchive({ vaultId:'test', folder:'HD事業部/商談支援', obsidianConfigPath });
  new ObsidianHdArchitecture({ archive, store:null }).ensureStructure();
  const root = fs.readFileSync(path.join(vault, 'HD事業部', 'HDシステム.md'), 'utf8');
  assert.match(root, /\[\[IS\]\]/);
  assert.match(root, /\[\[FS\]\]/);
  assert.match(root, /\[\[CS\]\]/);
}));

test('FSから各FS機能へWikiリンクがある', () => withVault(({ vault, obsidianConfigPath }) => {
  const archive = new ObsidianSalesArchive({ vaultId:'test', folder:'HD事業部/商談支援', obsidianConfigPath });
  new ObsidianHdArchitecture({ archive, store:null }).ensureStructure();
  const fsNote = fs.readFileSync(path.join(vault, 'HD事業部', 'FS', 'FS.md'), 'utf8');
  for (const module of ['FS_商談準備', 'FS_トークスクリプト', 'FS_商談資料', 'FS_商談管理', 'FS_商談結果と振り返り', 'FS_引き継ぎFMT', 'FS_KPI']) {
    assert.match(fsNote, new RegExp(`\\[\\[${module}\\]\\]`), `${module}がFS.mdにリンクされている`);
    assert.ok(fs.existsSync(path.join(vault, 'HD事業部', 'FS', `${module}.md`)), `${module}.mdが作成されている`);
  }
}));

test('ISから各IS機能へWikiリンクがある', () => withVault(({ vault, obsidianConfigPath }) => {
  const archive = new ObsidianSalesArchive({ vaultId:'test', folder:'HD事業部/商談支援', obsidianConfigPath });
  new ObsidianHdArchitecture({ archive, store:null }).ensureStructure();
  const isNote = fs.readFileSync(path.join(vault, 'HD事業部', 'IS', 'IS.md'), 'utf8');
  for (const module of ['IS_リスト取得', 'IS_Comdesk', 'IS_架電管理', 'IS_前確管理', 'IS_アポ管理', 'IS_KPI']) {
    assert.match(isNote, new RegExp(`\\[\\[${module}\\]\\]`), `${module}がIS.mdにリンクされている`);
    assert.ok(fs.existsSync(path.join(vault, 'HD事業部', 'IS', `${module}.md`)), `${module}.mdが作成されている`);
  }
}));

test('CSから各CS機能へWikiリンクがある', () => withVault(({ vault, obsidianConfigPath }) => {
  const archive = new ObsidianSalesArchive({ vaultId:'test', folder:'HD事業部/商談支援', obsidianConfigPath });
  new ObsidianHdArchitecture({ archive, store:null }).ensureStructure();
  const csNote = fs.readFileSync(path.join(vault, 'HD事業部', 'CS', 'CS.md'), 'utf8');
  assert.match(csNote, /status: planned/);
  for (const module of ['CS_制作引き継ぎ', 'CS_制作進捗', 'CS_素材回収', 'CS_修正管理', 'CS_公開管理']) {
    assert.match(csNote, new RegExp(`\\[\\[${module}\\]\\]`), `${module}がCS.mdにリンクされている`);
    assert.ok(fs.existsSync(path.join(vault, 'HD事業部', 'CS', `${module}.md`)), `${module}.mdが作成されている`);
  }
}));

test('FS商談案件・商談準備・スクリプトからHDシステムへのWikiリンクが入る', () => withVault(({ vault, directory, obsidianConfigPath }) => {
  const archive = new ObsidianSalesArchive({ vaultId:'test', folder:'HD事業部/商談支援', obsidianConfigPath });
  const store = new SalesAssistStore(path.join(directory, 'sales.sqlite'));
  try {
    const prepared = store.prepare({ customerName:'IA接続テスト店舗', handoff:'IS引き継ぎ本文' });
    const prepTarget = archive.syncPreparation(store, prepared.id);
    const prepText = fs.readFileSync(prepTarget, 'utf8');
    assert.match(prepText, /\[\[FS_商談準備\]\]/, '商談準備に[[FS_商談準備]]が入る');
    assert.match(prepText, /module: FS_商談準備/);

    const session = store.openPreparation(prepared.id);
    store.addMeetingMemo(session.id, { content:'原文メモは消えない' });
    const sessionTarget = archive.syncSession(store, session.id);
    const sessionText = fs.readFileSync(sessionTarget, 'utf8');
    assert.match(sessionText, /\[\[FS\]\]/, 'FS商談案件に[[FS]]が入る');
    assert.match(sessionText, /\[\[HDシステム\]\]/, 'FS商談案件に[[HDシステム]]が入る');
    assert.match(sessionText, /\[\[FS_商談管理\]\]/, 'FS商談案件に[[FS_商談管理]]が入る');
    assert.match(sessionText, /department: FS/);
    assert.match(sessionText, /system_parent: HDシステム/);
    assert.match(sessionText, /原文メモは消えない/, '原文メモが消えない');

    const libraryFiles = archive.syncLibraries(store);
    const scriptFile = libraryFiles.find(file => file.includes('各種スクリプト'));
    assert.ok(scriptFile);
    const scriptText = fs.readFileSync(scriptFile, 'utf8');
    assert.match(scriptText, /\[\[FS_トークスクリプト\]\]/, 'スクリプトに[[FS_トークスクリプト]]が入る');
  } finally {
    store.close();
  }
}));

test('既存商談本文・原文メモ・AI解析が消えない', () => withVault(({ directory, obsidianConfigPath }) => {
  const archive = new ObsidianSalesArchive({ vaultId:'test', folder:'HD事業部/商談支援', obsidianConfigPath });
  const store = new SalesAssistStore(path.join(directory, 'sales.sqlite'));
  try {
    const prepared = store.prepare({ customerName:'AI解析保持テスト' });
    const session = store.openPreparation(prepared.id);
    store.addMeetingMemo(session.id, { content:'これは消えてはいけない原文メモ' });
    store.saveAnalysis(session.id, { analysis:{}, text:'これは消えてはいけないAI解析結果', status:'completed', actor:'FS' });
    const target = archive.syncSession(store, session.id);
    const text = fs.readFileSync(target, 'utf8');
    assert.match(text, /これは消えてはいけない原文メモ/);
    assert.match(text, /これは消えてはいけないAI解析結果/);
  } finally {
    store.close();
  }
}));

test('既存folder: HD事業部/商談支援が維持される', () => {
  const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config', 'sales-assist', 'obsidian.json'), 'utf8'));
  assert.equal(config.folder, 'HD事業部/商談支援');
  assert.equal(config.vaultId, '720a81b628ab29d3');
  assert.equal(config.architecture.rootNote, 'HD事業部/HDシステム.md');
});

test('architecture設定がない場合も既存連携が動く', () => withVault(({ directory, obsidianConfigPath }) => {
  const archive = new ObsidianSalesArchive({ vaultId:'test', folder:'HD事業部/商談支援', obsidianConfigPath });
  const store = new SalesAssistStore(path.join(directory, 'sales.sqlite'));
  try {
    const architecture = new ObsidianHdArchitecture({ archive, store, config:undefined });
    const result = architecture.ensureStructure();
    assert.ok(fs.existsSync(result.root));

    const prepared = store.prepare({ customerName:'architecture未設定テスト' });
    assert.ok(fs.existsSync(archive.syncPreparation(store, prepared.id)));
  } finally {
    store.close();
  }
}));

test('managed領域更新でユーザー自由記述が消えない', () => withVault(({ vault, obsidianConfigPath }) => {
  const archive = new ObsidianSalesArchive({ vaultId:'test', folder:'HD事業部/商談支援', obsidianConfigPath });
  const architecture = new ObsidianHdArchitecture({ archive, store:null });
  architecture.ensureRootNote();

  const target = path.join(vault, 'HD事業部', 'HDシステム.md');
  const original = fs.readFileSync(target, 'utf8');
  const withUserNote = original.replace('ここはユーザーが自由に編集可能', 'ここはユーザーが自由に編集可能\n\nユーザーが書いた大事なメモ。');
  fs.writeFileSync(target, withUserNote, 'utf8');

  architecture.ensureRootNote();
  const after = fs.readFileSync(target, 'utf8');
  assert.match(after, /ユーザーが書いた大事なメモ。/, 'managed領域の再生成後もユーザー自由記述が残る');
  assert.match(after, /\[\[IS\]\]/, 'managed領域自体は更新されている');
}));

test('同じ処理を2回実行しても重複リンクが増えない', () => withVault(({ vault, obsidianConfigPath }) => {
  const archive = new ObsidianSalesArchive({ vaultId:'test', folder:'HD事業部/商談支援', obsidianConfigPath });
  const architecture = new ObsidianHdArchitecture({ archive, store:null });
  architecture.ensureStructure();
  const target = path.join(vault, 'HD事業部', 'FS', 'FS.md');
  const first = fs.readFileSync(target, 'utf8');
  const firstCount = (first.match(/\[\[FS_商談準備\]\]/g) || []).length;
  assert.equal(firstCount, 1);

  architecture.ensureStructure();
  const second = fs.readFileSync(target, 'utf8');
  const secondCount = (second.match(/\[\[FS_商談準備\]\]/g) || []).length;
  assert.equal(secondCount, 1, '2回実行してもリンクは重複しない');
  assert.equal(second, first, '2回目の実行で差分が発生しない（冪等）');
}));

test('CSがstatus: plannedで未実装を偽装しない', () => withVault(({ vault, obsidianConfigPath }) => {
  const archive = new ObsidianSalesArchive({ vaultId:'test', folder:'HD事業部/商談支援', obsidianConfigPath });
  new ObsidianHdArchitecture({ archive, store:null }).ensureStructure();
  const csNote = fs.readFileSync(path.join(vault, 'HD事業部', 'CS', 'CS.md'), 'utf8');
  assert.match(csNote, /status: planned/);
}));

test('顧客テンプレートを実顧客なしで1枚だけ用意する', () => withVault(({ vault, obsidianConfigPath }) => {
  const archive = new ObsidianSalesArchive({ vaultId:'test', folder:'HD事業部/商談支援', obsidianConfigPath });
  const architecture = new ObsidianHdArchitecture({ archive, store:null });
  const result = architecture.ensureStructure();
  assert.ok(fs.existsSync(result.customerTemplate));
  const customerDir = path.join(vault, 'HD事業部', '共通', '顧客');
  assert.deepEqual(fs.readdirSync(customerDir), ['_顧客テンプレート.md']);
}));
