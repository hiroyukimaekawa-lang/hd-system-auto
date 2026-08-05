// FS商談資料の分類・検証・絞り込み。保存先に依存しない純粋なロジックだけを置く。
export const MATERIAL_CATEGORIES = ['talk','hp_company','case_study','electricity','contract','card_application','affiliate','other'];
export const MATERIAL_PRODUCTS = ['common','hp','enepal','amex','smbc_business_owners','ac_mastercard'];
export const MATERIAL_SOURCE_TYPES = ['google_slides','powerpoint','google_sheets','google_docs','pdf','website','other'];
export const MATERIAL_VISIBILITY = ['customer_shareable','fs_internal','admin_only'];
// 閲覧者ごとに見える公開範囲。顧客共有時は customer_shareable だけを渡す。
export const VIEWER_VISIBILITY = {
  customer:['customer_shareable'],
  fs:['customer_shareable','fs_internal'],
  admin:['customer_shareable','fs_internal','admin_only']
};
export const CATEGORY_LABELS = { talk:'トーク中に使用', hp_company:'HP・会社紹介', case_study:'制作事例', electricity:'電気・エネパル', contract:'申込書・契約', card_application:'カード申込', affiliate:'アフィリエイトリンク', other:'その他' };
// 商談資料ライブラリの表示グループ。使う場面ごとに分けて並べる。
export const MATERIAL_GROUPS = [
  { id:'talk', label:'商談中に使用する資料', description:'会社紹介・HPの必要性・制作事例など、画面共有しながら話す資料', categories:['talk','hp_company','case_study'], tags:['case_study','hp_quality'] },
  { id:'electricity', label:'電気・エネパルの説明資料', description:'料金表や契約条件など、電気の説明と比較に使う資料', categories:['electricity'], tags:[] },
  { id:'application', label:'申込時に使用する資料', description:'申込書の読み合わせ、カード申込、最新の申込リンク', categories:['contract','card_application','affiliate'], tags:[] },
  { id:'other', label:'その他', description:'', categories:['other'], tags:[] }
];
// カテゴリで振り分け、カテゴリが other でもタグで用途が分かるものは該当グループへ寄せる。
// 先に一致したグループへ1件だけ入れる。
export function groupMaterials(materials = []) {
  const sorted = [...materials].sort((a, b) => a.sortOrder - b.sortOrder || String(a.id).localeCompare(String(b.id)));
  const groupOf = item => MATERIAL_GROUPS.find(group => group.id !== 'other' && group.categories.includes(item.category))
    || MATERIAL_GROUPS.find(group => (group.tags || []).some(tag => (item.phaseTags || []).includes(tag)))
    || MATERIAL_GROUPS.at(-1);
  return MATERIAL_GROUPS
    .map(group => ({ ...group, materials:sorted.filter(item => groupOf(item).id === group.id) }))
    .filter(group => group.materials.length);
}
export const PRODUCT_LABELS = { common:'共通', hp:'HP制作', enepal:'エネパル', amex:'AMEX', smbc_business_owners:'三井住友ビジネスオーナーズ', ac_mastercard:'ACマスターカード' };
export const SOURCE_TYPE_LABELS = { google_slides:'Google Slides', powerpoint:'PowerPoint', google_sheets:'Google Sheets', google_docs:'Google Docs', pdf:'PDF', website:'Webページ', other:'その他' };
export const VISIBILITY_LABELS = { customer_shareable:'顧客共有可', fs_internal:'FS社内のみ', admin_only:'管理者のみ' };

// 資料URLは https のみ許可する（javascript: / data: / file: は保存させない）
export function safeMaterialUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch { return ''; }
  return url.protocol === 'https:' ? url.href : '';
}

const listOf = value => [...new Set((Array.isArray(value) ? value : String(value || '').split(/[\s,、]+/)).map(item => String(item).trim()).filter(Boolean))];
const pick = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;

export function normalizeMaterial(input = {}) {
  // IDは一覧のキーにしか使わないが、経路や属性へ紛れ込まないよう文字種を限定する
  const id = String(input.id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('資料IDは英数字・ハイフン・アンダースコアで指定してください');
  const title = String(input.title || '').trim();
  if (!title) throw new Error('資料名を入力してください');
  const url = safeMaterialUrl(input.url);
  if (!url) throw new Error('資料URLは https:// で始まる正しいURLを指定してください');
  const visibility = pick(input.visibility, MATERIAL_VISIBILITY, 'fs_internal');
  return {
    id,
    title,
    sourceTitle: String(input.sourceTitle || '').trim(),
    description: String(input.description || '').trim(),
    category: pick(input.category, MATERIAL_CATEGORIES, 'other'),
    product: pick(input.product, MATERIAL_PRODUCTS, 'common'),
    sourceType: pick(input.sourceType, MATERIAL_SOURCE_TYPES, 'other'),
    url,
    phaseTags: listOf(input.phaseTags),
    visibility,
    customerShareable: input.customerShareable === undefined ? visibility === 'customer_shareable' : Boolean(input.customerShareable),
    sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 999,
    active: input.active === undefined ? true : Boolean(input.active),
    companyId: String(input.companyId || '').trim(),
    createdBy: String(input.createdBy || '').trim(),
    updatedBy: String(input.updatedBy || '').trim()
  };
}

export const visibleTo = (material, viewer = 'fs') => (VIEWER_VISIBILITY[viewer] || VIEWER_VISIBILITY.fs).includes(material.visibility);

const PRODUCT_PATTERNS = {
  hp:/HP|ホームページ|ウェブ|Web/i,
  enepal:/エネパル|電気|電力|パルパワー/,
  amex:/AMEX|アメックス|アメリカン/i,
  smbc_business_owners:/三井住友|ビジネスオーナーズ/,
  ac_mastercard:/AC\s?マスター|ACカード|ACM/i
};
// 対象商材が未登録の案件では絞り込まない（資料バーが空になるのを避ける）
export function productMatches(product, products) {
  if (!product || product === 'common') return true;
  const text = String(products || '').trim();
  if (!text) return true;
  const pattern = PRODUCT_PATTERNS[product];
  return pattern ? pattern.test(text) : true;
}

export const phaseTagsFor = (phaseId, map = {}) => (map[phaseId] || []).slice();

export function selectPhaseMaterials(materials, { tags = [], products = '', limit = 4 } = {}) {
  const wanted = new Set(tags);
  if (!wanted.size) return [];
  return materials
    .filter(item => item.active && item.phaseTags.some(tag => wanted.has(tag)) && productMatches(item.product, products))
    .sort((a, b) => a.sortOrder - b.sortOrder || String(a.id).localeCompare(String(b.id)))
    .slice(0, Math.max(0, limit));
}
