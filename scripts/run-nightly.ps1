#Requires -Version 5.1
<#
.SYNOPSIS
    夜間バッチ（Windows版）。scripts/run-nightly.sh と同じ処理を行う。

.DESCRIPTION
    リポジトリ直下で npm start を実行し、logs/nightly-YYYYMMDD.log へ追記する。
    タスクスケジューラから呼ばれることを想定している
    （登録は scripts/install-windows-tasks.ps1 -Nightly）。

.NOTES
    このファイルは UTF-8 (BOM付き) で保存すること。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

try {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
} catch {}

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Root = Split-Path -Parent $ScriptDir
Set-Location -LiteralPath $Root

$logDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("nightly-" + (Get-Date -Format 'yyyyMMdd') + ".log")

"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 開始 ===" | Out-File -FilePath $logFile -Append -Encoding utf8

& npm start *>&1 | Tee-Object -FilePath $logFile -Append
$code = $LASTEXITCODE

"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 終了 (exit $code) ===" | Out-File -FilePath $logFile -Append -Encoding utf8

exit $code
