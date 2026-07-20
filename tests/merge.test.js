import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSheetRows, compareHeaders, mergeSalesSources, normalizePhone } from '../src/merge/merge.js';

test('国際表記・記号付き電話番号を国内数字形式へ正規化する', () => assert.equal(normalizePhone('+81 (29) 885-4313'), '0298854313'));
test('空行と重複ヘッダーを削除する', () => {
  const result = cleanSheetRows([['名前','Tel1'],['店A','029-1'],['名前','Tel1'],[null,null]], 'test'); assert.deepEqual(result.rows, [['店A','029-1']]);
});
test('列順を含むヘッダー相違を検出する', () => assert.deepEqual(compareHeaders(['名前','Tel1'], ['Tel1','名前']), [{column:1,left:'名前',right:'Tel1'},{column:2,left:'Tel1',right:'名前'}]));
test('電話番号優先、電話なしは店舗名と住所で重複除外する', () => {
  const header=['名前','都道府県','住所１','Tel1'];
  const sheets={'04_SALES_カフェ':[header,['店A','茨城県','美浦村','029-1'],['店B','茨城県','美浦村','']]};
  const snapshot={sources:[{area:'美浦村',sheets},{area:'稲敷市',sheets:{'04_SALES_カフェ':[header,['別名','茨城県','稲敷市','0291'],[' 店B ','茨城県','美浦村','']]}}]};
  const result=mergeSalesSources(snapshot,['美浦村','稲敷市'],{'美浦村':2,'稲敷市':2});
  assert.equal(result.summary[0].duplicates,2); assert.equal(result.summary[0].after,2);
});
