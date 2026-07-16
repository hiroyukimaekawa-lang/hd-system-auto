# HD Scraper Automation

現在手動で操作しているGoogleマップ拡張機能を、夜間に無人実行するためのCLI版です。
既存の `hd-system` とは別リポジトリで管理する前提です。

## 現在できること

- `config/jobs.csv` に「エリア・検索キーワード・出力ジャンル・最大件数」を並べて一括実行
- Chromiumを自動操作してGoogleマップの一覧・詳細情報を取得
- 店名、Googleジャンル、住所、電話番号、営業時間、HP有無をCSV出力
- 1店舗ごとにJSONLへ保存し、停止やエラー後も取得済みURLをスキップして再開
- エリア×ジャンルごとに既存GASへ渡しやすい日本語列名のCSVを生成

## 初回セットアップ

Node.js 20以上を用意し、次を実行します。

```bash
npm install
npx playwright install chromium
```

## 使い方

1. `config/jobs.csv` を編集します。
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

CSVは `output/`、途中経過は `state/` に保存されます。同じ設定で再実行すると取得済みURLを飛ばして続きから動きます。

## 毎晩自動で動かす（Mac/Linux）

`crontab -e` に次のように登録します（パスと時刻は変更してください）。

```cron
0 1 * * * /absolute/path/hd-scraper-automation/scripts/run-nightly.sh
```

PCを閉じたりスリープした場合は動きません。完全な「寝ていても自動」を安定運用する場合は、常時起動PC、VPS、GitHub Actions等の実行環境が必要です。ただしGoogleマップは画面構造変更、同意画面、CAPTCHA等で停止する可能性があるため、最初は自分のPCで少量検証してください。

## 次の実装候補

1. Google Drive APIへCSVを自動アップロードし、既存GASまで連携
2. Slackまたはメールへの完了・エラー通知
3. 食べログ、ホットペッパー、楽天トラベルを同じジョブ形式に統合
4. チェーン・ビル管理・大型SC・既存リストとの重複をCLI側で除外
5. Docker化してVPSへ配置

## 注意

対象サイトの利用規約、robots.txt、アクセス負荷、個人情報の取り扱いを確認し、低い頻度と必要最小限の件数で使用してください。CAPTCHAやアクセス制限を回避する機能は実装していません。
