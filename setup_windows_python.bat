@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_windows_python.ps1" %*
exit /b %ERRORLEVEL%
