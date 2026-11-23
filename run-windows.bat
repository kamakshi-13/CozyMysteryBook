@echo off
setlocal
cd /d "%~dp0"
title cozymystrybook - Local Server
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22.13 or newer, then reopen this file.
  pause
  exit /b 1
)
if not exist .env (
  copy .env.example .env >nul
  echo A .env file has been created from .env.example.
  echo Set a unique Keeper password (at least 16 characters) in .env before continuing.
  notepad .env
)
echo Starting cozymystrybook...
echo Public site: http://localhost:3000
echo Keeper dashboard: http://localhost:3000/admin/lantern-room
echo Keep this window open while using the site and for scheduled jobs.
echo.
node server.js
pause
