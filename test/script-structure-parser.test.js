import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseScriptStructure, splitHeadingSections, buildParagraphPhases } from '../src/script-structure-parser.js';

const RAW = fs.readFileSync('config/fs-sales/import/HD_TALK_SCRIPT_INTERVIEW_20260806_RAW.md', 'utf8');
const GUIDE = JSON.parse(fs.readFileSync('config/fs-sales/import/HD_TALK_SCRIPT_INTERVIEW_20260806_EXPECTED_PHASES.json', 'utf8')).phaseGuide;

test('2026/08/06 RAWを同梱ガイドで解析すると10フェーズ前後になり、原文が保持される（LLM不要）', () => {
  const result = parseScriptStructure(RAW, { phaseGuide: GUIDE });
  assert.equal(result.title, 'HDトークスクリプト（取材アポ版）');
  assert.equal(result.version, '2026/08/06');
  assert.ok(result.phases.length >= 10 && result.phases.length <= 12, `10フェーズ前後（実際:${result.phases.length}）`);
  assert.deepEqual(result.phases.map(p => p.order), result.phases.map((p, i) => i + 1));
  // 原文の言い換え・誤字修正をしないことを確認する（代表的な固有名詞・金額表現がそのまま残る）
  const joined = result.phases.map(p => p.script).join('\n');
  assert.match(joined, /GrowthPathの魚井と申します。/);
  assert.match(joined, /13,650円/);
  assert.match(joined, /Growtath/, '誤字（Growtath）も勝手に修正しない');
  assert.deepEqual(result.referenceLinks, [
    'https://www.growth-path.jp/',
    'https://www.growth-path.jp/works',
    'https://enepal.co.jp/',
    'https://enepal.co.jp/wp/wp-content/uploads/2025/03/farelist_palpower_20250401.pdf',
    'https://enepal.co.jp/palpower-energy/area-price/kanto/',
    'https://sankouin.netlify.app/',
    'https://artcrafter.jp/'
  ]);
});

test('見出しが無い自由文でもLLM無しで段落単位にフェーズ化できる（フォールバック）', () => {
  const result = parseScriptStructure('最初の段落です。\n\n二番目の段落です。もう少し長めにしてみます。');
  assert.equal(result.headingCount, 0);
  assert.ok(result.phases.length >= 1);
  assert.match(result.phases[0].title, /自動生成・要確認/);
});

test('【見出し】単位で決定的に分割できる（HeadingRuleParser）', () => {
  const { sections, preamble } = splitHeadingSections('前置きです。\n\n【A】\n本文A\n\n【B】\n本文B');
  assert.match(preamble, /前置きです/);
  assert.deepEqual(sections.map(s => s.heading), ['A', 'B']);
  assert.equal(sections[0].body, '本文A');
});

test('Yes/No分岐と＜想定アウト＞を本文はそのまま保ちつつ別枠として抽出する', () => {
  const result = parseScriptStructure(RAW, { phaseGuide: GUIDE });
  const agenda = result.phases[0];
  assert.ok(agenda.branches.some(b => b.condition === 'Yes' && b.action === 'そのまま進める'));
  const hearing = result.phases.find(p => p.title === 'ホームページのヒアリング');
  assert.deepEqual(hearing.objectionHints, ['ホットペッパーだけでいい。', 'SNSだけでいい。', '小さいお店だから。などなど']);
});

test('段落フォールバックのブロック上限を超えても本文を失わない', () => {
  const blocks = Array.from({ length: 5 }, (_, i) => `段落${i + 1}`).join('\n\n');
  const phases = buildParagraphPhases(blocks, { maxChars: 5, maxPhases: 2 });
  const joined = phases.map(p => p.script).join('\n');
  for (let i = 1; i <= 5; i++) assert.match(joined, new RegExp(`段落${i}`));
});
