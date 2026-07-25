# コムデスク自動投入

Googleスプレッドシートの営業リストを、コムデスクへ自動で登録します。
**上から順番にコマンドをコピー＆ペーストするだけ**で動きます。

- お使いのパソコンに合わせて、**Mac** か **Windows** のどちらかの章だけを見てください。
- 「準備」は最初の1回だけ。ふだんは「毎回の使い方」だけでOKです。
- リンクは必ず「**リンクを知っている全員が閲覧可**」で共有してください。

---

# Mac（ターミナル）

## 準備（最初の1回だけ）

### 1. ターミナルをこのフォルダで開く

Finderでこのフォルダ（`hd-system-auto`）を右クリック →「**フォルダに新規ターミナル**」。
以降のコマンドは、このターミナルに貼り付けていきます。

### 2. 必要なものを入れる

Node.jsが入っていない場合は <https://nodejs.org/ja> からLTS版を入れてから、次を実行します。

```bash
cd comdesk-playwright-importer
npm install
npm run install-browser
cd ..
```

### 3. コムデスクにログイン

```bash
cd comdesk-playwright-importer
npm run login
cd ..
```

自動で開いたChromeでいつも通りコムデスクにログインし、「プロジェクト管理」画面まで進んでから、**ターミナルに戻ってEnterキー**を押します（ログイン状態が保存されます。切れたときだけやり直せばOK）。

## 毎回の使い方

### A. 1件だけ投入する

まず確認（登録されません）。`ここにリンク` を貼り替えてください。

```bash
npm run comdesk:auto:dry -- --spreadsheet-url="ここにリンク"
```

問題なければ本番投入します。

```bash
COMDESK_EXECUTE=true npm run comdesk:auto -- --spreadsheet-url="ここにリンク" --execute
```

### B. 何件もまとめて投入する

**最初の1回だけ**、リスト用のファイルを作ります。

```bash
cp config/comdesk-batch.example.txt config/comdesk-batch.txt
```

`config/comdesk-batch.txt` をテキストエディタで開き、投入したいリンクを**1行に1つずつ**貼り付けて保存します（空行と、行頭が `#` の行は無視されます）。

まず確認（登録されません）。

```bash
npm run comdesk:batch:dry -- --list=config/comdesk-batch.txt
```

問題なければ本番投入します（リストの上から順番に投入されます）。

```bash
COMDESK_EXECUTE=true npm run comdesk:batch -- --list=config/comdesk-batch.txt --execute
```

## うまくいかないとき（Mac）

| 症状 | 対処 |
| --- | --- |
| `command not found: node` | Node.jsが未インストール。<https://nodejs.org/ja> からLTS版を入れる |
| 「ログイン」や「取得できません」で止まる | ログインが切れています。準備の「3. コムデスクにログイン」をやり直す |
| 「スプレッドシートを取得できません」 | シートの共有を「リンクを知っている全員が閲覧可」にする |

---

# Windows（PowerShell）

## 準備（最初の1回だけ）

### 1. PowerShellをこのフォルダで開く

エクスプローラでこのフォルダ（`hd-system-auto`）を開き、**アドレスバーに `powershell` と入力してEnter**。
以降のコマンドは、このPowerShellに貼り付けていきます。

### 2. 必要なものを入れる

Node.jsが入っていない場合は、まず次を実行し、**終わったらPowerShellを一度閉じて開き直します**（手順1をやり直す）。

```powershell
winget install OpenJS.NodeJS.LTS
```

続いて、必要なものを入れます。

```powershell
cd comdesk-playwright-importer
npm install
npm run install-browser
cd ..
```

### 3. コムデスクにログイン

```powershell
cd comdesk-playwright-importer
npm run login
cd ..
```

自動で開いたChromeでいつも通りコムデスクにログインし、「プロジェクト管理」画面まで進んでから、**PowerShellに戻ってEnterキー**を押します（ログイン状態が保存されます。切れたときだけやり直せばOK）。

## 毎回の使い方

### A. 1件だけ投入する

まず確認（登録されません）。`ここにリンク` を貼り替えてください。

```powershell
npm run comdesk:auto:dry -- --spreadsheet-url="ここにリンク"
```

問題なければ本番投入します。

```powershell
$env:COMDESK_EXECUTE="true"; npm run comdesk:auto -- --spreadsheet-url="ここにリンク" --execute
```

### B. 何件もまとめて投入する

**最初の1回だけ**、リスト用のファイルを作ります。

```powershell
Copy-Item config\comdesk-batch.example.txt config\comdesk-batch.txt
```

`config\comdesk-batch.txt` をメモ帳で開き、投入したいリンクを**1行に1つずつ**貼り付けて保存します（空行と、行頭が `#` の行は無視されます）。

まず確認（登録されません）。

```powershell
npm run comdesk:batch:dry -- --list=config/comdesk-batch.txt
```

問題なければ本番投入します（リストの上から順番に投入されます）。

```powershell
$env:COMDESK_EXECUTE="true"; npm run comdesk:batch -- --list=config/comdesk-batch.txt --execute
```

## うまくいかないとき（Windows）

| 症状 | 対処 |
| --- | --- |
| `node : 用語 node は認識されません` | Node.js未インストール、または入れた後にPowerShellを開き直していない |
| `スクリプトの実行がシステムで無効` と出る | このPowerShellで `Set-ExecutionPolicy -Scope Process Bypass` を実行してから、もう一度貼り付ける |
| 「ログイン」や「取得できません」で止まる | ログインが切れています。準備の「3. コムデスクにログイン」をやり直す |
| 「スプレッドシートを取得できません」 | シートの共有を「リンクを知っている全員が閲覧可」にする |
| 日本語が文字化けする | cmd.exeではなくPowerShell（またはWindows Terminal）を使う |

---

## 補足

- 投入の記録（状態・結果・ログ・停止時のスクリーンショット）は `data/comdesk-jobs/` に保存されます。
- 一括投入は、途中で1件失敗しても残りは続行し、最後に「成功○件／失敗○件」を表示します。1件でも失敗したら止めたい場合は、コマンドの末尾に ` --stop-on-error` を足します。
- LINEのテキストから自動実行する機能は今後の予定です（現在はこのターミナル操作で行います）。
- 仕組みや他機能（Googleマップ収集・Slack・AIアシスタント等）の内部資料は `docs/内部メモ.md` にあります。
