@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_camera_lab.ps1" %*
exit /b %ERRORLEVEL%
