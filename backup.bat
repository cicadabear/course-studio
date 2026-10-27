@echo off
cd /d "%~dp0"
node --disable-warning=ExperimentalWarning scripts/backup.mjs
pause
