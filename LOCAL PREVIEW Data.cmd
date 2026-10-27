@echo off
setlocal
title Dental Lab ERP - Local Preview
cd /d "%~dp0"
echo Starting the isolated Local Preview...
echo Keep this window open while testing.
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local-preview.ps1"
set "PREVIEW_EXIT=%ERRORLEVEL%"
echo.
if not "%PREVIEW_EXIT%"=="0" echo Local Preview stopped with error code %PREVIEW_EXIT%.
echo Press any key to close this window.
pause >nul
exit /b %PREVIEW_EXIT%
