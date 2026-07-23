export const SUPPORTED_CATEGORIES = ['飲食店', 'ヘアサロン', 'アパレル', '花屋'];
export const INITIAL_PREFECTURES = ['茨城県', '神奈川県', '福島県', '長野県'];
export const OPTIONAL_PREFECTURES = ['静岡県', '新潟県', '宮城県'];

export function sourcesForCategory(category) { return category === '飲食店' ? ['googlemaps', 'tabelog'] : ['googlemaps']; }

export function preflightEnvironment(env = process.env, { executeComdesk = false } = {}) {
  const errors = [];
  if (!['AFFILIATE', 'ELECTRIC'].includes(env.SYSTEM_PROFILE)) errors.push('SYSTEM_PROFILEはAFFILIATEまたはELECTRICを明示してください');
  if (!env.GAS_WEB_APP_URL) errors.push('GAS_WEB_APP_URLが未設定です');
  if (!env.GAS_WEB_APP_SECRET || env.GAS_WEB_APP_SECRET.length < 16) errors.push('GAS_WEB_APP_SECRETは16文字以上で設定してください');
  if (executeComdesk && env.COMDESK_EXECUTE !== 'true') errors.push('COMDESK_EXECUTE=trueが必要です');
  return { ok: errors.length === 0, errors, profile: env.SYSTEM_PROFILE, maxSerpApiCalls: Number(env.MAX_SERPAPI_CALLS_PER_RUN || 500), minimumAutoAcceptScore: Number(env.MIN_AUTO_ACCEPT_SCORE || 85) };
}
