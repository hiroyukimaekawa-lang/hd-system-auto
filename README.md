# HD Scraper Automation

現在手動で操作しているGoogleマップ・食べログ拡張機能を、無人実行するためのCLI版です。取得CLIに加え、Phase 2のDrive自動振り分け・GAS無人実行・完成CSV検知まで実装済みです。
既存の `hd-system` とは別リポジトリで管理する前提です。

## HD AIアシスタント（Mac）

デスクトップの「HD AIアシスタント.app」をクリックすると、ローカル専用のチャット画面が開きます。現在のMVPでは次を自然文で確認できます。

- 「茨城県の取得対象を確認して」
- 「土浦市のDrive接続を確認して」
- 「設定を確認して」

アプリを作り直す場合は `./scripts/install-mac-app.sh` を実行します。画面本体は `desktop/`、ローカルサーバーは `desktop/server.js` です。サーバーは `127.0.0.1` のみに公開され、秘密情報は画面へ表示しません。

## 現在できること

- `config/jobs.csv` に「エリア・検索キーワード・出力ジャンル・最大件数」を並べて一括実行
- Chromiumを自動操作してGoogleマップの一覧・詳細情報を取得
- 店名、Googleジャンル、住所、電話番号、営業時間、HP有無をCSV出力
- 1店舗ごとにJSONLへ保存し、停止やエラー後も取得済みURLをスキップして再開
- エリア×ジャンルごとに既存GASへ渡しやすい日本語列名のCSVを生成
- `sources` に `googlemaps,tabelog` を指定して両方を取得
- 食べログの403/429を検知すると回避せず `paused_rate_limit` として安全に停止
- Googleマップ20列、食べログ19列の既存CSV互換スキーマを維持
- 飲食店ルートから都道府県→市区町村を探索し、Driveの投入先を自動特定
- GASを5分間隔、排他ロック付きで無人実行し、完成CSVをジョブIDで検知

## Google Drive連携

`.env.example` を `.env` にコピーし、GAS WebアプリURL、共有シークレット、飲食店ルートIDを設定します。サービスアカウントやDrive APIの認証情報は不要です。

```text
GOOGLE_DRIVE_RESTAURANT_ROOT_FOLDER_ID=18aPI_8T7h9DqZ36rr4O9MrUon_ljjguC
GAS_WEB_APP_URL=https://script.google.com/macros/s/デプロイID/exec
GAS_WEB_APP_SECRET=十分に長いランダム文字列
```

Drive操作はWebアプリを「次のユーザーとして実行: 自分」でデプロイしたGoogleアカウントの権限で行います。探索は次の構造を厳密に確認します。

```text
飲食店/都道府県/市区町村/
  CSV投入フォルダ
  処理済みフォルダ
  完成版CSVエクスポート
  市区町村名と同名のGoogleスプレッドシート
```

探索結果はGASのキャッシュへ6時間保存されます。同名候補が複数ある場合や必要項目が無い場合はアップロードを開始せず、`DriveLocationError.toSlackMessage()` が候補IDを含む案内を返します。

Node側の主な連携関数は以下です。

- `resolveLocation()`：階層探索とキャッシュ
- `uploadJobCsvs()`：ジョブID付きCSVアップロードと二重投入防止
- `waitForExports()`：同一ジョブの完成CSV検知

## GASの無人実行設定

1. 対象スプレッドシートのApps Scriptへ `gas/headless-automation.gs` を追加します。
2. 既存コードの直書き `SERPAPI_KEY` を削除します。
3. Apps Scriptの「プロジェクトの設定→スクリプト プロパティ」に `SERPAPI_KEY` と `GAS_WEB_APP_SECRET` を登録します。
4. 「デプロイ→新しいデプロイ→ウェブアプリ」で「次のユーザーとして実行: 自分」としてデプロイし、発行URLを `GAS_WEB_APP_URL` に設定します。
5. エディタから `installCsvPollingTrigger()` を一度実行し、権限を許可します。

Webアプリは共有シークレットが一致しない要求を拒否します。シークレットはSlackトークンと同様にGitへ追加しないでください。Nodeから送信するCSVはHTTPSリクエスト内でBase64化され、GASが対象フォルダへ保存します。

## 茨城県の取得管理マスタ

管理スプレッドシート `15sKleuzRHxjbhOLw8c5b3mzoE_-JpGM1SeYgEvkUUbI` の「日別架電計画」を自動取得の管理マスタとして使用します。GASのスクリプトプロパティへ次を追加してください。

```text
MANAGEMENT_SPREADSHEET_ID=15sKleuzRHxjbhOLw8c5b3mzoE_-JpGM1SeYgEvkUUbI
```

`/hd-list-sheet 茨城県 飲食店` では「自動取得対象」がTRUEかつ「飲食取得完了」がFALSEの行だけを対象にします。取得開始・スクレイピング完了・GAS完了・エラーの各段階は `updateMasterStatus` Web APIで既存の状態列と追加管理列へ反映します。

最低統合件数に満たない市区町村は「44市町村マスター」の営業ルートと取得ジャンルが同じものを統合対象にします。統合版は `統合版_営業ルート_ジャンル_日時.csv` として完成版CSVフォルダへ追加し、元の市区町村別CSVは削除・移動しません。

以後は5分ごとにCSV投入フォルダを確認します。同時実行はスクリプトロックで防止され、入力に複数ジョブが混在した場合は停止します。後続処理が失敗した場合、先に処理済みへ移された入力CSVを投入フォルダへ戻し、`HD_LAST_ERROR` にエラー概要を保存します。成功時は完成CSVのdescriptionへ `jobId` を記録します。

重要：参考GASに含まれていた既存APIキーは漏えい済みとして失効・再発行してください。

## 初回セットアップ

Node.js 20以上を用意し、次を実行します。

```bash
npm install
npx playwright install chromium
```

## 使い方

1. `config/jobs.csv` を編集します。既存4列に加えて以下を利用できます。

| 列 | 内容 |
|---|---|
| `sources` | `googlemaps` または `googlemaps,tabelog`（省略時は従来互換でGoogleマップのみ） |
| `maxPages` | 食べログ一覧の最大ページ数 |
| `tabelogUrl` | エリア・ジャンル一覧URL。空欄ならキーワード検索URLを自動生成 |
2. 実行内容だけ確認します。

```bash
npm run dry-run
```

3. 最初は画面を表示し、Googleマップの表示と出力を確認します。

```bash
node src/cli.js run --config config/jobs.csv --headed
```

4. 問題なければ無人実行します。

```bash
npm start
```

CSVは `output/googlemaps_*.csv` と `output/tabelog_*.csv`、途中経過は `state/*_googlemaps.jsonl` と `state/*_tabelog.jsonl` に保存されます。同じ設定で再実行すると取得済みURLを飛ばして続きから動きます。旧Googleマップstateも自動で読み込むため、既存の美容院ジョブは継続できます。

少量確認用の例は `config/jobs.example.csv` です。対象サイトの利用規約とrobots.txtを運用前に確認し、低頻度・必要最小限で実行してください。CAPTCHAやアクセス制限の回避は行いません。

## 毎晩自動で動かす（Mac/Linux）

`crontab -e` に次のように登録します（パスと時刻は変更してください）。

```cron
0 1 * * * /absolute/path/hd-scraper-automation/scripts/run-nightly.sh
```

PCを閉じたりスリープした場合は動きません。完全な「寝ていても自動」を安定運用する場合は、常時起動PC、VPS、GitHub Actions等の実行環境が必要です。ただしGoogleマップは画面構造変更、同意画面、CAPTCHA等で停止する可能性があるため、最初は自分のPCで少量検証してください。

## 次のPhase

1. Slack Socket Mode、ジョブキュー、進捗・キャンセル・通知
2. Docker化、常時起動環境、自動再開

## 注意

対象サイトの利用規約、robots.txt、アクセス負荷、個人情報の取り扱いを確認し、低い頻度と必要最小限の件数で使用してください。CAPTCHAやアクセス制限を回避する機能は実装していません。
