import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isExpectedImportStartedAlert,
  isExpectedSubmitConfirmation
} from '../comdesk-playwright-importer/src/confirmation.js';

test('Comdeskの正規の送信確認だけを許可する', () => {
  assert.equal(isExpectedSubmitConfirmation('confirm', '本当によろしいですか？'), true);
  assert.equal(isExpectedSubmitConfirmation('confirm', '本当に宜しいですか。'), true);
  assert.equal(isExpectedSubmitConfirmation('alert', '本当によろしいですか？'), false);
  assert.equal(isExpectedSubmitConfirmation('confirm', '削除してよろしいですか？'), false);
});

test('Comdeskの正規のインポート開始通知だけを許可する', () => {
  const expected = '保存しました。インポート処理を開始します。\n処理完了後に通知いたします。';
  assert.equal(isExpectedImportStartedAlert('alert', expected), true);
  assert.equal(isExpectedImportStartedAlert('confirm', expected), false);
  assert.equal(isExpectedImportStartedAlert('alert', '保存しました。'), false);
});
