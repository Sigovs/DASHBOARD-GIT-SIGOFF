@echo off
chcp 65001 >nul
title SIGOVS - Update catalog
cd /d "%~dp0"

echo.
echo   SIGOVS - PROJECT CATALOG
echo   Updating from GitHub, capturing new screenshots, publishing.
echo.

call node scripts\update-all.mjs %*

if errorlevel 1 (
  echo.
  echo   Something went wrong. The message above says what.
  echo.
  pause
  exit /b 1
)

timeout /t 4 >nul
