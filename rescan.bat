@echo off
cd /d "%~dp0"
node --disable-warning=ExperimentalWarning scanner.mjs
pause
