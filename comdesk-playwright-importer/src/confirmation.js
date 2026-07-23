export function isExpectedSubmitConfirmation(type, message) {
  return type === 'confirm' && /本当に(?:よろしい|宜しい)ですか/.test(String(message || '').replace(/\s+/g, ' ').trim());
}

export function isExpectedImportStartedAlert(type, message) {
  const normalized = String(message || '').replace(/\s+/g, ' ').trim();
  return type === 'alert' && normalized.includes('保存しました') && normalized.includes('インポート処理を開始します') && normalized.includes('処理完了後に通知いたします');
}
