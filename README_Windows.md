# コムデスク自動投入 ― Windows（PowerShell）用

Googleスプレッドシートの営業リストを、コムデスクへ自動で登録します。
**上から順番にコマンドをコピー＆ペーストするだけ**で動きます。

- VS Codeは必要ありません。**Windows標準の「PowerShell」**だけで完結します。
  （VS Codeの中でやっていたのと同じことが、PowerShellでそのままできます）
- 「準備」は最初の1回だけ。ふだんは「毎回の使い方」だけでOKです。
- リンクは必ず「**リンクを知っている全員が閲覧可**」で共有してください。

---

## 最初に：PowerShellをこのフォルダで開く

VS Codeを使わず、Windows標準のPowerShellだけで開く方法です。どれか1つでOK。

### 方法1：エクスプローラーのアドレスバーから開く（かんたん・おすすめ）

1. エクスプローラーでこのフォルダ（`hd-system-auto`）を開きます。
2. 画面上部の**アドレスバー**（フォルダの場所が出ている横長の欄）をクリックします。
3. そこに `powershell` と入力して Enter。
   → そのフォルダの場所でPowerShellが開きます。

### 方法2：スタートメニューから開いて場所を移動する（確実）

1. スタートメニューで「**PowerShell**」と検索して開きます
   （「Windows PowerShell」または「ターミナル」どちらでもOK）。
2. エクスプローラーでこのフォルダを **Shift を押しながら右クリック** →「**パスのコピー**」。
3. PowerShellに次を入力し、`ここに貼り付け` の部分を貼り付け（Ctrl+V）して Enter。

   ```powershell
   cd ここに貼り付け
   ```

   （パスは引用符 `"` 付きで貼り付けられます。そのままEnterで大丈夫です）

これ以降のコマンドは、すべてこのPowerShellに貼り付けていきます。

---

## 準備（最初の1回だけ）

### 1. Node.jsを入れる

入っていない場合は次を実行し、**終わったらPowerShellを一度閉じて開き直します**（「最初に」をやり直す）。

```powershell
winget install OpenJS.NodeJS.LTS
```

### 2. 必要なものを入れる

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

---

## 毎回の使い方

Windows（Windows Terminal）
ショートカットキー: Ctrl + Shift + T
マウス操作: ターミナル上部タブバーの +（プラス）アイコンをクリック

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

---

## うまくいかないとき

| 症状 | 対処 |
| --- | --- |
| `node : 用語 node は認識されません` | Node.js未インストール、または入れた後にPowerShellを開き直していない |
| `npm : 用語 npm は認識されません` | 同上。Node.jsを入れると npm も一緒に入る |
| `スクリプトの実行がシステムで無効になっています` | このPowerShellで次を1回実行してから、もう一度貼り付ける → `Set-ExecutionPolicy -Scope Process Bypass` |
| 「ログイン」や「取得できません」で止まる | ログインが切れています。準備の「3. コムデスクにログイン」をやり直す |
| 「スプレッドシートを取得できません」 | シートの共有を「リンクを知っている全員が閲覧可」にする |
| 日本語が文字化けする | cmd.exe（黒い画面）ではなく、PowerShell（またはWindows Terminal）を使う |
| コマンドを貼っても場所が違うと言われる | PowerShellが別の場所にいます。「最初に：PowerShellをこのフォルダで開く」をやり直す |

---

## 補足

- 投入の記録（状態・結果・ログ・停止時のスクリーンショット）は `data\comdesk-jobs\` に保存されます。
- 一括投入は、途中で1件失敗しても残りは続行し、最後に「成功○件／失敗○件」を表示します。1件でも失敗したら止めたい場合は、コマンドの末尾に ` --stop-on-error` を足します。
- LINEのテキストから自動実行する機能は今後の予定です（現在はこのPowerShell操作で行います）。
- 仕組みや他機能の内部資料は `docs\内部メモ.md` にあります。
