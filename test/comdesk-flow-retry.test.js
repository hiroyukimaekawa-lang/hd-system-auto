import test from 'node:test';
import assert from 'node:assert/strict';
import { isTransientRegistrationUiFailure, mergeRetryResults } from '../comdesk-playwright-importer/src/flow.js';

test('空のワークグループ選択欄によるタイムアウトは通信再試行対象', () => {
  assert.equal(isTransientRegistrationUiFailure({
    status: 'failed',
    workgroup: 'カフェ',
    error: 'locator.selectOption: Timeout 30000ms exceeded. waiting for locator(\'select[name="client_id"]\')'
  }), true);
});

test('アサインユーザー未読込は通信再試行対象', () => {
  assert.equal(isTransientRegistrationUiFailure({
    status: 'failed',
    workgroup: '居酒屋',
    error: 'アサインユーザーの選択欄が見つかりません'
  }), true);
});

test('既存プロジェクト検知などの安全停止は自動再試行しない', () => {
  assert.equal(isTransientRegistrationUiFailure({
    status: 'failed',
    workgroup: '和食',
    error: '同じプロジェクト・ワークグループが既に存在するため停止しました'
  }), false);
});

test('再試行結果は対象ワークグループだけ置き換える', () => {
  const original = [
    { workgroup: 'カフェ', status: 'failed', error: 'timeout' },
    { workgroup: '居酒屋', status: 'success', importStatus: 'completed' }
  ];
  const retry = [
    { workgroup: 'カフェ', status: 'success', importStatus: 'completed' },
    { workgroup: '居酒屋', status: 'skipped' }
  ];
  const merged = mergeRetryResults(original, retry, new Set(['カフェ']));
  assert.equal(merged.find((item) => item.workgroup === 'カフェ').status, 'success');
  assert.equal(merged.find((item) => item.workgroup === '居酒屋').importStatus, 'completed');
});
