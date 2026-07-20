# コムデスク CSV自動投入

Googleスプレッドシート等から出力したCSVまたはExcelを、Playwrightでコムデスクへ順番に投入します。APIは不要です。Excelの場合は、ジャンル名が入った各シートを自動でCSVへ変換して登録します。

## 最初の設定（1回だけ）

Node.js 20以上をインストールしたPCで、このフォルダを開いて実行します。

```bash
npm install
npm run install-browser
cp .env.example .env
```

`.env` の `COMDESK_URL` を、録画で最初に表示していたコムデスクの対象プロジェクトURLへ変更してください。

```env
COMDESK_URL=https://実際のコムデスクURL/対象画面
HEADLESS=false
SLOW_MO=150
TIMEOUT_MS=30000
```

次にログイン状態を保存します。

```bash
npm run login
```

開いたChromeでコムデスクへログインし、いつもCSVを投入する画面まで移動します。ターミナルへ戻り、Enterを押すとログイン状態が保存されます。パスワード自体は設定ファイルへ保存しません。

## 毎回の使い方

1. `data/inbox` に投入したいCSVまたはExcel（`.xlsx`）を入れる
2. 次を実行する

```bash
npm run import
```

処理後は次の場所へ自動で移動します。

- 成功：`data/success`
- 失敗：`data/failed`
- 実行結果・失敗時画像：`data/results`

すでに登録済みのワークグループを除外して残りだけ処理する場合は、次のように指定します。

```bash
npm run import:dry -- --skip-workgroups=カフェ
npm run import -- --skip-workgroups=カフェ
```

複数除外する場合はカンマ区切りにします。特定ジャンルだけテストする場合は`--only-workgroups`を使えます。

```bash
npm run import:dry -- --only-workgroups=居酒屋
```

プロジェクト名は`config.json`の`projectNameTemplate`から作成します。現在は`茨城県_{area}`のため、`那珂市.xlsx`内の各ジャンルはすべてプロジェクト名`茨城県_那珂市`で登録されます。ジャンルはワークグループで区別します。例：シート`04_SALES_スイーツ` → プロジェクト名`茨城県_那珂市`／ワークグループ`スイーツ`。

## 最初に安全確認する方法

CSVをアップロードせず、読み込み件数と列名だけ確認できます。

```bash
npm run import:dry
```

## コムデスク画面とボタン名が合わない場合

Playwrightは実際の画面要素に合わせて最終調整が必要です。次を実行し、ChromeでCSVインポート画面を開いてからEnterを押してください。

```bash
npm run inspect
```

`data/results/screen-elements.json` と画面画像が出力されます。その内容に合わせて `config.json` の `selectors` を修正します。通常はここを一度合わせれば、その後は自動実行できます。

## ワークグループと重複条件

`config.json` の `workgroupAliases` で、CSVファイル名とワークグループの対応を管理します。`美容室`または`ヘアサロン`を含むファイルは`美容院`、`ホテル`または`旅館`を含むファイルは`宿泊`へ登録する設定です。

重複条件は初期状態では「重複チェック有効・電話番号・テナント全体」です。`config.json` の `duplicateCheck` で変更できます。

登録後は通知を待ち、対象プロジェクトとワークグループに一致する重複確認画面を開いて「送信」し、完了通知まで確認します。待機時間は `config.json` の `finalizeImport` で変更できます。自動送信を止めたい場合は `enabled` を `false` にしてください。

## アサインユーザー

`config.json` の `assignUsers.users` に指定したユーザーを、プロジェクト登録時に全員「アクセスできるユーザー」へ移動します。初期設定は既存プロジェクトに合わせ、`開発管理用、高原、岩井、松岡、坂本、橋本、肥田野、前川、前田`です。画面上に指定ユーザーが見つからない場合は、誤登録を防ぐためそのプロジェクトの登録を停止します。

新しく追加されたユーザーも含め、画面上の全ユーザーを自動でアサインしたい場合は次の設定に変更できます。

```json
"assignUsers": {
  "mode": "all",
  "users": []
}
```

## 自動実行について

画面変更や二段階認証に対応できるよう、最初は `HEADLESS=false` のまま運用してください。安定後は `HEADLESS=true` に変更し、WindowsタスクスケジューラやMacのlaunchdで定時実行できます。
