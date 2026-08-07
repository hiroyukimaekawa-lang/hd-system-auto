import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

// FS UIのレイアウト・簡略化要件をブラウザで確認するスモークテスト。
// 実データベース（state/sales-assist.sqlite）を使うため、作成した確認用案件は必ず削除する。
const PORT = 43119;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const response = await fetch(url);
        if (response.ok || response.status === 404) return resolve();
      } catch {}
      if (Date.now() - start > timeoutMs) return reject(new Error('サーバーが起動しませんでした'));
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

test('FS UI レイアウト・簡略化のスモークテスト', async () => {
  const server = spawn(process.execPath, ['desktop/server.js'], {
    env: { ...process.env, HD_ASSISTANT_PORT: String(PORT) },
    stdio: 'ignore'
  });
  const browser = await chromium.launch();
  let dealId = null;
  try {
    await waitForServer(`${BASE_URL}/`);
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    await page.waitForSelector('#fs-sidebar button');

    // ===== サイドバー：横スクロールが出ない（文字被り・はみ出しなし） =====
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const overflow = await page.evaluate(() => {
        const sidebar = document.querySelector('#fs-sidebar');
        return sidebar.scrollWidth - sidebar.clientWidth;
      });
      assert.ok(overflow <= 1, `sidebar overflow at ${viewport.width}px: ${overflow}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // ===== トークスクリプトテンプレ一覧：カードのボタンがカード外へ出ない =====
    await page.evaluate(() => window.show('templates'));
    await page.waitForSelector('#home-template-list article');
    await page.click('#toggle-script-admin');
    await page.waitForSelector('#admin-script-cards .script-card');
    const cardOverflow = await page.evaluate(() => {
      const results = [];
      for (const card of document.querySelectorAll('#admin-script-cards .script-card')) {
        const cardBox = card.getBoundingClientRect();
        for (const button of card.querySelectorAll('footer button')) {
          const buttonBox = button.getBoundingClientRect();
          if (buttonBox.right > cardBox.right + 1) results.push('overflow');
        }
      }
      return results;
    });
    assert.equal(cardOverflow.length, 0, 'script-card footer buttons must stay inside the card');

    // ===== 商談実行画面（左）：フェーズ一覧は内部スクロール禁止・全件常時表示 =====
    await page.evaluate(() => window.show('assist'));
    await page.waitForSelector('.script-panel');
    for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      const railState = await page.evaluate(() => {
        const rail = document.querySelector('.phase-rail');
        const buttons = [...document.querySelectorAll('#phase-list [data-phase]')];
        const railRect = rail.getBoundingClientRect();
        const allWithin = buttons.every(button => {
          const r = button.getBoundingClientRect();
          return r.top >= railRect.top - 1 && r.bottom <= railRect.bottom + 1;
        });
        return {
          overflow: rail.scrollHeight - rail.clientHeight,
          overflowY: getComputedStyle(rail).overflowY,
          buttonCount: buttons.length,
          allWithin,
          text: document.getElementById('phase-list').textContent
        };
      });
      assert.ok(railState.overflow <= 1, `phase-rail must not overflow at ${viewport.width}x${viewport.height}: ${railState.overflow}`);
      assert.equal(railState.overflowY, 'hidden', `phase-rail overflow-y must stay hidden for the standard phase count at ${viewport.width}x${viewport.height}`);
      assert.equal(railState.buttonCount, 8, '標準フローは8フェーズであること');
      assert.ok(railState.allWithin, `all phase buttons must stay within the rail bounds at ${viewport.width}x${viewport.height}`);
      assert.ok(!railState.text.includes('HP無料制作の商談という認識をそろえ'), '左フェーズ一覧に目的（本文プレビュー）が表示されていないこと');
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // ===== 商談実行画面（中央）：SCRIPT_MINIMAL_UI 要件 =====
    const centerState = await page.evaluate(() => {
      const visible = el => !!el && (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null);
      return {
        contextFieldsVisible: visible(document.getElementById('context-fields')),
        secondaryInfoVisible: visible(document.getElementById('meeting-secondary-info')),
        returnSelectVisible: visible(document.querySelector('.return-select-label')),
        returnStepVisible: visible(document.getElementById('return-step')),
        stepButtons: [...document.querySelectorAll('.step-actions button')].filter(visible).map(b => b.id),
        titleFontSize: parseFloat(getComputedStyle(document.querySelector('.meeting-phase-title')).fontSize),
        scriptPanelText: document.querySelector('.script-panel').textContent
      };
    });
    assert.equal(centerState.contextFieldsVisible, false, 'HPの役割・中央側の商談メモは非表示であること');
    assert.equal(centerState.secondaryInfoVisible, false, '確認事項・次へ進む条件・使用禁止表現は非表示であること');
    assert.equal(centerState.returnSelectVisible, false, '戻る場所を選択は非表示であること');
    assert.equal(centerState.returnStepVisible, false, '選択した場所へ戻るボタンは非表示であること');
    assert.deepEqual(centerState.stepButtons, ['previous-step', 'objection-button', 'next-step'], '中央ナビゲーションは前へ/アウト/次への3つだけであること');
    assert.ok(centerState.titleFontSize <= 26, `フェーズタイトルは小型化されていること（${centerState.titleFontSize}px）`);
    assert.ok(!centerState.scriptPanelText.includes('このフェーズの目的'), '「このフェーズの目的」の大カード文言が残っていないこと');

    // ===== 商談実行画面（右）：MEMO_UNIFIED_UI 要件 =====
    const rightState = await page.evaluate(() => {
      const visible = el => !!el && (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null);
      const noteColumn = document.querySelector('.note-column');
      return {
        visibleTextareas: [...noteColumn.querySelectorAll('textarea')].filter(visible).length,
        hasReactionAnalysisHeading: document.body.textContent.includes('REACTION ANALYSIS'),
        hasOldMemoHeading: document.body.textContent.includes('殴り書きメモ'),
        hasOldDescription: document.body.textContent.includes('質問したときの反応、相手が実際に言ったこと'),
        memoHistoryOpen: document.getElementById('memo-history')?.open,
        objectionSuggestOpen: document.getElementById('objection-suggest')?.open,
        memoInputHeight: document.getElementById('meeting-memo-input').getBoundingClientRect().height
      };
    });
    assert.equal(rightState.visibleTextareas, 1, '右サイドバーに表示される自由入力textareaは1つだけであること');
    assert.equal(rightState.hasReactionAnalysisHeading, false, 'REACTION ANALYSIS の見出しが残っていないこと');
    assert.equal(rightState.hasOldMemoHeading, false, '殴り書きメモの見出しが残っていないこと');
    assert.equal(rightState.hasOldDescription, false, '反応・言質のAI整理の説明文が残っていないこと');
    assert.equal(rightState.memoHistoryOpen, false, '過去メモは初期状態で折りたたまれていること');
    assert.equal(rightState.objectionSuggestOpen, false, 'アウト返し候補は初期状態で折りたたまれていること');
    assert.ok(rightState.memoInputHeight >= 200, `商談メモ入力欄は十分な高さであること（${rightState.memoInputHeight}px）`);

    // ===== 実際の商談セッションでメモ入力→AI整理までを一通り確認 =====
    const session = await page.evaluate(async () => {
      const prep = await fetch('/api/sales/preparations', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ departmentId: 'hd', talkScriptId: 'hd-new-ap-20260725', customerName: 'UIスモークテスト店舗', staffId: 'QA' })
      }).then(r => r.json());
      const opened = await fetch(`/api/sales/preparations/${prep.preparation.id}/open`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
      }).then(r => r.json());
      await window.enterSalesSession(opened.session);
      return opened.session;
    });
    dealId = session.deal_id || session.id;

    await page.fill('#meeting-memo-input', 'テスト入力：無料なのはかなり疑っている。HP自体は作りたいと発言。');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('memo-history').hidden);
    const memoSaved = await page.evaluate(() => document.getElementById('meeting-memo-list').textContent.includes('無料なのはかなり疑っている'));
    assert.ok(memoSaved, 'Enterでメモが保存され、過去メモに反映されること');
    assert.equal(await page.inputValue('#meeting-memo-input'), '', 'Enterで送信後、入力欄はクリアされること');

    await page.click('#save-scratch-analysis');
    await page.waitForFunction(() => !document.getElementById('predicted-objections').textContent.includes('メモを入力して'));
    const aiResultText = await page.evaluate(() => document.getElementById('predicted-objections').textContent);
    assert.ok(aiResultText.trim().length > 0, 'AI整理して保存を押すとAI整理結果が表示されること');

    // ===== アウト即時相談：空文字/「」ではpopupを開かないこと =====
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const invalidValue of ['', '「」', '　', '。、']) {
      await page.fill('#quick-objection-input', invalidValue);
      await page.click('#quick-objection-form button[type=submit]');
      await page.waitForTimeout(150);
      const invalidState = await page.evaluate(() => ({
        popupHidden: document.getElementById('quick-objection-popup').hidden,
        hintHidden: document.getElementById('quick-objection-inline-hint').hidden,
        hintText: document.getElementById('quick-objection-inline-hint').textContent
      }));
      assert.equal(invalidState.popupHidden, true, `無効な入力(${JSON.stringify(invalidValue)})ではpopupを開かないこと`);
      assert.equal(invalidState.hintHidden, false, `無効な入力(${JSON.stringify(invalidValue)})では入力を促す小さな案内を表示すること`);
      assert.equal(invalidState.hintText, 'アウト内容を入力してください');
    }

    // ===== アウト即時相談：候補カードは中央カラムのdocument flow内に展開し、本文・右メモへ重ならないこと =====
    // 直前の無効入力ループで表示された案内文を消してから基準位置を測る
    await page.fill('#quick-objection-input', '');
    await page.waitForTimeout(150);
    const beforeScriptTop = await page.evaluate(() => document.getElementById('base-script').getBoundingClientRect().top);
    await page.fill('#quick-objection-input', '無料なのが怪しいと言われた');
    await page.click('#quick-objection-form button[type=submit]');
    await page.waitForFunction(() => document.getElementById('quick-objection-popup').hidden === false);
    const popupState = await page.evaluate(() => {
      const rectsOverlap = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
      const popup = document.getElementById('quick-objection-popup').getBoundingClientRect();
      const script = document.getElementById('base-script').getBoundingClientRect();
      const note = document.querySelector('.note-column').getBoundingClientRect();
      return {
        position: getComputedStyle(document.getElementById('quick-objection-popup')).position,
        candidateCount: document.querySelectorAll('#quick-objection-candidates .quick-objection-candidate').length,
        overlapsScript: rectsOverlap(popup, script),
        overlapsNote: rectsOverlap(popup, note),
        scriptTop: script.top
      };
    });
    assert.notEqual(popupState.position, 'absolute', 'アウト候補カードはposition:absoluteで重ねないこと');
    assert.notEqual(popupState.position, 'fixed', 'アウト候補カードはposition:fixedで重ねないこと');
    assert.ok(popupState.candidateCount <= 3, `候補は最大3件であること（実際:${popupState.candidateCount}）`);
    assert.equal(popupState.overlapsScript, false, 'アウト候補カードが基本スクリプト本文へ重ならないこと');
    assert.equal(popupState.overlapsNote, false, 'アウト候補カードが右側の商談メモへ重ならないこと');
    assert.ok(popupState.scriptTop > beforeScriptTop + 20, 'popup表示時は候補カードの高さ分だけ本文が下へ押し下げられること');

    await page.click('#quick-objection-close');
    await page.waitForTimeout(150);
    const closedScriptTop = await page.evaluate(() => document.getElementById('base-script').getBoundingClientRect().top);
    assert.ok(Math.abs(closedScriptTop - beforeScriptTop) <= 2, 'popupを閉じると本文が元の位置へ戻ること');

    // ===== 商談終了モーダル：見切れなし =====
    await page.click('#finish-button');
    await page.waitForSelector('#finish-dialog[open]');
    const dialogState = await page.evaluate(() => {
      const dialog = document.getElementById('finish-dialog');
      const rect = dialog.getBoundingClientRect();
      const saveButton = document.getElementById('save-finish').getBoundingClientRect();
      return { withinViewportHeight: rect.height <= window.innerHeight + 1, saveButtonVisible: saveButton.bottom <= window.innerHeight + 1 && saveButton.top >= 0 };
    });
    assert.ok(dialogState.withinViewportHeight, '商談終了モーダルはviewport内に収まること');
    await page.click('#finish-dialog button[value="cancel"]');
  } finally {
    if (dealId) {
      try { await fetch(`${BASE_URL}/api/fs/deals/${encodeURIComponent(dealId)}`, { method: 'DELETE' }); } catch {}
    }
    await browser.close();
    server.kill();
  }
});
