const MAP = new Map([
  ['喫茶店','カフェ'],['コーヒースタンド','カフェ'],['パン','パン屋'],['ベーカリー','パン屋'],
  ['ケーキ','スイーツ'],['和菓子','スイーツ'],['中華料理','中華'],['餃子','中華'],
  ['そば','蕎麦・うどん'],['うどん','蕎麦・うどん'],['食堂','定食・食堂'],['弁当','テイクアウト専門店']
]);
const NAME_RULES = [
  [/居酒屋/,'居酒屋'],[/(?:カフェ|cafe|喫茶|珈琲|coffee)/i,'カフェ'],[/(?:ラーメン|拉麺|中華そば|つけ麺|油そば|麺屋|麺や)/,'ラーメン'],
  [/(?:そば|蕎麦|うどん|讃岐)/,'蕎麦・うどん'],[/(?:寿司|鮨)/,'寿司'],[/(?:焼肉|焼き肉)/,'焼肉'],[/(?:焼鳥|焼き鳥)/,'焼き鳥'],
  [/(?:パン屋|ベーカリー)/,'パン屋'],[/(?:中華|餃子)/,'中華'],[/韓国/,'韓国'],[/弁当/,'テイクアウト専門店']
];

export function normalizeGenre(raw, name, fallback = '') {
  for (const [pattern, genre] of NAME_RULES) if (pattern.test(String(name || '').normalize('NFKC'))) return genre;
  for (const part of String(raw || '').normalize('NFKC').split(/[、,]/).map(v => v.trim())) if (MAP.has(part)) return MAP.get(part);
  return fallback || String(raw || '').split(/[、,]/)[0].trim();
}
