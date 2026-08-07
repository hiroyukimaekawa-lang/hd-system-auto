import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const safeName = value => String(value || '名称未設定')
  .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 80) || '名称未設定';
const text = value => String(value || '').trim() || '未入力';
const lines = values => values.length ? values.map(value => `- ${value}`).join('\n') : '- なし';

const PRODUCT_LABELS = { enepal:'エネパル', amex:'AMEX', smbc_business_owners:'三井住友ビジネスオーナーズ', acom_ac_mastercard:'アコム（ACマスターカード）', none:'今回は商材提案なし' };
const NOTE_SOURCE_LABELS = { during_meeting:'商談中', closing_form:'終了時追記', post_meeting:'商談後追記' };
// AI解析は補助情報であることを明記して保存する（商談結果・ヨミとしては扱わない）
function analysisSection(store, sessionId) {
  const analysis = store.currentAnalysis?.(sessionId);
  if (!analysis) return '未解析';
  const body = (analysis.edited_text || analysis.generated_text || '').trim();
  if (!body) return analysis.status === 'failed' ? 'AI解析を作成できませんでした。原文メモを参照してください。' : '未解析';
  const label = analysis.edited_text ? '担当者修正済み' : 'AI生成';
  const stale = analysis.status === 'stale' ? '（メモ更新後・要再解析）' : '';
  return `> AI解析は原文メモをもとにした補助情報です。重要な判断は原文と実際の確認内容をもとに行ってください。\n\n**${label}${stale}**\n\n${body}`;
}

export function resolveObsidianVault(vaultId, obsidianConfigPath = path.join(os.homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json')) {
  const config = JSON.parse(fs.readFileSync(obsidianConfigPath, 'utf8'));
  const vault = config.vaults?.[vaultId];
  if (!vault?.path) throw new Error(`Obsidian保管庫 ${vaultId} が見つかりません`);
  return vault.path;
}

export class ObsidianSalesArchive {
  constructor({ vaultId, folder = 'HD事業部/商談支援', obsidianConfigPath } = {}) {
    this.vaultId = vaultId;
    this.folder = folder;
    this.obsidianConfigPath = obsidianConfigPath;
  }
  vaultPath() {
    return resolveObsidianVault(this.vaultId, this.obsidianConfigPath);
  }
  write(relativePath, content) {
    const target = path.join(this.vaultPath(), this.folder, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive:true });
    fs.writeFileSync(target, `${content.trim()}\n`, 'utf8');
    return target;
  }
  // ファイル名の店舗名は書き出し時点のものなので、末尾のID8桁だけで対象を特定する
  removeById(directory, id) {
    const key = String(id || '').slice(0, 8);
    if (!key) return [];
    const target = path.join(this.vaultPath(), this.folder, directory);
    if (!fs.existsSync(target)) return [];
    const suffix = ` - ${key}.md`;
    return fs.readdirSync(target)
      .filter(file => file.endsWith(suffix))
      .map(file => path.join(target, file))
      .filter(file => fs.statSync(file).isFile())
      .map(file => { fs.rmSync(file); return file; });
  }
  removeDeal({ preparationId, sessionId } = {}) {
    return [
      ...this.removeById(path.join('商談内容', '案件'), sessionId),
      ...this.removeById(path.join('商談内容', '商談準備'), preparationId)
    ];
  }
  syncSession(store, sessionId) {
    const session = store.session(sessionId);
    if (!session) return null;
    const record = store.sessionRecord(sessionId);
    const notes = store.db.prepare('SELECT * FROM talk_script_objection_notes WHERE session_id=? ORDER BY created_at').all(sessionId)
      .map(row => ({ ...row, commitments:JSON.parse(row.commitments || '[]'), objection_signals:JSON.parse(row.objection_signals || '[]'), predicted_objections:JSON.parse(row.predicted_objections || '[]') }));
    const script = store.catalog().scripts.find(item => item.id === session.talk_script_id);
    const context = session.context_data || {};
    const facts = record.facts.map(item => `${item.category}：${item.value}`);
    const objections = record.objections.map(item => `${item.customer_statement || '発言未入力'}（${item.detected_objection}）`);
    const commitments = notes.flatMap(item => item.commitments);
    const signals = notes.flatMap(item => item.objection_signals);
    const scratch = notes.map(item => `### ${new Date(item.created_at).toLocaleString('ja-JP')}\n\n${item.memo}\n\n**整理した反応**：${text(item.reaction_summary)}`).join('\n\n');
    const body = `---
type: hd-sales-case
customer: "${String(session.customer_name || '').replaceAll('"', '\\"')}"
status: "${String(session.result || (session.finished_at ? '終了' : '進行中')).replaceAll('"', '\\"')}"
meeting_at: "${context.meetingAt || session.started_at || ''}"
next_action_at: "${session.next_action_at || ''}"
talk_script: "${String(script?.name || session.talk_script_id).replaceAll('"', '\\"')}"
session_id: "${session.id}"
updated: "${new Date().toISOString()}"
department: FS
system_parent: HDシステム
module: FS_商談管理
---

# ${text(session.customer_name)}

## 案件情報

- オーナー：${text(session.owner_name)}
- 担当：${text(session.staff_id)}
- 使用スクリプト：${text(script?.name || session.talk_script_id)}
- 商談日時：${text(context.meetingAt || session.started_at)}
- 結果：${text(session.result)}
- 次の動き：${text(session.next_action)}
- 次回日：${text(session.next_action_at)}

## ISからの引き継ぎ

${text(session.handoff)}

## 商談前の懸念

${text(session.concerns)}

## 相手から取れた言質

${lines(commitments)}

## 反応・アウトの兆候

${lines(signals)}

## 商談中の記録

${lines(facts)}

## 発生したアウト

${lines(objections)}

## 今回扱った商材

${lines((store.meetingProducts?.(sessionId) || []).map(code => PRODUCT_LABELS[code] || code))}

## 商談メモ（原文）

${lines((store.notes?.(sessionId) || store.meetingMemos?.(sessionId) || []).map(item => `${new Date(item.created_at).toLocaleString('ja-JP')}｜${NOTE_SOURCE_LABELS[item.source] || '商談中'}${item.author_id ? `｜${item.author_id}` : ''}\n  ${item.content}`))}

## AIによる整理結果

${analysisSection(store, sessionId)}

## 殴り書きとAI整理

${scratch || '記録なし'}

## 商談結果メモ

${text(session.notes)}

## 担当者の振り返り

${text(session.reflection)}

## HDシステム

- 親：[[FS]]
- 上位：[[HDシステム]]
- 機能：[[FS_商談管理]]
`;
    return this.write(path.join('商談内容', '案件', `${safeName(session.customer_name)} - ${session.id.slice(0, 8)}.md`), body);
  }
  syncPreparation(store, preparationId) {
    const item = store.preparation(preparationId);
    if (!item) return null;
    if (item.session_id) return this.syncSession(store, item.session_id);
    const context = item.context_data || {};
    const script = store.catalog().scripts.find(entry => entry.id === item.talk_script_id);
    const body = `---
type: hd-sales-preparation
customer: "${String(item.customer_name || '').replaceAll('"', '\\"')}"
status: "商談準備"
meeting_at: "${context.meetingAt || ''}"
next_action_at: "${item.next_action_at || ''}"
talk_script: "${String(script?.name || item.talk_script_id).replaceAll('"', '\\"')}"
preparation_id: "${item.id}"
updated: "${new Date().toISOString()}"
department: FS
system_parent: HDシステム
module: FS_商談準備
---

# ${text(item.customer_name)} 商談準備

## 案件情報

- オーナー：${text(item.owner_name)}
- 担当：${text(item.staff_id)}
- 商談日時：${text(context.meetingAt)}
- 使用スクリプト：${text(script?.name || item.talk_script_id)}
- 次の動き：${text(item.next_action)}
- 次回日：${text(item.next_action_at)}

## ISからの引き継ぎ

${text(item.handoff)}

## 商談前の懸念

${text(item.concerns)}

## HDシステム

- 親：[[FS]]
- 上位：[[HDシステム]]
- 機能：[[FS_商談準備]]
`;
    return this.write(path.join('商談内容', '商談準備', `${safeName(item.customer_name)} - ${item.id.slice(0, 8)}.md`), body);
  }
  syncTalkScripts(store) {
    const catalog = store.catalog();
    const scripts = catalog.scripts.filter(item => item.status === 'published');
    const guide = catalog.applicationGuide;
    return scripts.map(script => {
      const phases = store.phases(script.id);
      const phaseText = phases.map(phase => `## ${phase.group_name ? `${phase.group_name} ` : ''}${phase.name}

### このフェーズの目的

${text(phase.goal)}

### 読み上げスクリプト

${text(phase.base_script)}

### 確認事項

${lines(phase.required_questions || [])}

### 次へ進む条件

${text(phase.transition_conditions)}
`).join('\n');
      const applicationText = phases.some(phase => /申込書/.test(phase.name)) && guide ? `# 申込書読み合わせガイド

${Object.entries(guide.variants).map(([,variant]) => `## ${variant.name}

${guide.sections.map(item => `### 第${item.number}項 ${item.title}

${item.talk.replaceAll('{{revisionLimit}}',variant.revisionLimit).replaceAll('{{continuationPeriod}}',variant.continuationPeriod).replaceAll('{{service}}',variant.service)}`).join('\n\n')}`).join('\n\n')}
` : '';
      const body = `---
type: hd-talk-script
script_id: "${script.id}"
version: "${script.version}"
products: "${(script.products || []).join('・')}"
updated: "${new Date().toISOString()}"
department: FS
system_parent: HDシステム
module: FS_トークスクリプト
---

# ${script.name}

- バージョン：${text(script.version)}
- 対象商材：${(script.products || []).join('・') || '未設定'}
- 対象顧客：${text(script.customer_type)}
- フェーズ数：${phases.length}

${phaseText}

${applicationText}

## HDシステム

- 親：[[FS]]
- 上位：[[HDシステム]]
- 機能：[[FS_トークスクリプト]]
`;
      return this.write(path.join('各種スクリプト', `${safeName(script.name)}.md`), body);
    });
  }
  syncObjectionBooks(store) {
    const scripts = store.catalog().scripts.filter(item => item.status === 'published');
    return scripts.map(script => {
      const savedNotes = store.objectionNotes(script.id, 500);
      const history = store.db.prepare(`SELECT a.*,s.customer_name FROM ai_suggestions a
        JOIN sales_sessions s ON s.id=a.session_id WHERE s.talk_script_id=? ORDER BY a.created_at DESC`).all(script.id);
      const notesText = savedNotes.map(note => `## ${new Date(note.created_at).toLocaleString('ja-JP')}｜${text(store.session(note.session_id)?.customer_name)}

**相手の反応**

${text(note.reaction_summary)}

**実際の発言・殴り書き**

${text(note.memo)}

**取れた言質**

${lines(note.commitments || [])}

**アウトの兆候**

${lines(note.objection_signals || [])}

**次に来そうなアウトと返し方**

${(note.predicted_objections || []).length ? note.predicted_objections.map(item => `### ${item.category}｜${item.subcategory}

返答：${item.responseText}

次に確認：${item.nextQuestion}`).join('\n\n') : 'なし'}
`).join('\n');
      const historyText = history.map(item => `- ${new Date(item.created_at).toLocaleString('ja-JP')}｜${item.customer_name || '店舗名未設定'}｜${item.customer_statement || '発言未入力'}｜分類：${item.detected_objection}`).join('\n');
      const body = `---
type: hd-objection-book
talk_script: "${String(script.name).replaceAll('"', '\\"')}"
script_id: "${script.id}"
updated: "${new Date().toISOString()}"
---

# ${script.name} アウト返し集

## 発生したアウト一覧

${historyText || '記録なし'}

# 反応・言質・返答記録

${notesText || '記録なし'}

## HDシステム

- 親：[[FS]]
- 上位：[[HDシステム]]
- 機能：[[FS_トークスクリプト]]
`;
      return this.write(path.join('アウト返し集', `${safeName(script.name)} アウト返し集.md`), body);
    });
  }
  syncLibraries(store) {
    return [...this.syncTalkScripts(store), ...this.syncObjectionBooks(store)];
  }
  syncAll(store) {
    return [
      ...store.preparations(500).map(item => this.syncPreparation(store, item.id)),
      ...store.recent(500).map(item => this.syncSession(store, item.id)),
      ...this.syncLibraries(store)
    ].filter(Boolean);
  }
}
