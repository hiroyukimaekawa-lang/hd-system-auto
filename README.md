# HD Scraper Automation

## 起動方法（Windows / macOS 共通）

Windows・macOS のどちらでも同じ操作で動きます（Node.js 20以上が必要）。
以下のランチャーを使うと、セットアップ・確認実行・本番実行・アシスタント起動を
メニューから選ぶだけで実行できます。

| OS | 使うファイル |
| --- | --- |
| Windows | `run.bat`（ダブルクリック）または PowerShell で `.\run.ps1` |
| macOS / Linux | `./run.sh` |
| 共通（従来どおり手で叩く場合） | `npm run ...`（このREADMEの各節） |

```
 1) 初回セットアップ（最初の1回だけ）      6) スプレッドシートから投入（本番）
 2) コムデスクにログイン                   7) HD AIアシスタントを開く
 3) 確認実行（書き込みなし / dry-run）      8) Slack常駐アプリを起動
 4) 本番実行                               9) 設定・構文チェック
 5) スプレッドシートから投入（確認）        0) 終了
```

引数を付ければメニューを出さずに実行できます。

```powershell
.\run.ps1 -Task dry -Prefecture 茨城県 -Area 土浦市 -Category 飲食店
.\run.ps1 -Task comdesk -SpreadsheetUrl "https://docs.google.com/spreadsheets/d/xxxx/edit"
```

```bash
./run.sh --task dry --prefecture 茨城県 --area 土浦市 --category 飲食店
./run.sh --task comdesk --spreadsheet-url "https://docs.google.com/spreadsheets/d/xxxx/edit"
```

### Windowsではじめて使うとき

1. Node.js を入れる（PowerShellで実行）。終わったらPowerShellを開き直す。

   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```

2. このフォルダの `run.bat` をダブルクリックし、`1) 初回セットアップ` を選ぶ。
3. 続けて `2) コムデスクにログイン` を選び、開いたChromeでログインする。
4. 以降は `3) 確認実行` → 問題なければ `4) 本番実行`。

`run.ps1` を直接実行して「スクリプトの実行がシステムで無効になっています」と
出た場合は、`run.bat` から起動するか、次のいずれかで回避します。

```powershell
powershell -ExecutionPolicy Bypass -File .\run.ps1
```

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### Windowsでのトラブル

| 症状 | 対処 |
| --- | --- |
| `node : 用語 node は認識されません` | Node.js未インストール、またはインストール後にPowerShellを開き直していない |
| `npm install` で better-sqlite3 のビルドに失敗する | Node.jsをLTS（20または22）に合わせる。それでも失敗する場合は `winget install Microsoft.VisualStudio.2022.BuildTools` |
| Playwrightがブラウザを見つけられない | `1) 初回セットアップ` を実行する（`npm run install-browser` 相当） |
| 日本語が文字化けする | cmd.exeではなくPowerShell（またはWindows Terminal）を使う |
| `npm install` が社内ネットワークで失敗する | `npm config set proxy http://...` / `npm config set https-proxy http://...` |

## Googleスプレッドシートからコムデスクへ完全自動投入

共有されたGoogleスプレッドシートを取得し、31列・電話番号・重複を検証してから、プロジェクト登録、重複確認通知のクリック、件数照合、送信、完了通知の確認まで連続実行します。

```bash
# 書き込みなしの確認
npm run comdesk:auto:dry -- --spreadsheet-url="https://docs.google.com/spreadsheets/d/1VPJZgTs8f5BVN9ylRokAbVtn-ZK8wZpvkqMG8yuuON8/edit?usp=sharing"

# 本番投入（.envのCOMDESK_EXECUTE=trueも必要）
npm run comdesk:auto -- --spreadsheet-url="https://docs.google.com/spreadsheets/d/1VPJZgTs8f5BVN9ylRokAbVtn-ZK8wZpvkqMG8yuuON8/edit?usp=sharing" --execute
```

プロジェクト名は住所から `都道府県_市区町村` として決定します。指定する場合は `--project-name=茨城県_稲敷市・美浦村` を追加します。ジョブ状態、結果、ログ、停止時スクリーンショットは `data/comdesk-jobs/<jobId>/` に保存され、後続の取得済み地域地図にも利用できます。

## 営業リストを1回の操作で作る（統合版）

### 取得済みの稲敷市・美浦村を統合する

Googleマップや食べログを再取得せず、確認済みのGoogleスプレッドシート内にある`04_SALES_`シートだけを結合します。美浦村側の元ファイル名が「三浦市」でも、処理上は必ず美浦村として扱います。

```bash
npm run hd:merge -- --areas=美浦村,稲敷市 --category=飲食店 --project-name=茨城県_稲敷市・美浦村 --dry-run
```

この確認実行では`稲敷市・美浦村.xlsx`を生成し、Comdeskへの投入予定を表示しますが、Comdeskを変更しません。美浦村35件・稲敷市114件と一致しない場合、列名や列順が一致しない場合は安全に停止します。本番投入はdry-runの結果を確認してから`--execute`を明示した場合だけ行われます。

プロジェクト作成後に通知承認だけ失敗した場合は、プロジェクトを再作成せず次で承認処理だけ再開できます。

```bash
npm run hd:merge:finalize -- --areas=美浦村,稲敷市 --category=飲食店 --project-name=茨城県_稲敷市・美浦村
```

このコマンドは、対象プロジェクト名・ワークグループ・通知内プロジェクトIDが一致する通知だけを開きます。画面ローダーの終了を待ってから、新規追加・重複除外を確認して送信し、完了通知まで確認します。新しいプロジェクト登録は行いません。

このフォルダでターミナルを開き、初回だけ `npm install` を実行してください。Comdeskへの登録前には、既存のログイン状態が `comdesk-playwright-importer/.auth/chrome` に残っていることも確認します。パスワードを設定ファイルへ書く必要はありません。

### 1. まず安全確認

次は計画を表示してジョブ記録を作るだけです。Googleマップ、食べログ、Comdeskにはアクセスせず、データも変更しません。

```bash
npm run hd:dry -- --prefecture=茨城県 --area=対象市区町村 --category=飲食店
```

最後に表示される `jobId` と `stateFile` を控えてください。

### 2. リスト作成からComdesk登録まで実行

```bash
npm run hd:run -- --prefecture=茨城県 --area=対象市区町村 --category=飲食店
```

本実行前に `.env` へ `SYSTEM_PROFILE=AFFILIATE`、GAS WebアプリURL、16文字以上の共有シークレットを設定してください。コムデスクへの書き込みは、さらに `COMDESK_EXECUTE=true` がある場合だけ有効です。未設定時は安全に停止し、`hd:dry` では不足設定を計画結果へ表示します。

県全体取得の住所分割は `config/regions.json` が地域マスタです。市区町村・統合エリアをここへ追加し、どこにも一意に一致しないデータは「エリア不明」として確認対象へ送られます。

プロジェクト名は `都道府県_市区町村`、ワークグループは判定したジャンルになります。通知は20秒ごと、最大15分確認します。成功済みジャンルは再実行しても登録しません。

### 3. 途中から再開

```bash
npm run hd:resume -- --job-id=表示されたジョブID
```

失敗したジャンルと未完了工程だけを再開します。CAPTCHA、ログイン切れ、画面変更、通知のプロジェクト名・ワークグループ・プロジェクトID不一致、新規/重複の処理方法を確認できない場合は送信せず停止します。

### 4. Comdeskへ登録せずファイル作成まで

```bash
npm run hd:run -- --prefecture=茨城県 --area=対象市区町村 --category=飲食店 --stop-before=comdesk
```

結果は `data/jobs/ジョブID/` に保存されます。`state.json` は現在状態、`job.log` は取得ログ、`raw/` は取得途中の原本、`outputs/` は営業対象・確認対象・除外対象・取得失敗とジャンル別Comdesk CSV、`screenshots/` は画面停止時の画像です。原本は移動・削除しません。

判定ルールは安全側の初期値です。電話番号なしは「確認対象」、明確なチェーン名・本部・ビル管理・大型商業施設・閉業表記は「除外対象」にします。実運用前に `outputs/review.csv` と `outputs/excluded.csv` を人が確認してください。

現在手動で操作しているGoogleマップ・食べログ拡張機能を、無人実行するためのCLI版です。取得CLIに加え、Phase 2のDrive自動振り分け・GAS無人実行・完成CSV検知まで実装済みです。
既存の `hd-system` とは別リポジトリで管理する前提です。

## HD AIアシスタント（Mac / Windows）

デスクトップの「HD AIアシスタント.app」をクリックすると、ローカル専用のチャット画面が開きます。現在のMVPでは次を自然文で確認できます。

- 「茨城県の取得対象を確認して」
- 「土浦市のDrive接続を確認して」
- 「設定を確認して」

アプリを作り直す場合は `./scripts/install-mac-app.sh` を実行します。画面本体は `desktop/`、ローカルサーバーは `desktop/server.js` です。サーバーは `127.0.0.1` のみに公開され、秘密情報は画面へ表示しません。

Windowsでは、デスクトップにショートカットを作り、ログオン時に自動起動する設定を次で行います（macOSのLaunchAgentに相当）。

```powershell
.\scripts\install-windows-tasks.ps1 -Assistant
```

その場で開くだけなら `.\run.ps1 -Task assistant`（メニューの7番）でも起動できます。

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

## 毎晩自動で動かす

### Mac / Linux

`crontab -e` に次のように登録します（パスと時刻は変更してください）。

```cron
0 1 * * * /absolute/path/hd-scraper-automation/scripts/run-nightly.sh
```

### Windows

タスクスケジューラへ登録します（既定は毎日2:00、`-NightlyTime 02:30` で変更）。

```powershell
.\scripts\install-windows-tasks.ps1 -Nightly
```

登録した設定を消す場合は `-Remove` を付けます。

```powershell
.\scripts\install-windows-tasks.ps1 -Nightly -Remove
```

ログは `logs\nightly-YYYYMMDD.log` に追記されます（`scripts/run-nightly.sh` と同じ内容）。

PCを閉じたりスリープした場合は動きません。完全な「寝ていても自動」を安定運用する場合は、常時起動PC、VPS、GitHub Actions等の実行環境が必要です。ただしGoogleマップは画面構造変更、同意画面、CAPTCHA等で停止する可能性があるため、最初は自分のPCで少量検証してください。

## 次のPhase

1. Docker化、常時起動環境への配置
2. Slackへの完成CSV直接添付（現在はDriveリンク）

## Slack Socket Mode

`config/slack-app-manifest.yml` をSlack Appのマニフェストとして使用し、Bot Token、App Token、Signing Secret、許可チャンネルIDを `.env` へ設定します。

```text
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
SLACK_ALLOWED_CHANNEL_IDS=C0123456789
```

設定後に `./scripts/install-slack-service.sh`（Windowsは `.\scripts\install-windows-tasks.ps1 -Slack`）を実行すると、ログイン中はSocket Modeが常駐します。対応コマンドは `/hd-list`、`/hd-list-sheet`、`/hd-list-status`、`/hd-list-cancel` です。ジョブは `state/jobs.sqlite` に保存され、再起動後は実行途中のジョブを待ち行列へ戻して再開します。

## 注意

対象サイトの利用規約、robots.txt、アクセス負荷、個人情報の取り扱いを確認し、低い頻度と必要最小限の件数で使用してください。CAPTCHAやアクセス制限を回避する機能は実装していません。
