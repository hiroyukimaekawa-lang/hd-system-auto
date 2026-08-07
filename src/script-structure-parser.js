// 長文のトーク原稿を「見出し単位のフェーズ」へ構造化するパーサー。
// 原文は一切書き換えない（校正・言い換え・誤字修正をしない）。並べ替え・分割・結合の判断のみ行う。
//
//   ScriptStructureParser
//   ├── HeadingRuleParser   … 【見出し】行を境目にフェーズ化する（決定的・LLM不要）
//   └── OptionalLLMParser   … 見出しが無い自由文のときだけ、設定済みのLLM providerで構造化を補助する
//
import { safeUrl } from './url-safety.js';

const HEADING_LINE = /^【(.+)】$/;
const CIRCLED_DIGITS = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳'];
export const groupLabel = order => CIRCLED_DIGITS[order - 1] || `(${order})`;

// 【見出し】行を境に、本文を「前置き（タイトル・バージョン・参考リンクなど）」と「見出しセクション」へ分割する。
export function splitHeadingSections(text) {
  const lines = String(text || '').replaceAll('\r', '').split('\n');
  const sections = [];
  let preambleLines = [];
  let current = null;
  for (const line of lines) {
    const match = line.trim().match(HEADING_LINE);
    if (match) {
      if (current) sections.push(current);
      current = { heading: match[1].trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
    else preambleLines.push(line);
  }
  if (current) sections.push(current);
  return {
    preamble: preambleLines.join('\n').trim(),
    sections: sections.map((section, index) => ({ index, heading: section.heading, body: section.lines.join('\n').trim() }))
  };
}

export function extractTitle(text) {
  const match = String(text || '').match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

export function extractVersion(text) {
  const match = String(text || '').match(/バージョン[:：]\s*([^\n]+)/);
  return match ? match[1].trim() : '';
}

// http/https のURLだけを重複なく抽出する（資料URL・参考リンクの自動抽出用）
export function extractLinks(text) {
  const found = String(text || '').match(/https?:\/\/[^\s　）】」』]+/g) || [];
  const seen = new Set();
  const links = [];
  for (const raw of found) {
    const url = safeUrl(raw.replace(/[、。.,]+$/, ''));
    if (url && !seen.has(url)) { seen.add(url); links.push(url); }
  }
  return links;
}

// Yes/No分岐（「Yes：〜」「No：〜」で始まる行）を抽出する
export function extractBranches(body) {
  const branches = [];
  for (const line of String(body || '').split('\n')) {
    const match = line.trim().match(/^(Yes|No|はい|いいえ)[:：]\s*(.+)$/);
    if (match) branches.push({ condition: match[1], action: match[2].trim() });
  }
  return branches;
}

// ＜想定アウト＞ブロック配下の箇条書きを抽出する（本文は変更しない・別枠の参考情報として返すだけ）
export function extractObjectionHints(body) {
  const lines = String(body || '').split('\n');
  const startIndex = lines.findIndex(line => /^[＜<]\s*想定アウト\s*[＞>]$/.test(line.trim()));
  if (startIndex < 0) return [];
  const hints = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) break;
    if (/^[＜<].+[＞>]$/.test(line)) break;
    hints.push(line.replace(/^[・･\-]\s*/, ''));
  }
  return hints;
}

const phaseFromSections = (order, title, sections, { inlineHeadings = false } = {}) => {
  const body = inlineHeadings
    ? sections.map(section => `【${section.heading}】\n${section.body}`).join('\n\n')
    : sections.map(section => section.body).join('\n\n');
  return {
    order,
    group: groupLabel(order),
    title,
    script: body,
    branches: sections.flatMap(section => extractBranches(section.body)),
    objectionHints: sections.flatMap(section => extractObjectionHints(section.body)),
    sourceHeadings: sections.map(section => section.heading)
  };
}

// 見出しが明確な原稿：LLM不要で決定的にフェーズ化する
export function buildHeadingPhases(sections) {
  return sections.map((section, i) => phaseFromSections(i + 1, section.heading, [section]));
}

// 同梱の phaseGuide（見出し→フェーズのまとめ方）に沿ってグループ化する。
// guideにない見出しが原稿に残っていた場合も、本文を失わないよう末尾へ追加フェーズとして残す。
export function buildGuidedPhases(sections, phaseGuide) {
  const used = new Set();
  const phases = phaseGuide.map(entry => {
    const matched = sections.filter(section => entry.headings.includes(section.heading));
    matched.forEach(section => used.add(section.index));
    return phaseFromSections(entry.order, entry.title, matched, { inlineHeadings: matched.length > 1 });
  }).filter(phase => phase.sourceHeadings.length > 0);
  const leftover = sections.filter(section => !used.has(section.index));
  let nextOrder = Math.max(0, ...phases.map(p => p.order)) + 1;
  for (const section of leftover) phases.push(phaseFromSections(nextOrder++, section.heading, [section]));
  return phases.sort((a, b) => a.order - b.order);
}

// 見出しが1つも無い自由文向けのフォールバック：空行区切りの段落をまとめてフェーズ化する（LLM不要）
export function buildParagraphPhases(text, { maxChars = 420, maxPhases = 20 } = {}) {
  const blocks = String(text || '').split(/\n\s*\n/).map(value => value.trim()).filter(Boolean);
  const phases = [];
  let current = '';
  const flush = () => {
    if (!current) return;
    const order = phases.length + 1;
    phases.push({ order, group: groupLabel(order), title: `フェーズ${order}（自動生成・要確認）`, script: current, branches: extractBranches(current), objectionHints: extractObjectionHints(current), sourceHeadings: [] });
    current = '';
  };
  for (const block of blocks) {
    if (phases.length >= maxPhases) { current = current ? `${current}\n\n${block}` : block; continue; }
    if (current && current.length + block.length > maxChars) flush();
    current = current ? `${current}\n\n${block}` : block;
  }
  flush();
  return phases;
}

// LLM providerが設定されている場合のみ使う任意の補助パーサー。未設定なら常にnullを返す（AIを騙って表記しない）。
export async function optionalLlmStructure(rawText, provider) {
  if (!provider?.available) return null;
  try { return await provider.parseScriptStructure(rawText); }
  catch { return null; }
}

// メインエントリ：見出しがあれば決定的パーサーのみで完結する（LLM不要）。
export function parseScriptStructure(rawText, { phaseGuide } = {}) {
  const text = String(rawText || '');
  const { preamble, sections } = splitHeadingSections(text);
  const title = extractTitle(preamble) || extractTitle(text);
  const version = extractVersion(preamble) || extractVersion(text);
  const referenceLinks = extractLinks(text);
  let phases;
  if (sections.length && phaseGuide?.length) phases = buildGuidedPhases(sections, phaseGuide);
  else if (sections.length) phases = buildHeadingPhases(sections);
  else phases = buildParagraphPhases(text);
  return { title, version, referenceLinks, phases, headingCount: sections.length };
}
