@echo off
title Dental Lab ERP - Local Preview
echo Starting an isolated local Supabase + Vite preview.
echo Production data will not be used.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local-preview.ps1"
pause
