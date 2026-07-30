@echo off
rem ASCII only. Do NOT put non-ASCII characters in this file:
rem cmd.exe re-reads the batch file while running, and switching the code page
rem mid-file corrupts parsing of the remaining lines.
rem All Korean messages are printed by tools/launch.mjs instead.
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org and run again.
  pause
  exit /b 1
)

node tools\launch.mjs build
