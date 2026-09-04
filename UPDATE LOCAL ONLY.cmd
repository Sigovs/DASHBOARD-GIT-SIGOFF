@echo off
chcp 65001 >nul
title SIGOVS - Update catalog (local only)
cd /d "%~dp0"

echo.
echo   SIGOVS - PROJECT CATALOG
echo   Local update only. Nothing is pushed to GitHub.
echo.

call node scripts\update-all.mjs --no-push %*

if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

timeout /t 4 >nul
