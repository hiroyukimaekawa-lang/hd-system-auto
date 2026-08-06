import crypto from 'node:crypto';

// 商談で扱う商材。表示名と内部IDは要件書のとおり固定する。
export const MEETING_PRODUCTS = [
  { code:'enepal', label:'エネパル' },
  { code:'amex', label:'AMEX' },
  { code:'smbc_business_owners', label:'三井住友ビジネスオーナーズ' },
  { code:'acom_ac_mastercard', label:'アコム（ACマスターカード）' }
];
export const NO_PRODUCT_CODE = 'none';
export const PRODUCT_LABEL = Object.fromEntries([...MEETING_PRODUCTS.map(item => [item.code, item.label]), [NO_PRODUCT_CODE, '今回は商材提案なし']]);
export const NOTE_SOURCES = ['during_meeting','closing_form','post_meeting'];
export const ANALYSIS_STATUS = ['pending','completed','failed','stale'];
export const ANALYSIS_DISCLAIMER = 'AI解析は原文メモをもとにした補助情報です。重要な判断は原文と実際の確認内容をもとに行ってください。';

// 「商材提案なし」は他商材と同時に選べない
export function normalizeProducts(codes = []) {
  const list = [...new Set((Array.isArray(codes) ? codes : [codes]).map(value => String(value || '').trim()).filter(Boolean))];
  if (list.includes(NO_PRODUCT_CODE)) {
    if (list.length > 1) throw new Error('「今回は商材提案なし」は他の商材と同時に選択できません');
    return [NO_PRODUCT_CODE];
  }
  const allowed = MEETING_PRODUCTS.map(item => item.code);
  const unknown = list.filter(code => !allowed.includes(code));
  if (unknown.length) throw new Error(`扱えない商材が含まれています：${unknown.join('、')}`);
  return allowed.filter(code => list.includes(code));
}

// メモ・商材・次の行動が変わったかどうかだけを見るためのハッシュ
export function sourceHash({ notes = [], products = [], nextAction = '', reflection = '' } = {}) {
  const payload = JSON.stringify({
    notes:notes.map(note => `${note.id}:${note.content}`),
    products:[...products].sort(),
    nextAction:String(nextAction || '').trim(),
    reflection:String(reflection || '').trim()
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

const SECTION_ORDER = ['summary','facts','commitments','concerns','decisionMaker','productStatus','nextActions','missingInfo','temperature'];
const SECTION_LABELS = {
  summary:'商談要約', facts:'確認できた事実', commitments:'相手の発言・言質', concerns:'懸念・未確認事項',
  decisionMaker:'決裁者・確認者', productStatus:'商材別の状況', nextActions:'次に行うこと',
  missingInfo:'不足している回収情報', temperature:'相手の温度感'
};
const sentences = text => String(text || '')
  .split(/[\n。]/)
  .map(value => value.trim())
  .filter(Boolean);
const uniq = list => [...new Set(list)];
const pickSentences = (lines, pattern, limit = 6) => uniq(lines.filter(line => pattern.test(line))).slice(0, limit);

// LLMを使わない決定論的な整理。将来 analyze を差し替えれば外部AIへ移行できる。
export function analyzeMeeting({ notes = [], products = [], nextAction = '', reflection = '', isNotes = '', requiredAnswers = [] } = {}) {
  const noteLines = notes.flatMap(note => sentences(note.content));
  const lines = uniq([...noteLines, ...sentences(isNotes), ...requiredAnswers.flatMap(value => sentences(value))]);
  const facts = pickSentences(lines, /電力|電気|明細|現在|使って|利用|契約|料金|プラン|会社は|台|人|席|営業/);
  const commitments = uniq([
    ...noteLines.filter(line => /「.+」/.test(line)),
    ...pickSentences(noteLines, /作りたい|進めたい|やりたい|お願い|検討|前向き|興味|問題なければ/)
  ]).slice(0, 6);
  const concerns = pickSentences(lines, /不安|懸念|心配|確認が必要|相談|わからない|分からない|未確認|奥様|旦那|家族|検討したい|高い|迷/);
  const decisionMaker = pickSentences(lines, /奥様|旦那|夫|妻|家族|共同経営|社長|本部|決裁|相談/, 4);
  const missingInfo = pickSentences(lines, /後日|未回収|未提出|送付|送る|もらう|回収|届いたら|確認する/, 6);
  const productStatus = products.length
    ? products.map(code => {
      const label = PRODUCT_LABEL[code] || code;
      if (code === NO_PRODUCT_CODE) return `${label}`;
      const related = noteLines.filter(line => new RegExp(`${label}|${code}`, 'i').test(line)).slice(0, 2);
      return `${label}：${related.length ? related.join(' / ') : '記録なし（メモに該当の記載がありません）'}`;
    })
    : ['商材が選択されていません'];
  const positive = commitments.length + facts.length;
  const negative = concerns.length;
  const temperature = !noteLines.length ? '判断材料なし：メモが記録されていません'
    : positive > negative * 2 ? '高い：前向きな発言が多く、条件が合えば進む可能性が高い'
    : negative > positive ? '低〜中：懸念や未確認事項が多く、確認待ちの状態'
    : '中：前向きな発言と懸念が両方あり、条件次第';
  const summaryParts = [];
  if (commitments.length) summaryParts.push(`前向きな発言：${commitments[0]}`);
  if (concerns.length) summaryParts.push(`確認が必要：${concerns[0]}`);
  if (String(nextAction || '').trim()) summaryParts.push(`次の行動：${String(nextAction).trim()}`);
  const analysis = {
    summary:summaryParts.length ? summaryParts.join(' / ') : '整理できる内容がまだありません。メモを追記してください。',
    facts, commitments, concerns, decisionMaker, productStatus,
    nextActions:uniq([String(nextAction || '').trim(), ...pickSentences(lines, /次回|次に|明日|来週|後日|予定/, 4)].filter(Boolean)),
    missingInfo, temperature,
    reflection:String(reflection || '').trim()
  };
  return { analysis, text:analysisToText(analysis) };
}

export function analysisToText(analysis = {}) {
  return SECTION_ORDER
    .map(key => {
      const value = analysis[key];
      const body = Array.isArray(value) ? value.map(item => `・${item}`).join('\n') : String(value || '').trim();
      return body ? `■${SECTION_LABELS[key]}\n${body}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}
export { SECTION_LABELS as ANALYSIS_SECTION_LABELS };
