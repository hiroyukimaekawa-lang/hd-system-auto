# Claude Code追加修正指示｜FS商談画面 フェーズ全件表示・アウト返し重なり解消

## 対象
`/Users/maekawahiroyuki/hd-system-auto`

今回の対象はFS商談実行画面のみです。トーク本文、DB、商談メモ、AI整理、アウト返し内容、Obsidian同期、資料連動、商談終了処理は変更しないでください。

## 1. 左フェーズ一覧
現在は左フェーズ一覧をスクロールしないと全フローが見えません。標準の8〜10フェーズでは、内部スクロールを禁止し、全フェーズを1画面内へ常時表示してください。

左一覧に表示するのは「フェーズ番号＋フェーズタイトル」だけです。目的、説明、確認事項、次へ進む条件、本文プレビューは表示しません。

8〜10フェーズ:
- `overflow-y: hidden`
- 全件必ず表示
- 行高、padding、font-size、gapをコンパクト化
- active項目だけ高さを増やさない

推奨例:
```css
.phase-rail-list {
  display: grid;
  grid-template-rows: repeat(var(--phase-count), minmax(0, 1fr));
  gap: 4px;
  height: 100%;
  min-height: 0;
}
.phase-rail-item {
  min-height: 0;
  padding: 5px 7px;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: center;
  gap: 5px;
}
.phase-rail-item .phase-title {
  font-size: clamp(11px, .8vw, 13px);
  line-height: 1.2;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  white-space: normal;
}
```

長い正式フェーズ名はデータ変更せず、左一覧だけ短縮ラベルを使って構いません。

11〜12フェーズはさらにコンパクト化して可能な限り全件表示。13フェーズ以上のみ例外的にグループ化を認めます。

完成条件:
- 1280x800で標準10フェーズ全件が見える
- 1440x900で標準10フェーズ全件が見える
- 左フェーズ一覧に縦スクロールバーが出ない

## 2. アウト返しの重なり解消
現在、タイトル横のアウト入力から候補を開くと候補カードが読み上げスクリプトの上へ重なっています。これは禁止です。

変更後:
```text
タイトル + アウト入力
目的

[アウト候補カード]
  アウト: 「無料なのが怪しい」
  ① ...
  ② ...
  ③ ...
  [別候補] [閉じる]

基本スクリプト
本文...
```

アウト候補カードは見た目はポップアップ風で構いませんが、中央カラムの通常document flow内で展開してください。カードの高さ分だけスクリプト本文を下へ押し下げます。

原則禁止:
```css
position: absolute;
position: fixed;
```

推奨:
```css
.objection-suggestion-panel {
  position: static;
  margin-top: 8px;
  max-height: 300px;
  overflow-y: auto;
}
```

候補は最大3件。各候補は2〜3行程度に抑え、長文は「全文を見る」で展開してください。

## 3. タイトル行
タイトルとアウト入力欄が互いに被らないようにします。

大画面:
```text
⑥ 決裁権の確認       [アウト内容を入力…] [相談]
目的...
```

1280px前後で窮屈なら:
```text
⑥ 決裁権の確認
目的...
[アウト内容を入力…………] [相談]
```

タイトルを押しつぶさないでください。

## 4. 空入力バグ
スクリーンショットのような `アウト：「」` は表示しないでください。

以下は候補取得しない:
- 空文字
- trim後空文字
- `「」`
- 引用符や句読点だけ

無効時は小さく `アウト内容を入力してください` と表示し、空popupを開かないこと。

## 5. 右メモ欄との重なり
アウト候補は中央カラム内だけに表示してください。右側の商談メモ上へは出さないでください。

役割:
- 左 = フェーズ
- 中央 = トーク + アウト候補
- 右 = 商談メモ

## 6. CSS
今回の正式定義は `desktop/public/css/fs-meeting.css` へ集約してください。`styles.css` から同じselectorを競合定義しないでください。

## 7. テスト
最低限確認:
- 10フェーズ全件が同時表示
- 左フェーズ内部スクロールなし
- 長いタイトル最大2行
- activeで他項目が押し出されない
- 全phaseクリック可能
- アウト候補が本文に重ならない
- 右メモ欄にも重ならない
- popup表示時は本文が下へ移動
- popup閉じると本文が戻る
- 最大3候補
- 空文字/`「」`でpopupなし
- Enter実行
- IME変換中Enter誤実行なし
- 1280x800 / 1440x900で横はみ出しなし

## 8. Claude Codeへ渡す文
```text
/Users/maekawahiroyuki/hd-system-auto を対象に、
docs/implementation-prompts/
CLAUDE_CODE_FS_PHASE_RAIL_AND_OBJECTION_OVERLAP_FIX.md
を最初から最後まで読み、記載内容を実装してください。

最重要は2点です。

1. FS商談画面左側のフェーズ一覧は、標準の8〜10フェーズでは内部スクロールを禁止し、全フェーズを1画面内に常時表示してください。番号＋タイトルだけをコンパクトに表示し、1280x800でも全10フェーズが見えることを完成条件にしてください。

2. タイトル横のアウト相談から出る候補カードが現在スクリプト本文へ重なっています。absolute/fixed overlayではなく、中央カラムの通常document flow内へ展開し、候補カードの高さ分だけスクリプト本文を下へ押し下げてください。スクリプト本文・右メモ欄へ1pxも重ならないことを完成条件にしてください。

空文字や「」だけでは候補popupを開かないでください。

既存のトーク本文、DB、商談メモ、AI整理、アウト返し内容、Obsidian同期は変更しないでください。

既存未コミット変更を保持し、今回はcommit・pushしないでください。

実装後にnpm testと利用可能な品質チェック、1280x800 / 1440x900のUI確認を行い、変更ファイル・UI確認・テスト結果を報告してください。
```
