import assert from 'node:assert/strict';
import test from 'node:test';
import { isExpectedImportStartedAlert, isExpectedSubmitConfirmation } from '../comdesk-playwright-importer/src/confirmation.js';
import { isReviewCountConsistent, parseReviewCounts } from '../comdesk-playwright-importer/src/review.js';

test('コムデスク送信時の想定確認だけを許可する', () => {
  assert.equal(isExpectedSubmitConfirmation('confirm', '本当によろしいですか？'), true);
  assert.equal(isExpectedSubmitConfirmation('confirm', '本当に宜しいですか？'), true);
  assert.equal(isExpectedSubmitConfirmation('alert', '本当によろしいですか？'), false);
  assert.equal(isExpectedSubmitConfirmation('confirm', '削除しますか？'), false);
});

test('重複確認画面の件数を空白・表記揺れ込みで取得する', () => {
  assert.deepEqual(parseReviewCounts('新規件数: 40件 重複(2件) 禁止番号 ( 1件 )'), { newRows:40, duplicates:2, blocked:1 });
  assert.deepEqual(parseReviewCounts('読み込み中'), { newRows:0, duplicates:0, blocked:0 });
});

test('重複と禁止番号が同じ行を含む場合も投入件数と整合する', () => {
  assert.equal(isReviewCountConsistent(108, { newRows:107, duplicates:1, blocked:1 }), true);
  assert.equal(isReviewCountConsistent(109, { newRows:107, duplicates:1, blocked:1 }), true);
  assert.equal(isReviewCountConsistent(110, { newRows:107, duplicates:1, blocked:1 }), false);
});

test('インポート開始を知らせる2段階目のダイアログだけを許可する', () => {
  const message = '保存しました。インポート処理を開始します。\n処理完了後に通知いたします。';
  assert.equal(isExpectedImportStartedAlert('alert', message), true);
  assert.equal(isExpectedImportStartedAlert('confirm', message), false);
  assert.equal(isExpectedImportStartedAlert('alert', '保存しました。'), false);
});
