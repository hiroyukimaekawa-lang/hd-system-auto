@echo off
rem ---------------------------------------------------------------
rem  Double-click launcher for HD Scraper Automation (Windows).
rem
rem  The menu itself is a Node.js script (scripts\win-menu.js), so
rem  PowerShell and its execution policy are never involved.
rem
rem  Keep this file ASCII-only: cmd.exe reads .bat in the OEM code
rem  page, so Japanese text here would be garbled.
rem ---------------------------------------------------------------
setlocal
chcp 65001 >nul 2>nul
cd /d "%~dp0"

rem Put --no-pause first if you do not want the window to wait at the end.
set "PAUSEATEND=1"
if /i "%~1"=="--no-pause" set "PAUSEATEND=0"

where node >nul 2>nul
if errorlevel 1 goto nonode

node "%~dp0scripts\win-menu.js" --no-pause %*
set "EXITCODE=%ERRORLEVEL%"

if "%PAUSEATEND%"=="1" (
  echo.
  pause
)
exit /b %EXITCODE%

:nonode
echo.
echo   Node.js was not found on this PC.
echo.
echo   Install it with either method below, then start run.bat again:
echo.
echo     1^) In PowerShell or Command Prompt, run:
echo          winget install OpenJS.NodeJS.LTS
echo.
echo     2^) Or download the LTS installer from:
echo          https://nodejs.org/en/download
echo.
echo   IMPORTANT: close this window after installing Node.js,
echo              then start run.bat again.
echo.
pause
exit /b 1
