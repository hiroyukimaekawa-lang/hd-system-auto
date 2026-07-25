# コムデスク自動投入 ― Mac（ターミナル）用

Googleスプレッドシートの営業リストを、コムデスクへ自動で登録します。
**上から順番にコマンドをコピー＆ペーストするだけ**で動きます。

- VS Codeは必要ありません。**Mac標準の「ターミナル」アプリ**だけで完結します。
  （VS Codeの中でやっていたのと同じことが、ターミナルアプリでそのままできます）
- 「準備」は最初の1回だけ。ふだんは「毎回の使い方」だけでOKです。
- リンクは必ず「**リンクを知っている全員が閲覧可**」で共有してください。

---

## 最初に：ターミナルをこのフォルダで開く

VS Codeを使わず、Mac標準の「ターミナル」だけで開く方法です。どれか1つでOK。

### 方法1：Finderから開く（かんたん）

1. Finderでこのフォルダ（`hd-system-auto`）を見つけます。
2. フォルダを**右クリック**し、「**フォルダに新規ターミナル**」を選びます。
   - メニューに出ない場合は、`アップルメニュー →  システム設定 → キーボード →
     キーボードショートカット → サービス → 「フォルダに新規ターミナル」にチェック`
     を入れると出ます。

### 方法2：ターミナルを開いて場所を移動する（確実）

1. `command（⌘）＋ スペース` で Spotlight を開き、「**ターミナル**」と入力して Enter。
2. 開いたターミナルに、次を貼り付けて Enter。

   ```bash
   cd /Users/maekawahiroyuki/hd-system-auto
   ```

   （フォルダを別の場所へ移動した場合は、`cd ` と半角スペースまで入力してから、
   Finderのフォルダをターミナルへドラッグ＆ドロップするとパスが自動で入ります）

これ以降のコマンドは、すべてこのターミナルに貼り付けていきます。

---

## 準備（最初の1回だけ）

### 1. 必要なものを入れる

Node.jsが入っていない場合は <https://nodejs.org/ja> からLTS版を入れてから、次を実行します。

```bash
cd comdesk-playwright-importer
npm install
npm run install-browser
cd ..
```

### 2. コムデスクにログイン

```bash
cd comdesk-playwright-importer
npm run login
cd ..
```

自動で開いたChromeでいつも通りコムデスクにログインし、「プロジェクト管理」画面まで進んでから、**ターミナルに戻ってEnterキー**を押します（ログイン状態が保存されます。切れたときだけやり直せばOK）。

---
Mac（標準ターミナル / iTerm2）
ショートカットキー: Command (⌘) + T
メニュー操作: 画面上部のメニューバー「シェル」＞「新規タブ」

## 毎回の使い方

### A. 1件だけ投入する

まず確認（登録されません）。`ここにリンク` を貼り替えてください。

```bash
npm run comdesk:auto:dry -- --spreadsheet-url="ここにリンク"
```
https://docs.google.com/spreadsheets/d/1kV2g7j_facfQ2JuZ43TTtycj6s4yDXUb7xkPSk-9-wc/edit?usp=sharing


問題なければ本番投入します。

```bash
COMDESK_EXECUTE=true npm run comdesk:auto -- --spreadsheet-url="ここにリンク" --execute
```
https://docs.google.com/spreadsheets/d/1kV2g7j_facfQ2JuZ43TTtycj6s4yDXUb7xkPSk-9-wc/edit?usp=sharing
### B. 何件もまとめて投入する

**最初の1回だけ**、リスト用のファイルを作ります。

```bash
cp config/comdesk-batch.example.txt config/comdesk-batch.txt
```

`config/comdesk-batch.txt` をテキストエディットなどで開き、投入したいリンクを**1行に1つずつ**貼り付けて保存します（空行と、行頭が `#` の行は無視されます）。

まず確認（登録されません）。

```bash
npm run comdesk:batch:dry -- --list=config/comdesk-batch.txt
```

問題なければ本番投入します（リストの上から順番に投入されます）。

```bash
COMDESK_EXECUTE=true npm run comdesk:batch -- --list=config/comdesk-batch.txt --execute
```

---

## うまくいかないとき

| 症状 | 対処 |
| --- | --- |
| `command not found: node` | Node.jsが未インストール。<https://nodejs.org/ja> からLTS版を入れる |
| `command not found: npm` | 同上。Node.jsを入れると npm も一緒に入る |
| 「ログイン」や「取得できません」で止まる | ログインが切れています。準備の「2. コムデスクにログイン」をやり直す |
| 「スプレッドシートを取得できません」 | シートの共有を「リンクを知っている全員が閲覧可」にする |
| コマンドを貼っても `no such file or directory` | ターミナルが別の場所にいます。「最初に：ターミナルをこのフォルダで開く」をやり直す |

---

## 補足

- 投入の記録（状態・結果・ログ・停止時のスクリーンショット）は `data/comdesk-jobs/` に保存されます。
- 一括投入は、途中で1件失敗しても残りは続行し、最後に「成功○件／失敗○件」を表示します。1件でも失敗したら止めたい場合は、コマンドの末尾に ` --stop-on-error` を足します。
- LINEのテキストから自動実行する機能は今後の予定です（現在はこのターミナル操作で行います）。
- 仕組みや他機能の内部資料は `docs/内部メモ.md` にあります。
