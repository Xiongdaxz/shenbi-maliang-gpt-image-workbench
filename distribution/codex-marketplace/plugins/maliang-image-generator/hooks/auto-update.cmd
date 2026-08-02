@echo off
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%PLUGIN_ROOT%\hooks\auto-update.ps1"
exit /b %ERRORLEVEL%
