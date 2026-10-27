@echo off
title Dental Lab ERP - Deploy Preview
echo Deploying to the PREVIEW branch only.
echo Production database migrations will NOT run.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-deploy-preview.ps1"
pause
