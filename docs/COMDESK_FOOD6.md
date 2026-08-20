# COMDESK 飲食店6ジャンル限定投入

対象ジャンルは以下の6つです。

- カフェ
- スイーツ
- 居酒屋
- スナック
- バー（COMDESK上は `Bar`）
- 焼き鳥（対象シートがある場合のみ）

## dry-run

```bash
npm run comdesk:food6:auto:dry -- --spreadsheet-url="ここにスプレッドシートURL"
```

## 本番投入（Mac）

```bash
COMDESK_EXECUTE=true npm run comdesk:food6:auto -- --spreadsheet-url="ここにスプレッドシートURL" --execute
```

## 本番投入（Windows PowerShell）

```powershell
$env:COMDESK_EXECUTE = "true"
npm run comdesk:food6:auto -- --spreadsheet-url="ここにスプレッドシートURL" --execute
```

## 本番投入（Windows cmd）

```cmd
set "COMDESK_EXECUTE=true"
npm run comdesk:food6:auto -- --spreadsheet-url="ここにスプレッドシートURL" --execute
```

この専用コマンドは内部的に `カフェ,スイーツ,居酒屋,スナック,Bar,焼き鳥` のみを選択します。元スプレッドシートに他ジャンルがあっても投入しません。焼き鳥シートが存在しない場合は、残り5ジャンルだけで続行します。
