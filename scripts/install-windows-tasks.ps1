#Requires -Version 5.1
<#
.SYNOPSIS
    Windows版の常駐設定。macOS の install-mac-app.sh / install-slack-service.sh
    （LaunchAgent）に相当する処理を、タスクスケジューラで行う。

.DESCRIPTION
    -Assistant : ログオン時に HD AIアシスタント（desktop/server.js）を自動起動し、
                 デスクトップに起動用ショートカットを作る。
    -Slack     : ログオン時に Slack常駐アプリ（src/slack-app.js）を自動起動する。
                 .env に Slack の4項目が設定されていない場合は中止する。
    -Nightly   : 毎日決まった時刻に scripts/run-nightly.ps1 を実行する。
    -Remove    : 上記で作成したタスクとショートカットを削除する。

    スイッチを何も指定しない場合は -Assistant として扱う。

.EXAMPLE
    .\scripts\install-windows-tasks.ps1 -Assistant

.EXAMPLE
    .\scripts\install-windows-tasks.ps1 -Nightly -NightlyTime 02:30

.EXAMPLE
    .\scripts\install-windows-tasks.ps1 -Assistant -Slack -Remove

.NOTES
    このファイルは UTF-8 (BOM付き) で保存すること。
    実行ポリシーで止まる場合:
      powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-tasks.ps1 -Assistant
#>
[CmdletBinding()]
param(
    [switch]$Assistant,
    [switch]$Slack,
    [switch]$Nightly,
    [string]$NightlyTime = '02:00',
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

try {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
} catch {}

function Write-Step([string]$Message) { Write-Host "[install] $Message" -ForegroundColor Cyan }
function Write-Warn([string]$Message) { Write-Host "[install] $Message" -ForegroundColor Yellow }
function Write-Err ([string]$Message) { Write-Host "[install] $Message" -ForegroundColor Red }

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Root = Split-Path -Parent $ScriptDir

if (-not ($Assistant -or $Slack -or $Nightly)) { $Assistant = $true }

$AssistantTask = 'HD AIアシスタント'
$SlackTask     = 'HD Slack常駐アプリ'
$NightlyTask   = 'HD 夜間バッチ'
$ShortcutPath  = Join-Path ([Environment]::GetFolderPath('Desktop')) 'HD AIアシスタント.lnk'

function Get-NodePath {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Err 'Node.js が見つかりません。先に winget install OpenJS.NodeJS.LTS でインストールしてください。'
        exit 1
    }
    return $node.Source
}

function Remove-TaskIfExists([string]$Name) {
    if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false
        Write-Step "タスクを削除しました: $Name"
    }
}

function Register-LogonTask([string]$Name, [string]$Executable, [string]$Arguments, [string]$WorkingDir) {
    Remove-TaskIfExists $Name
    $action    = New-ScheduledTaskAction -Execute $Executable -Argument $Arguments -WorkingDirectory $WorkingDir
    $trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null
    Write-Step "ログオン時に自動起動するよう登録しました: $Name"
}

# ---------------------------------------------------------------------
# 削除モード
# ---------------------------------------------------------------------
if ($Remove) {
    if ($Assistant) {
        Remove-TaskIfExists $AssistantTask
        if (Test-Path -LiteralPath $ShortcutPath) {
            Remove-Item -LiteralPath $ShortcutPath
            Write-Step "ショートカットを削除しました: $ShortcutPath"
        }
    }
    if ($Slack)   { Remove-TaskIfExists $SlackTask }
    if ($Nightly) { Remove-TaskIfExists $NightlyTask }
    Write-Step '削除が完了しました。'
    exit 0
}

$NodePath = Get-NodePath
Write-Step "Node.js: $NodePath"
Write-Step "対象フォルダ: $Root"

# ---------------------------------------------------------------------
# HD AIアシスタント（ログオン時起動 + デスクトップショートカット）
# ---------------------------------------------------------------------
if ($Assistant) {
    Register-LogonTask $AssistantTask $NodePath 'desktop/server.js' $Root

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath       = (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
    $shortcut.Arguments        = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $Root 'run.ps1')`" -Task assistant -NoPause"
    $shortcut.WorkingDirectory = $Root
    $shortcut.Description      = 'HD AIアシスタントを開く'
    $iconCandidate = Join-Path $Root 'desktop\assets\assistant-icon.ico'
    if (Test-Path -LiteralPath $iconCandidate) { $shortcut.IconLocation = $iconCandidate }
    $shortcut.Save()

    Write-Step "デスクトップにショートカットを作成しました: $ShortcutPath"

    Start-ScheduledTask -TaskName $AssistantTask
    Write-Step 'HD AIアシスタントを起動しました（http://127.0.0.1:43117）'
}

# ---------------------------------------------------------------------
# Slack常駐アプリ
# ---------------------------------------------------------------------
if ($Slack) {
    $envFile = Join-Path $Root '.env'
    if (-not (Test-Path -LiteralPath $envFile)) {
        Write-Err ".env がありません: $envFile"
        exit 1
    }

    $envText = Get-Content -LiteralPath $envFile -Raw -Encoding UTF8
    foreach ($key in @('SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_ALLOWED_CHANNEL_IDS')) {
        if ($envText -notmatch "(?m)^\s*$key\s*=\s*\S") {
            Write-Err "$key が .env に設定されていません"
            exit 1
        }
    }

    Register-LogonTask $SlackTask $NodePath 'src/slack-app.js' $Root
    Start-ScheduledTask -TaskName $SlackTask
    Write-Step 'Slack常駐サービスを開始しました'
}

# ---------------------------------------------------------------------
# 夜間バッチ
# ---------------------------------------------------------------------
if ($Nightly) {
    [datetime]$time = [datetime]::MinValue
    if (-not [datetime]::TryParse($NightlyTime, [ref]$time)) {
        Write-Err "-NightlyTime の形式が不正です（例: 02:00）: $NightlyTime"
        exit 1
    }

    Remove-TaskIfExists $NightlyTask
    $nightlyScript = Join-Path $Root 'scripts\run-nightly.ps1'
    $action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$nightlyScript`"" -WorkingDirectory $Root
    $trigger   = New-ScheduledTaskTrigger -Daily -At $time
    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -WakeToRun -ExecutionTimeLimit ([TimeSpan]::FromHours(12))
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $NightlyTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null

    Write-Step "毎日 $($time.ToString('HH:mm')) に夜間バッチを実行するよう登録しました: $NightlyTask"
}

Write-Step '設定が完了しました。タスクの状態は「タスク スケジューラ」アプリで確認・停止できます。'
