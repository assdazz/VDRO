@echo off
chcp 65001 >nul
setlocal
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"

if not exist "out\main\index.js" (
  echo Building VDRO...
  call npm.cmd run build
  if errorlevel 1 goto fail
)

if not exist "VDRO.exe" (
  echo VDRO.exe is missing.
  pause
  exit /b 1
)

start "" "%~dp0VDRO.exe"
exit /b 0

:fail
echo.
echo VDRO failed to build.
pause
exit /b 1
