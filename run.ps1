#Requires -Version 5.1
<#
.SYNOPSIS
    HD Scraper Automation の Windows / PowerShell 用ランチャー。

.DESCRIPTION
    macOS のターミナルで叩いていた npm スクリプトを、Windows でも同じ操作で
    実行できるようにするメニュー式ランチャー。
    引数なしで起動するとメニューを表示する。-Task を付けると直接実行する。

.PARAMETER Task
    setup      初回セットアップ（npm install / Playwrightのブラウザ導入 / .env作成）
    login      コムデスクへログイン（ログイン状態の保存）
    dry        確認実行（書き込みなし）
    run        本番実行
    comdesk    スプレッドシートからコムデスクへ自動投入（1件）
    batch      複数スプレッドシートを一括投入（リストファイル）
    merge      取得済みリストの統合（稲敷市・美浦村）
    assistant  HD AIアシスタント（デスクトップ画面）を開く
    slack      Slack常駐アプリを起動
    check      構文チェック（npm run check）

.EXAMPLE
    .\run.ps1

.EXAMPLE
    .\run.ps1 -Task dry -Prefecture 茨城県 -Area 土浦市 -Category 飲食店

.EXAMPLE
    .\run.ps1 -Task comdesk -SpreadsheetUrl "https://docs.google.com/spreadsheets/d/xxxx/edit"

.EXAMPLE
    .\run.ps1 -Task batch -List config\comdesk-batch.txt

.NOTES
    このファイルは UTF-8 (BOM付き) で保存すること。
    BOM を消すと Windows PowerShell 5.1 で日本語が文字化けする。
#>
[CmdletBinding()]
param(
    [ValidateSet('menu', 'setup', 'login', 'dry', 'run', 'comdesk', 'batch', 'merge', 'assistant', 'slack', 'check')]
    [string]$Task = 'menu',

    [string]$Prefecture,
    [string]$Area,
    [string]$Category,
    [string]$SpreadsheetUrl,
    [string]$ProjectName,

    # 一括投入のリストファイル（1行1URL）
    [string]$List,

    # 一括投入で、1件でも失敗したらそこで中断する
    [switch]$StopOnError,

    # 本番投入を明示する（未指定なら書き込みなしの確認実行）
    [switch]$Execute,

    # 終了時に Enter 待ちをしない（タスクスケジューラやショートカットからの実行用）
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------
# コンソールを UTF-8 に（日本語の入出力が化けないように）
# ---------------------------------------------------------------------
try {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
} catch {
    # ISE などでは設定できないが実行には支障がないため無視する
}

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition }
Set-Location -LiteralPath $ScriptDir

$ImporterDir = Join-Path $ScriptDir 'comdesk-playwright-importer'
$AssistantPort = if ($env:HD_ASSISTANT_PORT) { $env:HD_ASSISTANT_PORT } else { '43117' }
$AssistantUrl = "http://127.0.0.1:$AssistantPort"

# 各処理の終了コードはこの変数で受け渡す。
# （PowerShellでは関数の戻り値に子プロセスの標準出力が混ざるため、
#   return ではなくスクリプトスコープの変数を使う）
$script:LastExit = 0

function Write-Step([string]$Message) { Write-Host "[run] $Message" -ForegroundColor Cyan }
function Write-Warn([string]$Message) { Write-Host "[run] $Message" -ForegroundColor Yellow }
function Write-Err ([string]$Message) { Write-Host "[run] $Message" -ForegroundColor Red }

function Stop-Script([int]$Code) {
    if (-not $NoPause) {
        Write-Host ''
        Read-Host '終了するには Enter キーを押してください' | Out-Null
    }
    exit $Code
}

function Read-Required([string]$Prompt, [string]$Current) {
    if ($Current) { return $Current.Trim() }
    $value = Read-Host $Prompt
    return "$value".Trim().Trim('"').Trim("'")
}

function Confirm-Action([string]$Message) {
    $answer = Read-Host "$Message (y/N)"
    return ($answer -match '^[yY]')
}

# .env の COMDESK_EXECUTE を読む（環境変数が優先）
function Get-ComdeskExecuteValue {
    if ($env:COMDESK_EXECUTE) { return $env:COMDESK_EXECUTE }
    $envFile = Join-Path $ScriptDir '.env'
    if (-not (Test-Path -LiteralPath $envFile)) { return '' }
    $line = Select-String -LiteralPath $envFile -Pattern '^\s*COMDESK_EXECUTE\s*=' | Select-Object -Last 1
    if (-not $line) { return '' }
    return ($line.Line -replace '^[^=]*=\s*', '').Trim().Trim('"').Trim("'")
}

# 本番投入は --execute と COMDESK_EXECUTE=true の両方が必要。
# .env が false のままなら、この実行だけ true にするか確認する。
function Confirm-ComdeskExecute {
    $current = Get-ComdeskExecuteValue
    if ($current -eq 'true') { return $true }

    $shown = if ($current) { $current } else { '未設定' }
    Write-Warn ".env の COMDESK_EXECUTE が true ではありません（現在: $shown）。"
    Write-Warn 'コムデスクへの書き込みは、この設定が true の場合だけ行われます。'
    if (Confirm-Action 'この1回だけ COMDESK_EXECUTE=true にして続行しますか？') {
        $env:COMDESK_EXECUTE = 'true'
        return $true
    }
    Write-Step '中止しました。恒久的に有効にする場合は .env の COMDESK_EXECUTE=true を編集してください。'
    return $false
}

# ---------------------------------------------------------------------
# Node.js / npm
# ---------------------------------------------------------------------
function Assert-Node {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Err 'Node.js が見つかりません。先にインストールしてください。'
        Write-Host ''
        Write-Host '  方法1（推奨・PowerShellで実行）:' -ForegroundColor Yellow
        Write-Host '    winget install OpenJS.NodeJS.LTS'
        Write-Host ''
        Write-Host '  方法2: https://nodejs.org/ja から LTS 版のインストーラを入手'
        Write-Host ''
        Write-Host '  インストール後、PowerShell を一度閉じて開き直してから再実行してください。'
        Stop-Script 1
    }

    $nodeVersion = (& node -v)
    $majorText = ($nodeVersion -replace '^v', '') -split '\.' | Select-Object -First 1
    [int]$major = 0
    [void][int]::TryParse($majorText, [ref]$major)
    if ($major -gt 0 -and $major -lt 20) {
        Write-Err "Node.js 20 以上が必要です（現在: $nodeVersion）。LTS 版へ更新してください。"
        Stop-Script 1
    }
    Write-Step "Node.js $nodeVersion を使用します"
}

# 子プロセスの出力はそのままコンソールへ流し、終了コードだけ $script:LastExit に入れる
function Invoke-Node([string[]]$NodeArgs, [string]$WorkingDir) {
    $previous = Get-Location
    try {
        if ($WorkingDir) { Set-Location -LiteralPath $WorkingDir }
        Write-Host ''
        & node $NodeArgs
        $script:LastExit = $LASTEXITCODE
    } finally {
        Set-Location -LiteralPath $previous
    }
}

function Invoke-Npm([string[]]$NpmArgs, [string]$WorkingDir) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Err 'npm が見つかりません。Node.js を再インストールしてください。'
        Stop-Script 1
    }
    $previous = Get-Location
    try {
        if ($WorkingDir) { Set-Location -LiteralPath $WorkingDir }
        & npm $NpmArgs
        $script:LastExit = $LASTEXITCODE
    } finally {
        Set-Location -LiteralPath $previous
    }
}

# ---------------------------------------------------------------------
# 各タスク
# ---------------------------------------------------------------------
function Invoke-Setup {
    Write-Step '初回セットアップを開始します（数分かかることがあります）'

    $envFile = Join-Path $ScriptDir '.env'
    $envExample = Join-Path $ScriptDir '.env.example'
    if (-not (Test-Path -LiteralPath $envFile) -and (Test-Path -LiteralPath $envExample)) {
        Copy-Item -LiteralPath $envExample -Destination $envFile
        Write-Warn ".env を .env.example から作成しました。実行前に中身（GASのURL・シークレット等）を編集してください: $envFile"
    }

    Write-Step '本体の依存パッケージを取得します（npm install）...'
    Invoke-Npm @('install') $ScriptDir
    if ($script:LastExit -ne 0) {
        Write-Err 'npm install に失敗しました。'
        Write-Host '  better-sqlite3 のビルドで失敗する場合は、以下のどちらかを試してください。'
        Write-Host '    ・Node.js を LTS（20 または 22）に合わせる'
        Write-Host '    ・winget install Microsoft.VisualStudio.2022.BuildTools でビルドツールを入れる'
        Write-Host '  社内プロキシ環境では npm config set proxy / https-proxy の設定が必要なことがあります。'
        return
    }

    Write-Step 'コムデスク投入ツールの依存パッケージを取得します（npm install）...'
    Invoke-Npm @('install') $ImporterDir
    if ($script:LastExit -ne 0) { Write-Err 'npm install に失敗しました。'; return }

    Write-Step 'Playwright用のChromiumを取得します...'
    Invoke-Npm @('run', 'install-browser') $ImporterDir
    if ($script:LastExit -ne 0) { Write-Err 'ブラウザの取得に失敗しました。'; return }

    Write-Step 'セットアップが完了しました。次は「2) コムデスクにログイン」を実行してください。'
}

function Invoke-Login {
    Write-Step 'コムデスクのログイン画面を開きます。ログイン後、プロジェクト管理画面まで進んでから、このウィンドウで Enter を押してください。'
    Invoke-Node @('src/login.js') $ImporterDir
}

function Invoke-Pipeline([string]$Mode) {
    $pref = Read-Required '都道府県を入力してください（例: 茨城県）' $Prefecture
    $area = Read-Required '市区町村を入力してください（例: 土浦市）' $Area
    $cat  = Read-Required 'ジャンルを入力してください（例: 飲食店）' $Category

    if (-not $pref -or -not $area -or -not $cat) {
        Write-Err '都道府県・市区町村・ジャンルはすべて必要です。'
        $script:LastExit = 1
        return
    }

    if ($Mode -eq 'run') {
        Write-Warn '本番実行です。Googleマップ／食べログの取得と、設定によってはコムデスクへの登録を行います。'
        if (-not (Confirm-Action '実行してよろしいですか？')) { Write-Step '中止しました。'; $script:LastExit = 0; return }
    }

    Invoke-Node @('src/orchestrator/cli.js', $Mode, "--prefecture=$pref", "--area=$area", "--category=$cat") $ScriptDir
}

function Invoke-Comdesk {
    $url = Read-Required 'GoogleスプレッドシートのURLを貼り付けてください' $SpreadsheetUrl
    if (-not $url) {
        Write-Err 'スプレッドシートのURLが必要です。'
        $script:LastExit = 1
        return
    }

    $nodeArgs = @('comdesk-playwright-importer/src/flow.js', "--spreadsheet-url=$url")
    if ($ProjectName) { $nodeArgs += "--project-name=$ProjectName" }

    if ($Execute) {
        Write-Warn '本番投入です。コムデスクへ実際に登録されます。'
        if (-not (Confirm-Action '実行してよろしいですか？')) { Write-Step '中止しました。'; $script:LastExit = 0; return }
        if (-not (Confirm-ComdeskExecute)) { $script:LastExit = 0; return }
        $nodeArgs += '--execute'
    } else {
        Write-Step '書き込みなしの確認実行（--dry-run）で実行します。'
        $nodeArgs += '--dry-run'
    }

    Invoke-Node $nodeArgs $ScriptDir
}

function Invoke-Batch {
    $listFile = Read-Required 'リストファイルのパスを入力してください（例: config\comdesk-batch.txt）' $List
    if (-not $listFile) {
        Write-Err 'リストファイルが必要です。'
        $script:LastExit = 1
        return
    }
    if (-not (Test-Path -LiteralPath $listFile)) {
        Write-Err "リストファイルが見つかりません: $listFile"
        $script:LastExit = 1
        return
    }

    $nodeArgs = @('comdesk-playwright-importer/src/batch.js', "--list=$listFile")
    if ($StopOnError) { $nodeArgs += '--stop-on-error' }

    if ($Execute) {
        Write-Warn '本番投入です。リスト内のすべてのシートがコムデスクへ順番に登録されます。'
        if (-not (Confirm-Action '実行してよろしいですか？')) { Write-Step '中止しました。'; $script:LastExit = 0; return }
        if (-not (Confirm-ComdeskExecute)) { $script:LastExit = 0; return }
        $nodeArgs += '--execute'
    } else {
        Write-Step '書き込みなしの確認実行（--dry-run）で実行します。'
        $nodeArgs += '--dry-run'
    }

    Invoke-Node $nodeArgs $ScriptDir
}

function Invoke-Merge {
    $projectName = Read-Required 'プロジェクト名を入力してください（例: 茨城県_稲敷市・美浦村）' $ProjectName
    if (-not $projectName) {
        Write-Err 'プロジェクト名が必要です。'
        $script:LastExit = 1
        return
    }

    $nodeArgs = @('src/merge/cli.js', '--areas=美浦村,稲敷市', '--category=飲食店', "--project-name=$projectName")
    if ($Execute) {
        Write-Warn '本番投入です。コムデスクへ実際に登録されます。'
        if (-not (Confirm-Action '実行してよろしいですか？')) { Write-Step '中止しました。'; $script:LastExit = 0; return }
        if (-not (Confirm-ComdeskExecute)) { $script:LastExit = 0; return }
        $nodeArgs += '--execute'
    } else {
        $nodeArgs += '--dry-run'
    }

    Invoke-Node $nodeArgs $ScriptDir
}

function Test-Assistant {
    try {
        $null = Invoke-WebRequest -UseBasicParsing -Uri "$AssistantUrl/api/health" -TimeoutSec 2
        return $true
    } catch {
        return $false
    }
}

function Invoke-Assistant {
    $script:LastExit = 0

    if (Test-Assistant) {
        Write-Step "HD AIアシスタントは起動済みです。ブラウザで開きます: $AssistantUrl"
    } else {
        Write-Step 'HD AIアシスタントを起動します...'
        New-Item -ItemType Directory -Force -Path (Join-Path $ScriptDir 'state') | Out-Null
        Start-Process -FilePath 'node' -ArgumentList 'desktop/server.js' -WorkingDirectory $ScriptDir -WindowStyle Minimized | Out-Null

        $alive = $false
        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Milliseconds 500
            if (Test-Assistant) { $alive = $true; break }
        }

        if (-not $alive) {
            Write-Err '起動を確認できませんでした。state\desktop-assistant-error.log を確認してください。'
            $script:LastExit = 1
            return
        }
        Write-Step "起動しました: $AssistantUrl"
    }

    Start-Process $AssistantUrl | Out-Null
}

function Invoke-SlackApp {
    Write-Step 'Slack常駐アプリを起動します（終了するには Ctrl+C）。'
    Invoke-Node @('src/slack-app.js') $ScriptDir
}

function Invoke-Check {
    Invoke-Npm @('run', 'check') $ScriptDir
}

# ---------------------------------------------------------------------
# メニュー
# ---------------------------------------------------------------------
function Show-Menu {
    Write-Host ''
    Write-Host '=============================================' -ForegroundColor DarkCyan
    Write-Host ' HD Scraper Automation' -ForegroundColor White
    Write-Host '=============================================' -ForegroundColor DarkCyan
    Write-Host ' 1) 初回セットアップ（最初の1回だけ）'
    Write-Host ' 2) コムデスクにログイン（初回・ログイン切れ時）'
    Write-Host ' 3) 確認実行（書き込みなし / dry-run）'
    Write-Host ' 4) 本番実行'
    Write-Host ' 5) スプレッドシートからコムデスクへ投入（確認）'
    Write-Host ' 6) スプレッドシートからコムデスクへ投入（本番）'
    Write-Host ' 7) 複数スプレッドシートを一括投入（確認）'
    Write-Host ' 8) 複数スプレッドシートを一括投入（本番）'
    Write-Host ' 9) HD AIアシスタントを開く'
    Write-Host '10) Slack常駐アプリを起動'
    Write-Host '11) 設定・構文チェック'
    Write-Host ' 0) 終了'
    Write-Host ''
}

Assert-Node

if ($Task -eq 'menu') {
    Show-Menu
    $choice = Read-Host '番号を入力してください'
    switch ("$choice".Trim()) {
        '1' { Invoke-Setup }
        '2' { Invoke-Login }
        '3' { Invoke-Pipeline 'dry' }
        '4' { Invoke-Pipeline 'run' }
        '5' { $Execute = $false; Invoke-Comdesk }
        '6' { $Execute = $true;  Invoke-Comdesk }
        '7' { $Execute = $false; Invoke-Batch }
        '8' { $Execute = $true;  Invoke-Batch }
        '9' { Invoke-Assistant }
        '10' { Invoke-SlackApp }
        '11' { Invoke-Check }
        '0' { Write-Step '終了します。' }
        default { Write-Err '0〜11 の番号を入力してください。'; $script:LastExit = 1 }
    }
} else {
    switch ($Task) {
        'setup'     { Invoke-Setup }
        'login'     { Invoke-Login }
        'dry'       { Invoke-Pipeline 'dry' }
        'run'       { Invoke-Pipeline 'run' }
        'comdesk'   { Invoke-Comdesk }
        'batch'     { Invoke-Batch }
        'merge'     { Invoke-Merge }
        'assistant' { Invoke-Assistant }
        'slack'     { Invoke-SlackApp }
        'check'     { Invoke-Check }
    }
}

$exitCode = $script:LastExit
if ($null -eq $exitCode) { $exitCode = 0 }

Write-Host ''
if ($exitCode -ne 0) {
    Write-Err "処理が失敗しました（終了コード $exitCode）。上のメッセージを確認してください。"
} else {
    Write-Step '処理が完了しました。'
}

Stop-Script $exitCode
