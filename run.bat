@echo off
rem ---------------------------------------------------------------
rem  Double-click launcher for run.ps1 (Windows).
rem  Keep this file ASCII-only: cmd.exe reads .bat in the OEM code
rem  page, so Japanese text here would be garbled.
rem ---------------------------------------------------------------
setlocal
cd /d "%~dp0"

where powershell >nul 2>nul
if errorlevel 1 (
  echo PowerShell was not found on this PC.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
set EXITCODE=%ERRORLEVEL%

if not "%EXITCODE%"=="0" pause
exit /b %EXITCODE%
